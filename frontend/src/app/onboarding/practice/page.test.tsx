import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingPracticePage from "./page";

const { push, replace, updatePersonalisation, completeOnboarding, listOrgs, getOrgApiKeys } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  updatePersonalisation: vi.fn(),
  completeOnboarding: vi.fn(),
  listOrgs: vi.fn(),
  getOrgApiKeys: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "alex@example.com" },
    authLoading: false,
  }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
  useUserProfile: () => ({
    profile: {
      jurisdiction: null,
      practiceSetting: null,
      professionalTitle: null,
      practiceAreas: [],
    },
    loading: false,
    updatePersonalisation,
    completeOnboarding,
  }),
}));

vi.mock("@/app/lib/mikeApi", async (original) => ({
  ...(await original<typeof import("@/app/lib/mikeApi")>()),
  listOrgs,
  getOrgApiKeys,
}));

vi.mock("@/app/components/site-logo", () => ({
  SiteLogo: () => <div>Mike</div>,
}));

describe("OnboardingPracticePage", () => {
  beforeEach(() => {
    push.mockReset();
    replace.mockReset();
    updatePersonalisation.mockReset();
    updatePersonalisation.mockResolvedValue(true);
    completeOnboarding.mockReset().mockResolvedValue(true);
    listOrgs.mockReset().mockResolvedValue([{ id: "org-1", name: "Socium", role: "member" }]);
    getOrgApiKeys.mockReset().mockResolvedValue({ effective: {}, allow_personal_api_keys: true });
    window.localStorage.clear();
  });

  it("saves practice details before advancing to the models step", async () => {
    const user = userEvent.setup();
    const { container } = render(<OnboardingPracticePage />);

    expect(screen.getByText("Step 2 of 3")).toBeVisible();
    expect(
      container.querySelector('[data-slot="settings-row"]'),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Jurisdiction of practice",
      }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Other" }));
    await user.type(
      screen.getByRole("textbox", { name: "Other jurisdiction" }),
      "England and Wales",
    );
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Senior Associate" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Professional setting" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", { name: "Private practice" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Select practice areas" }),
    );
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Litigation" }),
    );
    await user.click(
      screen.getByRole("menuitemcheckbox", {
        name: "Data Protection and Privacy",
      }),
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(updatePersonalisation).toHaveBeenCalledWith({
        jurisdiction: "England and Wales",
        practiceSetting: "private_practice",
        professionalTitle: "Senior Associate",
        practiceAreas: ["Litigation", "Data Protection and Privacy"],
      }),
    );
    expect(push).toHaveBeenCalledWith("/onboarding/models");
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  it("requires free text when Other is selected", async () => {
    const user = userEvent.setup();
    render(<OnboardingPracticePage />);

    await user.click(
      screen.getByRole("button", {
        name: "Jurisdiction of practice",
      }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "Australia" }));
    await user.click(
      screen.getByRole("button", { name: "Professional setting" }),
    );
    await user.click(
      screen.getByRole("menuitemradio", {
        name: "Not a practising attorney",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Select practice areas" }),
    );
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Other" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter your other practice area",
    );
    expect(updatePersonalisation).not.toHaveBeenCalled();
  });

  it("allows personalisation to be skipped", async () => {
    const user = userEvent.setup();
    render(<OnboardingPracticePage />);

    await user.click(screen.getByRole("button", { name: "Skip" }));

    expect(updatePersonalisation).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/onboarding/models");
  });

  describe("after joining a firm", () => {
    beforeEach(() => {
      window.localStorage.setItem("mike.activeWorkspace.user-1", "org-1");
    });

    it("keeps the models step when the firm takes members' own keys", async () => {
      const user = userEvent.setup();
      render(<OnboardingPracticePage />);
      expect(await screen.findByText("Step 2 of 3")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Skip" }));
      expect(push).toHaveBeenCalledWith("/onboarding/models");
    });

    it("ends here, in the firm's workspace, when the firm does not take their own keys", async () => {
      getOrgApiKeys.mockResolvedValue({ effective: {}, allow_personal_api_keys: false });
      const user = userEvent.setup();
      render(<OnboardingPracticePage />);
      expect(await screen.findByText("Step 2 of 2")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/assistant"));
      expect(updatePersonalisation).toHaveBeenCalledTimes(1);
      expect(completeOnboarding).toHaveBeenCalledOnce();
      expect(push).not.toHaveBeenCalled();
      // The workspace the invitation chose is still the stored one.
      expect(window.localStorage.getItem("mike.activeWorkspace.user-1")).toBe("org-1");
    });

    it("can be skipped to the end, and reports a failed finish without leaving the form locked", async () => {
      getOrgApiKeys.mockResolvedValue({ effective: {}, allow_personal_api_keys: false });
      completeOnboarding.mockResolvedValueOnce(false);
      const user = userEvent.setup();
      render(<OnboardingPracticePage />);
      await screen.findByText("Step 2 of 2");
      await user.click(screen.getByRole("button", { name: "Skip" }));
      expect(await screen.findByText("Unable to finish setup")).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: /close|ok|dismiss/i }));
    });

    it("reports a failed finish after saving and lets the person try again", async () => {
      getOrgApiKeys.mockResolvedValue({ effective: {}, allow_personal_api_keys: false });
      completeOnboarding.mockResolvedValueOnce(false);
      const user = userEvent.setup();
      render(<OnboardingPracticePage />);
      await screen.findByText("Step 2 of 2");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      expect(await screen.findByText("Unable to finish setup")).toBeVisible();
      await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    });

    it("falls back to the models step when the firm cannot be looked up", async () => {
      listOrgs.mockRejectedValue(new Error("down"));
      const user = userEvent.setup();
      render(<OnboardingPracticePage />);
      expect(await screen.findByText("Step 2 of 3")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(push).toHaveBeenCalledWith("/onboarding/models"));
    });
  });

  it("stays on practice details when saving fails, leaving the report to the notice", async () => {
    // updatePersonalisation raises the notice; the form must not repeat it.
    updatePersonalisation.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<OnboardingPracticePage />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
    expect(updatePersonalisation).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

});
