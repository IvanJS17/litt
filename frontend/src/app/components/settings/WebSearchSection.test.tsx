import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWebSearchSettings,
  updateWebSearchSettings,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { WebSearchSection } from "./WebSearchSection";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getWebSearchSettings: vi.fn(),
  updateWebSearchSettings: vi.fn(),
}));

vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: vi.fn(),
}));

const keys = vi.hoisted(() => ({ configured: ["claude"] as string[] }));
const workspace = vi.hoisted(() => ({
  firm: null as null | { name: string },
  allowPersonal: true,
  // Which kinds of own key the firm blocks, when only some are.
  blocked: [] as string[],
  // Providers the person can run in the firm, whoever's key it is.
  effective: ["claude"] as string[],
}));

vi.mock("@/app/contexts/WorkspaceContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/contexts/WorkspaceContext")>()),
  useWorkspace: () => ({
    activeOrganization: workspace.firm,
    workspaceId: workspace.firm ? "org-1" : "personal",
    orgApiKeys: workspace.firm
      ? {
          allow_personal_keys: Object.fromEntries(
            ["ai", "web_search", "scan"].map((capability) => [
              capability,
              workspace.allowPersonal && !workspace.blocked.includes(capability),
            ]),
          ),
          effective: Object.fromEntries(
            ["claude", "openai", "brave", "tavily", "deepseek"].map((provider) => [
              provider,
              workspace.effective.includes(provider),
            ]),
          ),
        }
      : null,
  }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
  useUserProfile: () => ({
    profile: {
      apiKeys: Object.fromEntries(
        ["claude", "openai", "brave", "tavily", "deepseek"].map((provider) => [
          provider,
          {
            configured: keys.configured.includes(provider),
            enabled: true,
            source: null,
          },
        ]),
      ),
    },
    updateApiKey: vi.fn(),
  }),
}));

const OFF = {
  enabled: false,
  claude: "provider",
  openai: "provider",
  other: "off",
} as const;

const toggle = () => screen.getByRole("switch", { name: "Enable web search" });

const trigger = (name: string) => screen.getByRole("button", { name });

describe("WebSearchSection", () => {
  beforeEach(() => {
    keys.configured = ["claude"];
    workspace.firm = null;
    workspace.allowPersonal = true;
    workspace.blocked = [];
    workspace.effective = ["claude"];
    vi.mocked(updateWebSearchSettings).mockReset();
    vi.mocked(notifyError).mockReset();
    vi.mocked(getWebSearchSettings).mockResolvedValue(OFF);
  });

  it("offers a choice for each kind of model the user has set up", async () => {
    vi.mocked(updateWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true });
    render(<WebSearchSection />);
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-checked", "false"));

    fireEvent.click(toggle());

    expect(updateWebSearchSettings).toHaveBeenCalledWith({ enabled: true });
    expect(trigger("Claude models")).toHaveTextContent("Anthropic Search");
    expect(trigger("Other models")).toHaveTextContent("Off");
    expect(screen.queryByRole("button", { name: "OpenAI models" })).toBeNull();
    expect(screen.queryByLabelText("Brave Search API Key")).toBeNull();
  });

  it("asks for a key for each search service chosen", async () => {
    vi.mocked(getWebSearchSettings).mockResolvedValue({
      ...OFF,
      enabled: true,
      claude: "brave",
      other: "tavily",
    });
    render(<WebSearchSection />);

    expect(await screen.findByLabelText("Brave Search API Key")).toBeInTheDocument();
    expect(screen.getByLabelText("Tavily API Key")).toBeInTheDocument();
    expect(screen.queryByLabelText("DeepSeek API Key")).toBeNull();
    expect(trigger("Other models")).toHaveTextContent("Tavily");
  });

  it("says the key applies to the personal workspace, or to the firm that takes members' keys", async () => {
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true, claude: "brave" });
    const { unmount } = render(<WebSearchSection />);
    expect(await screen.findByText("These keys are yours and apply to your personal workspace.")).toBeVisible();
    unmount();

    workspace.firm = { name: "Socium" };
    render(<WebSearchSection />);
    expect(await screen.findByText(/They are also used in the firm Socium/)).toBeVisible();
    expect(screen.getByLabelText("Brave Search API Key")).toBeInTheDocument();
  });

  it("offers the Claude row in a firm whose Claude key is the firm's, though the person has none of their own", async () => {
    keys.configured = [];
    workspace.firm = { name: "Socium" };
    workspace.effective = ["claude"];
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true });
    render(<WebSearchSection />);

    expect(await screen.findByRole("button", { name: "Claude models" })).toHaveTextContent("Anthropic Search");
    expect(trigger("Other models")).toBeInTheDocument();
  });

  it("offers only 'All models' in a firm with no Claude key at all", async () => {
    keys.configured = ["claude"];
    workspace.firm = { name: "Socium" };
    workspace.effective = [];
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true });
    render(<WebSearchSection />);

    expect(await screen.findByRole("button", { name: "All models" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claude models" })).toBeNull();
  });

  it("follows only the web-search switch: blocking own AI keys leaves the search key field", async () => {
    workspace.firm = { name: "Socium" };
    workspace.blocked = ["ai", "scan"];
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true, claude: "brave" });
    render(<WebSearchSection />);

    expect(await screen.findByLabelText("Brave Search API Key")).toBeInTheDocument();
  });

  it("hides the search key field when the firm blocks own web search keys, though AI keys stay allowed", async () => {
    workspace.firm = { name: "Socium" };
    workspace.blocked = ["web_search"];
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true, claude: "brave" });
    render(<WebSearchSection />);

    await screen.findByRole("button", { name: "Claude models" });
    expect(screen.queryByLabelText("Brave Search API Key")).toBeNull();
  });

  it("offers no key in a firm that does not allow members' own keys, and says why", async () => {
    workspace.firm = { name: "Socium" };
    workspace.allowPersonal = false;
    vi.mocked(getWebSearchSettings).mockResolvedValue({ ...OFF, enabled: true, claude: "brave" });
    render(<WebSearchSection />);
    expect(
      await screen.findByText("You work with the keys of Socium. Your firm does not allow using your own keys for this."),
    ).toBeVisible();
    expect(screen.queryByLabelText("Brave Search API Key")).toBeNull();
  });

  it("puts the switch back and raises a notice when the save fails", async () => {
    const failure = new Error("boom");
    vi.mocked(updateWebSearchSettings).mockRejectedValue(failure);
    render(<WebSearchSection />);
    await waitFor(() => expect(toggle()).toBeInTheDocument());

    fireEvent.click(toggle());

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(failure, expect.anything()),
    );
    expect(toggle()).toHaveAttribute("aria-checked", "false");
  });
});
