import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppearancePage from "./page";

const { updateDarkMode, updateTextSize, profile } = vi.hoisted(() => ({
    updateDarkMode: vi.fn(),
    updateTextSize: vi.fn(),
    profile: { darkMode: false, textSize: "normal" as string | undefined },
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile,
        updateDarkMode,
        updateTextSize,
    }),
}));

describe("AppearancePage", () => {
    beforeEach(() => {
        updateDarkMode.mockReset();
        updateDarkMode.mockResolvedValue(undefined);
        profile.darkMode = false;
        profile.textSize = "normal";
        updateTextSize.mockReset();
        updateTextSize.mockResolvedValue(undefined);
    });

    it("saves dark mode without rendering a decorative card icon", async () => {
        const user = userEvent.setup();
        const { container } = render(<AppearancePage />);

        expect(
            screen.getByRole("heading", { name: "Appearance" }),
        ).toBeVisible();
        expect(screen.getByText("Dark mode")).toBeVisible();
        expect(container.querySelector("svg")).toBeNull();

        const toggle = screen.getByRole("switch", { name: "Dark mode" });
        expect(toggle).toHaveAttribute("aria-checked", "false");

        await user.click(toggle);
        expect(updateDarkMode).toHaveBeenCalledWith(true);
    });

    it("reports a failed change without leaking the raw error", async () => {
        const user = userEvent.setup();
        updateDarkMode.mockRejectedValue(new Error("pg: connection refused"));
        render(<AppearancePage />);

        await user.click(screen.getByRole("switch", { name: "Dark mode" }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Could not update the appearance setting.",
            ),
        );
        expect(screen.queryByText(/connection refused/i)).not.toBeInTheDocument();
    });

    it("offers three text sizes, marks the saved one and says what it does", () => {
        profile.textSize = "large";
        render(<AppearancePage />);

        const group = screen.getByRole("radiogroup", { name: "Text size" });
        expect(group).toBeVisible();
        expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
            "Normal",
            "Large",
            "Very large",
        ]);
        expect(screen.getByRole("radio", { name: "Large" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        expect(screen.getByRole("radio", { name: "Normal" })).toHaveAttribute(
            "aria-checked",
            "false",
        );
        expect(
            screen.getByText(
                "Changes the size of the text in LiTT. You can also use your browser's zoom.",
            ),
        ).toBeVisible();
    });

    it("treats a profile without a saved size as normal", () => {
        profile.textSize = undefined;
        render(<AppearancePage />);
        expect(screen.getByRole("radio", { name: "Normal" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
    });

    it("saves the chosen size, and does nothing when the saved one is clicked", async () => {
        const user = userEvent.setup();
        render(<AppearancePage />);

        await user.click(screen.getByRole("radio", { name: "Normal" }));
        expect(updateTextSize).not.toHaveBeenCalled();

        await user.click(screen.getByRole("radio", { name: "Very large" }));
        expect(updateTextSize).toHaveBeenCalledWith("xlarge");
    });

    it("reports a failed text size change without leaking the raw error", async () => {
        const user = userEvent.setup();
        updateTextSize.mockRejectedValue(new Error("pg: connection refused"));
        render(<AppearancePage />);

        await user.click(screen.getByRole("radio", { name: "Large" }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Could not update the appearance setting.",
            ),
        );
        expect(screen.queryByText(/connection refused/i)).not.toBeInTheDocument();
    });

});
