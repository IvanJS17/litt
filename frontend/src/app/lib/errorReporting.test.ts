import { afterEach, describe, expect, it, vi } from "vitest";
import {
    isReported,
    markErrorHandled,
    reportApiFailure,
    reportError,
    reportNetworkFailure,
    setReportingUser,
    trackPendingRequest,
} from "./errorReporting";

describe("errorReporting (local only, no third-party telemetry)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("marks each reported failure as handled and sends nothing", () => {
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        const reported = new Error("a");
        const handled = new Error("b");
        const api = new Error("c");
        const network = new Error("d");

        expect(reportError(reported, { tags: { operation: "x" } })).toBeNull();
        markErrorHandled(handled);
        expect(
            reportApiFailure({ path: "/x", status: 500, error: api }),
        ).toBeNull();
        expect(
            reportNetworkFailure(network, { method: "GET", url: "/x" }),
        ).toBeNull();
        setReportingUser({ id: "u1" });
        const release = trackPendingRequest();
        release();

        for (const error of [reported, handled, api, network]) {
            expect(isReported(error)).toBe(true);
        }
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("never treats primitives or unseen errors as reported", () => {
        reportError("text");
        expect(isReported("text")).toBe(false);
        expect(isReported(null)).toBe(false);
        expect(isReported(new Error("unseen"))).toBe(false);
    });
});
