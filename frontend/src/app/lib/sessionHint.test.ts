import { describe, expect, it } from "vitest";
import { hasSessionCookie } from "./sessionHint";

describe("hasSessionCookie", () => {
    it.each([
        ["mike-session"],
        ["__Host-mike-session"],
        ["__Host-mike-session.0"],
        ["mike-session.1"],
        ["mike-session-code-verifier"],
    ])("sees %s", (name) => {
        expect(hasSessionCookie(["LITT_LOCALE", name])).toBe(true);
    });

    it.each([[[]], [["LITT_LOCALE"]], [["other-mike-session"]], [["__Host-mike-sessions"]]])(
        "does not see a session in %j",
        (names) => {
            expect(hasSessionCookie(names)).toBe(false);
        },
    );
});
