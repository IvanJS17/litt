import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthFormError } from "./AuthFormError";

describe("AuthFormError", () => {
    it("announces the title and message as one alert, in the flow", () => {
        render(<AuthFormError title="Couldn't log in" message="Wrong password." />);
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("Couldn't log in");
        expect(alert).toHaveTextContent("Wrong password.");
        // Never a floating notice: no fixed position, no portal.
        expect(alert.className).not.toMatch(/\bfixed\b/);
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("offers Retry and Contact support only when given", async () => {
        const onRetry = vi.fn();
        const onDismiss = vi.fn();
        render(
            <AuthFormError
                title="Couldn't log in"
                message="Something went wrong on our side."
                retry={{ label: "Retry", onClick: onRetry }}
                supportHref="mailto:support@example.com"
                onDismiss={onDismiss}
            />,
        );
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledOnce();
        expect(screen.getByRole("link", { name: "Contact support" })).toHaveAttribute(
            "href",
            "mailto:support@example.com",
        );
        const dismiss = screen.getByRole("button", { name: "Dismiss warning" });
        // Inside a form, a button that is not the submit must not submit it.
        expect(dismiss).toHaveAttribute("type", "button");
        expect(screen.getByRole("button", { name: "Retry" })).toHaveAttribute(
            "type",
            "button",
        );
        await userEvent.click(dismiss);
        expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("disables Retry while a retry is running", () => {
        render(
            <AuthFormError
                message="Offline."
                retry={{ label: "Retrying...", onClick: () => {}, disabled: true }}
            />,
        );
        expect(screen.getByRole("button", { name: "Retrying..." })).toBeDisabled();
    });
});
