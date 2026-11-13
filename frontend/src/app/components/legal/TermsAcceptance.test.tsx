import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TermsAcceptance } from "./TermsAcceptance";

const mocks = vi.hoisted(() => ({
    acceptTerms: vi.fn(),
    reloadProfile: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/lib/mikeApi", () => ({ acceptTerms: mocks.acceptTerms }));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ reloadProfile: mocks.reloadProfile }),
}));
vi.mock("@/app/components/site-logo", () => ({ SiteLogo: () => <div>LiTT</div> }));

describe("TermsAcceptance", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.acceptTerms.mockResolvedValue(undefined);
        mocks.reloadProfile.mockResolvedValue(undefined);
    });

    it("keeps the button live and says what is missing until the box is ticked", async () => {
        const user = userEvent.setup();
        render(<TermsAcceptance />);
        const accept = screen.getByRole("button", { name: "Accept and continue" });
        expect(accept).toBeEnabled();

        await user.click(accept);
        expect(await screen.findByRole("alert")).toHaveTextContent("Tick the box to continue.");
        expect(screen.getByRole("checkbox")).toHaveAccessibleDescription("Tick the box to continue.");
        expect(mocks.acceptTerms).not.toHaveBeenCalled();

        await user.click(screen.getByRole("checkbox"));
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        await user.click(accept);
        expect(mocks.acceptTerms).toHaveBeenCalledTimes(1);
    });

    it("ticks the box from anywhere on its row, close to the text", async () => {
        const user = userEvent.setup();
        render(<TermsAcceptance />);
        const row = screen.getByText(/I have read and accept the Terms/i);
        await user.click(row);
        expect(screen.getByRole("checkbox")).toBeChecked();
        // The box sits right beside its words: no wide margin between them.
        expect(screen.getByRole("checkbox").className).not.toMatch(/\bmr-3\b/);
    });
});
