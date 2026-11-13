import { act, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    MAX_VISIBLE_TOASTS,
    focusToast,
    ToastViewportUI,
    clearToasts,
    dismissToast,
    dismissToastsWithKey,
    showToast,
} from "./ToastUI";

describe("ToastUI", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        clearToasts();
    });
    afterEach(() => {
        clearToasts();
        vi.useRealTimers();
    });

    it("renders an error toast as an alert with title, message and dismiss", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                title: "Couldn't save the document",
                message: "Mike couldn't reach the server.",
            });
        });
        const alert = screen.getByRole("alert");
        expect(alert).toHaveTextContent("Couldn't save the document");
        expect(alert).toHaveTextContent("Mike couldn't reach the server.");
        expect(alert).toHaveClass("liquid-glass-float");

        fireEvent.click(
            screen.getByRole("button", { name: "Dismiss notification" }),
        );
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("runs a Retry action and closes the toast", async () => {
        const onRetry = vi.fn();
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                actions: [{ label: "Retry", onClick: onRetry }],
            });
        });
        fireEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(onRetry).toHaveBeenCalledOnce();
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("links Contact support to the given href", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:soporte@asteroitt.com?subject=x",
            });
        });
        const link = screen.getByRole("link", { name: "Contact support" });
        expect(link).toHaveAttribute("href", "mailto:soporte@asteroitt.com?subject=x");
    });

    it("keeps an error with actions until dismissed but auto-dismisses success", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Sticky",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
            showToast({ tone: "success", message: "Saved" });
        });
        const plain = '[data-testid="toast"]:not([role="alert"])';
        expect(document.querySelector(plain)).toHaveTextContent("Saved");
        act(() => {
            vi.advanceTimersByTime(4_100);
        });
        expect(document.querySelector(plain)).toBeNull();
        act(() => {
            vi.advanceTimersByTime(60_000);
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Sticky");
    });

    it("auto-dismisses a plain error toast after its duration", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "error", message: "Plain" });
        });
        expect(screen.getByRole("alert")).toBeVisible();
        act(() => {
            vi.advanceTimersByTime(10_100);
        });
        expect(screen.queryByRole("alert")).toBeNull();
    });

    it("pauses the timer while hovered", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "info", message: "Hover me" });
        });
        const toast = screen.getByTestId("toast");
        fireEvent.mouseEnter(toast);
        act(() => {
            vi.advanceTimersByTime(20_000);
        });
        expect(screen.getByTestId("toast")).toBeVisible();
        fireEvent.mouseLeave(toast);
        act(() => {
            vi.advanceTimersByTime(6_000);
        });
        expect(screen.queryByTestId("toast")).toBeNull();
    });

    it("keeps a timed toast while keyboard focus remains after the pointer leaves", () => {
        render(<ToastViewportUI />);
        act(() => { showToast({ message: "Read this", durationMs: 2000 }); });
        const toast = screen.getByTestId("toast");
        const dismiss = screen.getByRole("button", { name: "Dismiss notification" });
        fireEvent.mouseEnter(toast);
        fireEvent.focus(dismiss);
        fireEvent.mouseLeave(toast);
        act(() => { vi.advanceTimersByTime(10000); });
        expect(toast).toBeVisible();
        fireEvent.blur(dismiss, { relatedTarget: document.body });
        act(() => { vi.advanceTimersByTime(2100); });
        expect(screen.queryByTestId("toast")).toBeNull();
    });

    it("replaces toasts that share a dedupe key", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ tone: "error", message: "First", dedupeKey: "poll" });
            showToast({ tone: "error", message: "Second", dedupeKey: "poll" });
        });
        const alerts = screen.getAllByRole("alert");
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toHaveTextContent("Second");
    });

    it("drops the oldest toast beyond the visible maximum", () => {
        render(<ToastViewportUI />);
        act(() => {
            for (let i = 0; i < MAX_VISIBLE_TOASTS + 2; i += 1) {
                showToast({ tone: "info", message: `Toast ${i}` });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Toast 2");
    });

    it("evicts chatter before an error the user still has to act on", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({
                tone: "error",
                message: "Upload failed",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
            for (let i = 0; i < MAX_VISIBLE_TOASTS; i += 1) {
                showToast({ tone: "success", message: `Saved ${i}` });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Upload failed");
        expect(
            screen.getByRole("button", { name: "Retry" }),
        ).toBeInTheDocument();
        // The oldest success was dropped in its place.
        expect(screen.queryByText("Saved 0")).toBeNull();
    });

    it("falls back to the oldest when every toast is actionable", () => {
        render(<ToastViewportUI />);
        act(() => {
            for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i += 1) {
                showToast({
                    tone: "error",
                    message: `Error ${i}`,
                    actions: [{ label: "Retry", onClick: () => {} }],
                });
            }
        });
        const items = screen.getAllByTestId("toast");
        expect(items).toHaveLength(MAX_VISIBLE_TOASTS);
        expect(items[0]).toHaveTextContent("Error 1");
    });

    it("dismissToast ignores unknown ids", () => {
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "x" });
            dismissToast("nope");
        });
        expect(screen.getByTestId("toast")).toBeVisible();
        act(() => {
            dismissToast(id);
        });
        expect(screen.queryByTestId("toast")).toBeNull();
    });

    it("dismissToastsWithKey removes only the toast raised with that key", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ message: "session", dedupeKey: "auth-session" });
            showToast({ message: "other" });
        });
        act(() => {
            dismissToastsWithKey("auth-session");
            dismissToastsWithKey("unknown");
        });
        expect(screen.queryByText("session")).toBeNull();
        expect(screen.getByTestId("toast")).toHaveTextContent("other");
    });

    it("labels the viewport as a region; an error card is the alert, other text goes to the live region", () => {
        render(<ToastViewportUI />);
        const region = screen.getByRole("region", { name: "Notifications" });
        // A live region wrapping live items is announced twice, or not at all.
        expect(region).not.toHaveAttribute("aria-live");
        act(() => {
            showToast({ tone: "error", message: "Failed" });
            showToast({ tone: "info", message: "FYI" });
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Failed");
        expect(
            document.querySelector('[data-testid="toast"]:not([role="alert"])'),
        ).toHaveTextContent("FYI");
    });

    it("does not steal focus, but focusToast can move it to a toast", () => {
        render(
            <>
                <button type="button">Elsewhere</button>
                <ToastViewportUI />
            </>,
        );
        const outside = screen.getByRole("button", { name: "Elsewhere" });
        outside.focus();
        let id = "";
        act(() => {
            id = showToast({
                tone: "error",
                message: "Failed",
                actions: [{ label: "Retry", onClick: () => {} }],
            });
        });
        expect(document.activeElement).toBe(outside);

        let moved = false;
        act(() => {
            moved = focusToast(id);
        });
        expect(moved).toBe(true);
        expect(document.activeElement).toBe(screen.getByRole("alert"));
        expect(screen.getByRole("alert")).toHaveAttribute("tabindex", "-1");

        act(() => {
            dismissToast(id);
        });
        expect(focusToast(id)).toBe(false);
    });

    it("never gives two actions on one toast the same look", () => {
        render(<ToastViewportUI />);
        const looks = (labels: string[]) =>
            labels.map((name) => {
                const node =
                    screen.queryByRole("link", { name }) ??
                    screen.getByRole("button", { name });
                if (node.className.includes("bg-gray-950/88")) return "black";
                if (node.className.includes("liquid-glass-flat")) return "white";
                return "text";
            });

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support"])).toEqual(["black"]);

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                actions: [{ label: "Retry", onClick: () => {} }],
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support", "Retry"])).toEqual(["white", "black"]);

        act(() => {
            showToast({
                tone: "error",
                message: "Failed",
                supportHref: "mailto:support@example.com",
                actions: [
                    { label: "Retry", onClick: () => {} },
                    { label: "Sign in", onClick: () => {} },
                ],
                dedupeKey: "looks",
            });
        });
        expect(looks(["Contact support", "Retry", "Sign in"])).toEqual([
            "text",
            "white",
            "black",
        ]);
    });

    it("keeps a polite live region from the start and writes a success or info text into it", () => {
        render(<ToastViewportUI />);
        const live = screen.getByRole("status");
        expect(live).toHaveAttribute("aria-live", "polite");
        expect(live).toBeEmptyDOMElement();
        act(() => {
            showToast({ tone: "success", title: "Saved", message: "All changes." });
        });
        // The same element, now with the text; the card itself is no live region.
        expect(screen.getByRole("status")).toBe(live);
        expect(live).toHaveTextContent("Saved. All changes.");
        expect(screen.getByTestId("toast")).not.toHaveAttribute("role");
        // An error keeps its own assertive alert and stays out of the polite region.
        act(() => {
            showToast({ tone: "error", message: "Failed" });
        });
        expect(live).not.toHaveTextContent("Failed");
        expect(screen.getByRole("alert")).toHaveTextContent("Failed");
    });

    it("clears the live region when its toast goes", () => {
        render(<ToastViewportUI />);
        act(() => {
            showToast({ message: "Copied" });
        });
        expect(screen.getByRole("status")).toHaveTextContent("Copied");
        act(() => {
            vi.advanceTimersByTime(6_000);
        });
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("keeps a dismissed toast for its 150 ms fade-out when motion is allowed", () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(prefers-reduced-motion: no-preference)",
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => false,
        }));
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Bye", durationMs: null });
        });
        act(() => {
            dismissToast(id);
        });
        const leaving = screen.getByTestId("toast");
        expect(leaving).toHaveAttribute("data-leaving");
        // Its buttons are out of reach while it fades: no second click.
        expect(leaving).toHaveAttribute("inert");
        expect(leaving).toHaveAttribute("aria-hidden", "true");
        expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
        act(() => {
            vi.advanceTimersByTime(150);
        });
        expect(screen.queryByTestId("toast")).toBeNull();
        vi.unstubAllGlobals();
    });

    it("replaces a fading toast at once when its key is raised again", () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(prefers-reduced-motion: no-preference)",
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => false,
        }));
        render(<ToastViewportUI />);
        let id = "";
        act(() => {
            id = showToast({ message: "Failed", dedupeKey: "turn", durationMs: null });
        });
        act(() => {
            dismissToast(id);
        });
        expect(screen.getByTestId("toast")).toHaveAttribute("data-leaving");
        act(() => {
            showToast({ message: "Failed", dedupeKey: "turn", durationMs: null });
        });
        const cards = screen.getAllByTestId("toast");
        expect(cards).toHaveLength(1);
        expect(cards[0]).not.toHaveAttribute("data-leaving");
        vi.unstubAllGlobals();
    });
});
