import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getChatCredentialOptions } from "@/app/lib/mikeApi";
import { usePlaybookKey } from "./usePlaybookKey";

const workspace = { workspaceId: "personal" as string | null };
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  PERSONAL_WORKSPACE: "personal",
  useWorkspace: () => workspace,
}));
vi.mock("@/app/lib/mikeApi", () => ({ getChatCredentialOptions: vi.fn() }));

const FIRM = { credential_ref: "org:org-1:claude:v2", source: "organization" as const };
const OWN = { credential_ref: "user:u1:claude:v1", source: "personal" as const };
const GPT = { credential_ref: "org:org-1:openai:v1", source: "organization" as const };

beforeEach(() => {
  vi.clearAllMocks();
  workspace.workspaceId = "personal";
});

describe("usePlaybookKey", () => {
  it("takes the chat's default in a firm workspace, asking for that firm", async () => {
    workspace.workspaceId = "org-1";
    vi.mocked(getChatCredentialOptions).mockResolvedValue({
      provider: "claude",
      options: [FIRM],
      default: FIRM.credential_ref,
    });
    const { result } = renderHook(() => usePlaybookKey({ model: "claude-a", enabled: true }));
    await waitFor(() => expect(result.current.value).toBe(FIRM.credential_ref));
    expect(getChatCredentialOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-a", orgId: "org-1" }),
    );
  });

  it("asks for no organization in the personal workspace, so a firm's key is never offered", async () => {
    vi.mocked(getChatCredentialOptions).mockResolvedValue({
      provider: "claude",
      options: [OWN],
      default: OWN.credential_ref,
    });
    const { result } = renderHook(() => usePlaybookKey({ model: "claude-a", enabled: true }));
    await waitFor(() => expect(result.current.value).toBe(OWN.credential_ref));
    expect(getChatCredentialOptions).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-a", orgId: null }),
    );
  });

  it("asks nothing while no dialog needs it", () => {
    renderHook(() => usePlaybookKey({ model: "claude-a", enabled: false }));
    expect(getChatCredentialOptions).not.toHaveBeenCalled();
  });

  it("re-resolves when the model changes and never sends the old model's key meanwhile", async () => {
    workspace.workspaceId = "org-1";
    let release: (value: Awaited<ReturnType<typeof getChatCredentialOptions>>) => void = () => undefined;
    vi.mocked(getChatCredentialOptions)
      .mockResolvedValueOnce({ provider: "claude", options: [FIRM], default: FIRM.credential_ref })
      .mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const { result, rerender } = renderHook(
      ({ model }) => usePlaybookKey({ model, enabled: true }),
      { initialProps: { model: "claude-a" } },
    );
    await waitFor(() => expect(result.current.value).toBe(FIRM.credential_ref));

    rerender({ model: "gpt-b" });
    expect(result.current.value).toBeNull();
    await act(async () => {
      release({ provider: "openai", options: [GPT], default: GPT.credential_ref });
    });
    await waitFor(() => expect(result.current.value).toBe(GPT.credential_ref));
    expect(getChatCredentialOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: "gpt-b", orgId: "org-1" }),
    );
  });

  it("keeps the person's pick while it is still offered", async () => {
    vi.mocked(getChatCredentialOptions).mockResolvedValue({
      provider: "claude",
      options: [OWN, { ...FIRM }],
      default: OWN.credential_ref,
    });
    const { result } = renderHook(() => usePlaybookKey({ model: "claude-a", enabled: true }));
    await waitFor(() => expect(result.current.value).toBe(OWN.credential_ref));
    act(() => result.current.setValue(FIRM.credential_ref));
    expect(result.current.value).toBe(FIRM.credential_ref);
  });

  describe("the key a submit sends", () => {
    const never = () => new Promise<Awaited<ReturnType<typeof getChatCredentialOptions>>>(() => undefined);

    it("is the loaded one, without asking again", async () => {
      workspace.workspaceId = "org-1";
      vi.mocked(getChatCredentialOptions).mockResolvedValue({
        provider: "claude",
        options: [FIRM],
        default: FIRM.credential_ref,
      });
      const { result } = renderHook(() => usePlaybookKey({ model: "claude-a", enabled: true }));
      await waitFor(() => expect(result.current.value).toBe(FIRM.credential_ref));
      await expect(result.current.resolve()).resolves.toBe(FIRM.credential_ref);
      expect(getChatCredentialOptions).toHaveBeenCalledTimes(1);
    });

    it("waits for the keys of the model just chosen instead of sending none", async () => {
      workspace.workspaceId = "org-1";
      vi.mocked(getChatCredentialOptions)
        .mockResolvedValueOnce({ provider: "claude", options: [FIRM], default: FIRM.credential_ref })
        .mockImplementationOnce(never)
        .mockResolvedValueOnce({ provider: "openai", options: [GPT], default: GPT.credential_ref });
      const { result, rerender } = renderHook(
        ({ model }) => usePlaybookKey({ model, enabled: true }),
        { initialProps: { model: "claude-a" } },
      );
      await waitFor(() => expect(result.current.value).toBe(FIRM.credential_ref));

      rerender({ model: "gpt-b" });
      expect(result.current.value).toBeNull();
      await expect(result.current.resolve()).resolves.toBe(GPT.credential_ref);
      expect(getChatCredentialOptions).toHaveBeenLastCalledWith({ model: "gpt-b", orgId: "org-1" });
    });

    it("waits when the dialog has only just opened", async () => {
      workspace.workspaceId = "org-1";
      vi.mocked(getChatCredentialOptions)
        .mockImplementationOnce(never)
        .mockResolvedValueOnce({ provider: "claude", options: [FIRM], default: FIRM.credential_ref });
      const { result } = renderHook(() => usePlaybookKey({ model: "claude-a", enabled: true }));
      expect(result.current.value).toBeNull();
      await expect(result.current.resolve()).resolves.toBe(FIRM.credential_ref);
    });

    it("keeps the person's pick when the model just chosen still offers it", async () => {
      workspace.workspaceId = "org-1";
      const both = { provider: "claude" as const, options: [OWN, FIRM], default: OWN.credential_ref };
      vi.mocked(getChatCredentialOptions)
        .mockResolvedValueOnce(both)
        .mockImplementationOnce(never)
        .mockResolvedValueOnce(both);
      const { result, rerender } = renderHook(
        ({ model }) => usePlaybookKey({ model, enabled: true }),
        { initialProps: { model: "claude-a" } },
      );
      await waitFor(() => expect(result.current.value).toBe(OWN.credential_ref));
      act(() => result.current.setValue(FIRM.credential_ref));

      rerender({ model: "claude-b" });
      await expect(result.current.resolve()).resolves.toBe(FIRM.credential_ref);
    });

    it("sends none when no key is offered or the keys cannot be read", async () => {
      workspace.workspaceId = "org-1";
      vi.mocked(getChatCredentialOptions)
        .mockResolvedValueOnce({ provider: "claude", options: [], default: null })
        .mockImplementationOnce(never)
        .mockRejectedValueOnce(new Error("offline"));
      const { result, rerender } = renderHook(
        ({ model }) => usePlaybookKey({ model, enabled: true }),
        { initialProps: { model: "claude-a" } },
      );
      await waitFor(() => expect(getChatCredentialOptions).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(result.current.options).not.toBeNull());
      await expect(result.current.resolve()).resolves.toBeNull();
      expect(getChatCredentialOptions).toHaveBeenCalledTimes(1);

      rerender({ model: "claude-b" });
      await expect(result.current.resolve()).resolves.toBeNull();
    });
  });
});
