import { describe, expect, it } from "vitest";
import { isStoppedEvent } from "./stoppedEvent";

describe("isStoppedEvent", () => {
    it("recognises the mark and the sentence older answers stored", () => {
        expect(isStoppedEvent({ type: "stopped" })).toBe(true);
        expect(isStoppedEvent({ type: "content", text: "Cancelled by user." })).toBe(true);
    });

    it("leaves ordinary content alone", () => {
        expect(isStoppedEvent({ type: "content", text: "The motion was cancelled by user request." })).toBe(false);
        expect(isStoppedEvent({ type: "reasoning", text: "Cancelled by user." })).toBe(false);
    });
});
