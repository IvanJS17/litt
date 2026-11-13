import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ResponseStatus, type StatusState } from "./ResponseStatus";

const icon = () => document.querySelector("svg.litt-status-mark") as SVGElement;
const state = () => icon().getAttribute("data-state");

/** Long enough for the "done" animation frame to have fired if it was going to. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

function renderStatus(status: StatusState) {
    const view = render(<ResponseStatus status={status} />);
    return (next: StatusState) =>
        view.rerender(<ResponseStatus status={next} />);
}

describe("ResponseStatus", () => {
    it("shows done when a streaming response finishes", async () => {
        const set = renderStatus("active");
        expect(state()).toBe("working");

        set(null);

        await waitFor(() => expect(state()).toBe("done"));
    });

    it("rests as the idle square before anything is streamed", () => {
        renderStatus(null);
        expect(state()).toBe("idle");
    });

    it("shows the error outline", () => {
        renderStatus("error");
        expect(state()).toBe("error");
    });

    it("stops blinking and shows waiting, not done, while it waits on the user", async () => {
        const set = renderStatus("active");

        set("waiting");
        await settle();

        expect(state()).toBe("waiting");
    });

    it("does not show done on the paused message once the user answers", async () => {
        const set = renderStatus("active");
        set("waiting");
        await settle();

        // Answering settles this message; the reply continues in the next.
        set(null);
        await settle();

        expect(state()).toBe("idle");
    });

    it("shows done when a paused response resumes and then finishes", async () => {
        const set = renderStatus("active");
        set("waiting");
        await settle();
        set("active");
        expect(state()).toBe("working");

        set(null);

        await waitFor(() => expect(state()).toBe("done"));
    });
});
