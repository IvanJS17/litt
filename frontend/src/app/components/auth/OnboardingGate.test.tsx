import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingGate } from "./OnboardingGate";

const state = vi.hoisted(() => ({
    pathname: "/assistant",
    profile: {
        displayName: "Alex",
        onboardingComplete: false,
    } as {
        displayName: string | null;
        onboardingComplete: boolean;
        termsRequired?: boolean;
    },
    replace: vi.fn(),
    reloadProfile: vi.fn(),
    acceptTerms: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", () => ({ acceptTerms: state.acceptTerms }));

vi.mock("next/navigation", () => ({
    usePathname: () => state.pathname,
    useRouter: () => ({ replace: state.replace }),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile: state.profile,
        loading: false,
        reloadProfile: state.reloadProfile,
    }),
}));

vi.mock("@/app/components/shared/FullScreenLoader", () => ({
    FullScreenLoader: () => <div>Loading</div>,
}));

describe("OnboardingGate", () => {
    beforeEach(() => {
        state.pathname = "/assistant";
        state.profile = {
            displayName: "Alex",
            onboardingComplete: false,
        };
        state.replace.mockReset();
        state.reloadProfile.mockReset();
        state.acceptTerms.mockReset().mockResolvedValue({});
    });

    it("keeps incomplete users out of the main app", async () => {
        render(
            <OnboardingGate>
                <div>Main app</div>
            </OnboardingGate>,
        );

        expect(screen.queryByText("Main app")).not.toBeInTheDocument();
        await waitFor(() =>
            expect(state.replace).toHaveBeenCalledWith("/onboarding/profile"),
        );
    });

    it.each(["/onboarding/profile", "/onboarding/practice", "/onboarding/invitations", "/onboarding/models"])("allows incomplete users to use %s", (path) => {
        state.pathname = path;
        render(
            <OnboardingGate>
                <div>Profile step</div>
            </OnboardingGate>,
        );

        expect(screen.getByText("Profile step")).toBeInTheDocument();
        expect(state.replace).not.toHaveBeenCalled();
    });

    it("allows users without a display name to continue to practice onboarding", () => {
        state.pathname = "/onboarding/practice";
        state.profile = {
            displayName: null,
            onboardingComplete: false,
        };
        render(
            <OnboardingGate>
                <div>Practice step</div>
            </OnboardingGate>,
        );

        expect(screen.getByText("Practice step")).toBeInTheDocument();
        expect(state.replace).not.toHaveBeenCalled();
    });

    it.each([
        "/login/sso",
        "/reset-password",
        "/forgot-password",
        "/verify-mfa",
    ])(
        "lets incomplete users reach the credential-recovery page %s",
        (path) => {
            state.pathname = path;
            render(
                <OnboardingGate>
                    <div>Recovery page</div>
                </OnboardingGate>,
            );

            expect(screen.getByText("Recovery page")).toBeInTheDocument();
            expect(state.replace).not.toHaveBeenCalled();
        },
    );

    it.each(["/onboarding/practice", "/onboarding/invitations"])("redirects completed users away from %s", async (path) => {
        state.pathname = path;
        state.profile = {
            displayName: "Alex",
            onboardingComplete: true,
        };
        render(
            <OnboardingGate>
                <div>Practice step</div>
            </OnboardingGate>,
        );

        expect(screen.queryByText("Practice step")).not.toBeInTheDocument();
        await waitFor(() =>
            expect(state.replace).toHaveBeenCalledWith("/assistant"),
        );
    });

    describe("Terms acceptance", () => {
        beforeEach(() => {
            state.profile = { displayName: "Alex", onboardingComplete: true, termsRequired: true };
        });

        it("blocks the app until the box is ticked and the Terms are accepted", async () => {
            const user = userEvent.setup();
            render(
                <OnboardingGate>
                    <div>Main app</div>
                </OnboardingGate>,
            );

            expect(screen.queryByText("Main app")).not.toBeInTheDocument();
            const submit = screen.getByRole("button", { name: "Accept and continue" });
            expect(submit).toBeDisabled();
            expect(screen.getAllByRole("link", { name: /Terms/ })[0]).toHaveAttribute("href", "/terminos");

            // The accessible name is the whole sentence, not a cut-off prefix.
            const box = screen.getByRole("checkbox", {
                name: "I have read and accept the Terms and Conditions and the Privacy Notice",
            });
            await user.click(box);
            await user.click(submit);

            expect(state.acceptTerms).toHaveBeenCalledWith("2026-11-12");
            await waitFor(() => expect(state.reloadProfile).toHaveBeenCalled());
        });

        it("keeps the screen when saving fails", async () => {
            state.acceptTerms.mockRejectedValue(new Error("offline"));
            const user = userEvent.setup();
            render(
                <OnboardingGate>
                    <div>Main app</div>
                </OnboardingGate>,
            );

            await user.click(screen.getByRole("checkbox"));
            await user.click(screen.getByRole("button", { name: "Accept and continue" }));

            await waitFor(() => expect(screen.getByRole("button", { name: "Accept and continue" })).toBeEnabled());
            expect(state.reloadProfile).not.toHaveBeenCalled();
        });

        it.each(["/privacidad", "/terminos", "/login"])("leaves %s readable", (path) => {
            state.pathname = path;
            render(
                <OnboardingGate>
                    <div>Public page</div>
                </OnboardingGate>,
            );
            expect(screen.getByText("Public page")).toBeInTheDocument();
        });
    });
});
