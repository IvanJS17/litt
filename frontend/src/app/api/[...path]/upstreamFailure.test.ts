import { describe, expect, it } from "vitest";
import { upstreamUnreachableCode } from "./upstreamFailure";

describe("upstreamUnreachableCode", () => {
    it("finds the connect code under fetch's cause and AggregateError entries", () => {
        const entry = Object.assign(new Error("connect ECONNREFUSED ::1:3001"), { code: "ECONNREFUSED" });
        const error = new TypeError("fetch failed", { cause: new AggregateError([entry], "") });
        expect(upstreamUnreachableCode(error)).toBe("ECONNREFUSED");
    });

    it("reads undici's own connect codes", () => {
        const error = new TypeError("fetch failed", {
            cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }),
        });
        expect(upstreamUnreachableCode(error)).toBe("UND_ERR_CONNECT_TIMEOUT");
    });

    it("is null for anything that is not a connection-level failure", () => {
        // A backend that answered late is up; a bare fetch failure has no cause.
        const slow = new TypeError("fetch failed", {
            cause: Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" }),
        });
        expect(upstreamUnreachableCode(slow)).toBeNull();
        expect(upstreamUnreachableCode(new TypeError("fetch failed"))).toBeNull();
        expect(upstreamUnreachableCode(new Error("API_BASE_URL is required at runtime."))).toBeNull();
        expect(upstreamUnreachableCode(undefined)).toBeNull();
    });

    it("survives host objects with throwing accessors", () => {
        const hostile = {
            get code(): string {
                throw new Error("private accessor");
            },
        };
        expect(upstreamUnreachableCode(hostile)).toBeNull();
        // A nested cause is still walked after a hostile sibling.
        const wrapped = new TypeError("fetch failed", {
            cause: Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" }),
        });
        expect(upstreamUnreachableCode({ ...wrapped, cause: wrapped.cause })).toBe("ECONNRESET");
    });
});
