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
});
