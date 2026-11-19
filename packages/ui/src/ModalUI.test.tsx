import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModalUI } from "./ModalUI";

describe("ModalUI", () => {
    it("renders shared modal chrome, content, and action slots", async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(
            <ModalUI
                open
                onClose={onClose}
                breadcrumbs={["Documents", "Add documents"]}
                ariaLabel="Add documents"
                primaryAction={<button type="button">Confirm</button>}
            >
                <p>Select documents</p>
            </ModalUI>,
        );

        expect(
            screen.getByRole("dialog", { name: "Add documents" }),
        ).toHaveClass("liquid-glass-modal");
        expect(screen.getByText("Select documents")).toBeVisible();
        expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Close" }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("closes on Escape", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                Content
            </ModalUI>,
        );

        fireEvent.keyDown(window, { key: "Escape" });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("leaves Escape to a control inside the dialog that handled it", () => {
        const onClose = vi.fn();

        render(
            <ModalUI open onClose={onClose} ariaLabel="Example">
                <input
                    aria-label="Search"
                    onKeyDown={(event) => {
                        if (event.key === "Escape") event.preventDefault();
                    }}
                />
            </ModalUI>,
        );

        fireEvent.keyDown(screen.getByRole("textbox", { name: "Search" }), {
            key: "Escape",
        });
        expect(onClose).not.toHaveBeenCalled();
    });
});

describe("ModalUI focus on a touch screen", () => {
    const stubPointer = (coarse: boolean) =>
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: coarse && query === "(pointer: coarse)",
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => false,
        }));
    afterEach(() => vi.unstubAllGlobals());

    const renderRename = () =>
        render(
            <ModalUI open onClose={() => {}} ariaLabel="Rename">
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input aria-label="Title" autoFocus />
            </ModalUI>,
        );

    it("does not leave a text field focused (the keyboard would open) with a finger", async () => {
        stubPointer(true);
        renderRename();
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(screen.getByLabelText("Title")).not.toHaveFocus();
        expect(screen.getByRole("dialog")).toHaveFocus();
    });

    it("still focuses the field with a mouse", async () => {
        stubPointer(false);
        renderRename();
        await new Promise((resolve) => requestAnimationFrame(resolve));

        expect(screen.getByLabelText("Title")).toHaveFocus();
    });
});

describe("ModalUI makes the page behind inert", () => {
    it("sets inert on the other body children while open and restores them on close", () => {
        const page = document.createElement("div");
        const alreadyInert = document.createElement("div");
        alreadyInert.setAttribute("inert", "");
        const toasts = document.createElement("div");
        toasts.setAttribute("aria-live", "polite");
        document.body.append(page, alreadyInert, toasts);
        try {
            const { rerender } = render(
                <ModalUI open onClose={vi.fn()} ariaLabel="Example">
                    <button type="button">Inside</button>
                </ModalUI>,
            );
            const dialog = screen.getByRole("dialog", { name: "Example" });
            expect(page).toHaveAttribute("inert");
            expect(toasts).not.toHaveAttribute("inert");
            expect(dialog.closest("[inert]")).toBeNull();

            rerender(
                <ModalUI open={false} onClose={vi.fn()} ariaLabel="Example">
                    <button type="button">Inside</button>
                </ModalUI>,
            );
            expect(page).not.toHaveAttribute("inert");
            // What was inert before the modal stays inert.
            expect(alreadyInert).toHaveAttribute("inert");
        } finally {
            page.remove();
            alreadyInert.remove();
            toasts.remove();
        }
    });

    it("restores the page when the modal unmounts, and leaves a modal under another as it found it", () => {
        const page = document.createElement("div");
        document.body.append(page);
        try {
            const first = render(
                <ModalUI open onClose={vi.fn()} ariaLabel="First">
                    one
                </ModalUI>,
            );
            const second = render(
                <ModalUI open onClose={vi.fn()} ariaLabel="Second">
                    two
                </ModalUI>,
            );
            expect(page).toHaveAttribute("inert");
            expect(screen.getByRole("dialog", { name: "Second" }).closest("[inert]")).toBeNull();
            second.unmount();
            expect(page).toHaveAttribute("inert");
            expect(screen.getByRole("dialog", { name: "First" }).closest("[inert]")).toBeNull();
            first.unmount();
            expect(page).not.toHaveAttribute("inert");
        } finally {
            page.remove();
        }
    });
});

describe("ModalUI as a bottom sheet", () => {
    const stubPhone = (reduceMotion = false) =>
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches:
                query === "(max-width: 767px)" ||
                (query === "(prefers-reduced-motion: no-preference)" && !reduceMotion),
            media: query,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            onchange: null,
            dispatchEvent: () => false,
        }));
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("is a plain dialog unless asked (the Word task pane)", () => {
        render(
            <ModalUI open onClose={() => {}} ariaLabel="Plain">
                Content
            </ModalUI>,
        );
        expect(screen.getByRole("dialog")).not.toHaveClass("modal-sheet");
        expect(document.querySelector('[data-slot="modal-grabber"]')).toBeNull();
    });

    it("adds the grabber, the dvh cap and the safe-area inset", () => {
        render(
            <ModalUI open sheet onClose={() => {}} ariaLabel="Sheet">
                Content
            </ModalUI>,
        );
        const dialog = screen.getByRole("dialog");
        expect(dialog).toHaveClass("modal-sheet", "max-md:rounded-b-none");
        expect(dialog.className).toContain("100dvh");
        expect(dialog.className).toContain("safe-area-inset-bottom");
        expect(document.querySelector('[data-slot="modal-grabber"]')).not.toBeNull();
    });

    it("stays mounted for the 180 ms exit on a phone, then unmounts", () => {
        vi.useFakeTimers();
        stubPhone();
        const { rerender } = render(
            <ModalUI open sheet onClose={() => {}} ariaLabel="Sheet">
                Content
            </ModalUI>,
        );
        rerender(
            <ModalUI open={false} sheet onClose={() => {}} ariaLabel="Sheet">
                Content
            </ModalUI>,
        );
        expect(document.querySelector('[data-state="closed"]')).not.toBeNull();
        act(() => {
            vi.advanceTimersByTime(180);
        });
        expect(document.querySelector('[data-state="closed"]')).toBeNull();
    });

    it("unmounts at once with Reduce motion", () => {
        stubPhone(true);
        const { rerender } = render(
            <ModalUI open sheet onClose={() => {}} ariaLabel="Sheet">
                Content
            </ModalUI>,
        );
        rerender(
            <ModalUI open={false} sheet onClose={() => {}} ariaLabel="Sheet">
                Content
            </ModalUI>,
        );
        expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    });
});
