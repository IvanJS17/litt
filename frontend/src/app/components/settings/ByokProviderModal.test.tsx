import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ByokProviderModal } from "./ByokProviderModal";

const mocks = vi.hoisted(() => ({
  updateApiKey: vi.fn(async () => true),
}));

vi.mock("@/app/components/popups/MfaVerificationPopup", () => ({
  MfaVerificationPopup: () => null,
  needsMfaVerification: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
  useUserProfile: () => ({
    profile: {
      apiKeys: { claude: { configured: true, enabled: true, source: "user" } },
      apiKeySettings: undefined,
    },
    updateApiKey: mocks.updateApiKey,
  }),
}));

const provider = {
  provider: "claude",
  name: "Anthropic",
  label: "Anthropic API key",
} as const;

describe("ByokProviderModal primary action", () => {
  it("is an enabled Done that closes when no key is waiting to be saved", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ByokProviderModal provider={provider} onClose={onClose} />);

    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();

    await user.click(done);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.updateApiKey).not.toHaveBeenCalled();
  });

  it("is Save while a new key is typed, and saves it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ByokProviderModal provider={provider} onClose={onClose} />);

    await user.click(screen.getByLabelText("Anthropic API key"));
    await user.type(screen.getByLabelText("Anthropic API key"), "sk-new");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mocks.updateApiKey).toHaveBeenCalledWith("claude", "sk-new", undefined);
    expect(onClose).not.toHaveBeenCalled();
  });
});
