import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AppearancePage from "./page";

const { updateTheme, updateTextSize, profile } = vi.hoisted(() => ({
    updateTheme: vi.fn(),
    updateTextSize: vi.fn(),
    profile: {
        theme: "light" as "light" | "dark" | "system",
        textSize: "normal" as string | undefined,
    },
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({
        profile,
        updateTheme,
        updateTextSize,
    }),
}));

describe("AppearancePage", () => {
    beforeEach(() => {
        updateTheme.mockReset();
        updateTheme.mockResolvedValue(undefined);
        profile.theme = "light";
        profile.textSize = "normal";
        updateTextSize.mockReset();
        updateTextSize.mockResolvedValue(undefined);
    });

    it("offers Light, Dark and Automatic without icons, and says what Automatic does", () => {
        profile.theme = "dark";
        const { container } = render(<AppearancePage />);

        expect(
            screen.getByRole("heading", { name: "Appearance" }),
        ).toBeVisible();
        const group = screen.getByRole("radiogroup", { name: "Theme" });
        expect(
            within(group).getAllByRole("radio").map((r) => r.textContent),
        ).toEqual(["Light", "Dark", "Automatic"]);
        expect(within(group).getByRole("radio", { name: "Dark" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
        expect(
            screen.getByText(
                "Automatic follows your device's theme and changes when it does.",
            ),
        ).toBeVisible();
        expect(screen.queryByRole("switch")).not.toBeInTheDocument();
        expect(container.querySelector("svg")).toBeNull();
    });

    it("saves the chosen theme, and does nothing when the saved one is clicked", async () => {
        const user = userEvent.setup();
        render(<AppearancePage />);
        const group = screen.getByRole("radiogroup", { name: "Theme" });

        await user.click(within(group).getByRole("radio", { name: "Light" }));
        expect(updateTheme).not.toHaveBeenCalled();

        await user.click(within(group).getByRole("radio", { name: "Automatic" }));
        expect(updateTheme).toHaveBeenCalledWith("system");
    });

    it("moves with the arrow keys and saves each choice", async () => {
        const user = userEvent.setup();
        render(<AppearancePage />);
        const group = screen.getByRole("radiogroup", { name: "Theme" });

        within(group).getByRole("radio", { name: "Light" }).focus();
        await user.keyboard("{ArrowRight}");
        expect(updateTheme).toHaveBeenLastCalledWith("dark");
        await user.keyboard("{End}");
        expect(updateTheme).toHaveBeenLastCalledWith("system");
    });

    it("reports a failed change without leaking the raw error", async () => {
        const user = userEvent.setup();
        updateTheme.mockRejectedValue(new Error("pg: connection refused"));
        render(<AppearancePage />);

        await user.click(screen.getByRole("radio", { name: "Dark" }));
        await waitFor(() =>
            expect(screen.getByRole("alert")).toHaveTextContent(
                "Could not update the appearance setting.",
            ),
        );
        expect(screen.queryByText(/connection refused/i)).not.toBeInTheDocument();
        // The control goes back to the saved theme.
        expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute(
            "aria-checked",
            "true",
        );
    });

    it("offers three text sizes, marks the saved one and says what it does", () => {
        profile.textSize = "large";
        render(<AppearancePage />);

        const group = screen.getByRole("radiogroup", { name: "Text size" });
        expect(group).toBeVisible();
        expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual([
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
                "Choose how large text looks in LiTT. This only changes your screen.",
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
