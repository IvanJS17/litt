import { useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceRoom } from "./useWorkspaceRoom";

function Workspace() {
    const ref = useRef<HTMLDivElement>(null);
    const room = useWorkspaceRoom(ref);
    return <div ref={ref} data-room={room ?? "unknown"} />;
}

describe("useWorkspaceRoom", () => {
    let container: HTMLDivElement;
    let root: Root | null = null;
    let width: ReturnType<typeof vi.spyOn>;
    let observed: ResizeObserverCallback | null;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.append(container);
        width = vi
            .spyOn(HTMLElement.prototype, "clientWidth", "get")
            .mockReturnValue(690);
        observed = null;
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(callback: ResizeObserverCallback) {
                    observed = callback;
                }
                observe() {}
                disconnect() {}
            },
        );
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        container.remove();
        width.mockRestore();
        vi.unstubAllGlobals();
    });

    // Measured after paint, a tablet first painted three panels side by side
    // and then swapped them for one: a visible flash on every load.
    it("decides the room before the first paint", () => {
        const previous = (
            globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
        ).IS_REACT_ACT_ENVIRONMENT;
        (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
            .IS_REACT_ACT_ENVIRONMENT = false;
        try {
            root = createRoot(container);
            // flushSync commits and runs layout effects, not passive ones:
            // what it leaves in the DOM is what the browser paints first.
            flushSync(() => root!.render(<Workspace />));
            expect(container.firstElementChild).toHaveAttribute(
                "data-room",
                "single",
            );
        } finally {
            (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
                .IS_REACT_ACT_ENVIRONMENT = previous;
        }
    });

    it("follows the workspace as it is resized", () => {
        act(() => {
            root = createRoot(container);
            root.render(<Workspace />);
        });
        const element = container.firstElementChild!;
        expect(element).toHaveAttribute("data-room", "single");

        width.mockReturnValue(900);
        act(() => observed!([], {} as ResizeObserver));
        expect(element).toHaveAttribute("data-room", "split");

        width.mockReturnValue(1200);
        act(() => observed!([], {} as ResizeObserver));
        expect(element).toHaveAttribute("data-room", "splitWithSideChat");
    });

    it("waits for a laid-out workspace", () => {
        width.mockReturnValue(0);
        act(() => {
            root = createRoot(container);
            root.render(<Workspace />);
        });
        expect(container.firstElementChild).toHaveAttribute(
            "data-room",
            "unknown",
        );
    });
});
