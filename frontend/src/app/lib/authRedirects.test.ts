import { afterEach, describe, expect, it, vi } from "vitest";
import {
    authErrorDescription,
    safeAuthNext,
    safeSameOriginPath,
} from "./authRedirects";

afterEach(() => {
    vi.unstubAllGlobals();
});

const DOT_SEGMENT_INPUTS = [
    "/.//other.example",
    "/..//other.example",
    "/a/..//other.example",
    "/%2e//other.example",
    "/%2E%2E//other.example",
    "/settings/..//other.example/x?y#z",
    "/.///other.example",
];

describe("safeAuthNext", () => {
    it("allows known internal destinations with query parameters", () => {
        expect(safeAuthNext("/settings?emailChange=processed")).toBe(
            "/settings?emailChange=processed",
        );
        expect(safeAuthNext("/reset-password")).toBe("/reset-password");
        expect(safeAuthNext("/onboarding/profile")).toBe("/onboarding/profile");
        expect(safeAuthNext("/onboarding/invitations")).toBe("/onboarding/invitations");
    });

    it("lets an app's connection request come back after sign-in", () => {
        expect(safeAuthNext("/connect/authorize?request=abc_-123")).toBe(
            "/connect/authorize?request=abc_-123",
        );
        expect(safeAuthNext("/connect/other")).toBe("/assistant");
    });

    it.each([
        "assistant",
        "https://evil.example",
        "//evil.example/path",
        "/unknown",
        "/settings\\evil",
        "/settings\n/assistant",
    ])("rejects unsafe destination %s", (candidate) => {
        expect(safeAuthNext(candidate)).toBe("/assistant");
    });

    it.each(DOT_SEGMENT_INPUTS)(
        "keeps to its allowlist for %s",
        (candidate) => {
            expect(safeAuthNext(candidate)).toBe("/assistant");
        },
    );

    it("uses a caller-provided fallback when no destination is supplied", () => {
        expect(safeAuthNext(undefined, "/login")).toBe("/login");
    });
});

describe("safeSameOriginPath", () => {
    it("keeps any page of the application with its query and fragment", () => {
        expect(safeSameOriginPath("/settings?tab=1")).toBe("/settings?tab=1");
        expect(safeSameOriginPath("/projects/p1?tab=files#top")).toBe(
            "/projects/p1?tab=files#top",
        );
    });

    it.each([
        "assistant",
        "https://evil.example",
        "//evil.example",
        "/\\evil.example",
        "/\t/evil.example",
        "/\n/evil.example",
        "/\r/evil.example",
        "javascript:alert(1)",
        "/verify-mfa",
        "/verify-mfa?next=/settings",
        "/verify-mfa/x",
    ])("rejects %j", (candidate) => {
        expect(safeSameOriginPath(candidate)).toBe("/assistant");
    });

    it.each(DOT_SEGMENT_INPUTS)(
        "never returns a scheme-relative path for %s",
        (candidate) => {
            const result = safeSameOriginPath(candidate);
            expect(result).toBe("/assistant");
            expect(result.startsWith("//")).toBe(false);
        },
    );

    it("keeps a dotted path that stays on a single slash", () => {
        expect(safeSameOriginPath("/a/./b?x=1#h")).toBe("/a/b?x=1#h");
    });

    it("uses the caller's fallback when nothing is supplied", () => {
        expect(safeSameOriginPath(null, "/login")).toBe("/login");
    });
});

describe("authErrorDescription", () => {
    it("reads provider errors from query parameters or implicit-flow hashes", () => {
        expect(
            authErrorDescription("?error_description=Expired+link", ""),
        ).toBe("This confirmation link is invalid or has expired.");
        expect(
            authErrorDescription("", "#error=access_denied"),
        ).toBe("Authentication was cancelled or denied.");
        expect(authErrorDescription("?error=query_error", "")).toBe(
            "Authentication could not be completed. Please try again.",
        );
        expect(
            authErrorDescription("", "#error_description=Invalid+request"),
        ).toBe("This confirmation link is invalid or has expired.");
        expect(authErrorDescription("", "")).toBeNull();
    });
});
