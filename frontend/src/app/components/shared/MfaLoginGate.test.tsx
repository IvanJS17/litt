import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MfaLoginGate } from "./MfaLoginGate";

const { replace, searchParams, needsMfaVerification, nav } = vi.hoisted(() => ({
    replace: vi.fn(),
    searchParams: new URLSearchParams(),
    needsMfaVerification: vi.fn(),
    nav: { pathname: "/verify-mfa" },
}));

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace }),
    usePathname: () => nav.pathname,
    useSearchParams: () => searchParams,
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { mfaOnLogin: true }, loading: false }),
}));
vi.mock("../popups/MfaVerificationPopup", () => ({ needsMfaVerification }));

describe("MfaLoginGate", () => {
    beforeEach(() => {
        replace.mockReset();
        needsMfaVerification.mockReset();
        window.sessionStorage.clear();
        for (const key of [...searchParams.keys()]) searchParams.delete(key);
        nav.pathname = "/verify-mfa";
    });

    it.each([
        ["/\\evil.test", "/assistant"],
        ["/\t/evil.test", "/assistant"],
        ["//evil.test", "/assistant"],
        ["/.//other.example", "/assistant"],
        ["/..//other.example", "/assistant"],
        ["/a/..//other.example", "/assistant"],
        ["/%2e//other.example", "/assistant"],
        ["/%2E%2E//other.example", "/assistant"],
        ["/settings/..//other.example/x?y#z", "/assistant"],
        ["/.///other.example", "/assistant"],
        ["javascript:alert(1)", "/assistant"],
        ["/settings?tab=1", "/settings?tab=1"],
    ])("leaves the verify page for %j as %s", async (next, expected) => {
        searchParams.set("next", next);
        needsMfaVerification.mockResolvedValue(false);
        render(<MfaLoginGate>content</MfaLoginGate>);

        await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
        expect(replace).toHaveBeenCalledWith(expected);
    });

    it("sends a protected page to the verify page and keeps its address", async () => {
        nav.pathname = "/projects/p1";
        searchParams.set("tab", "files");
        needsMfaVerification.mockResolvedValue(true);
        render(<MfaLoginGate>content</MfaLoginGate>);

        await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
        expect(replace).toHaveBeenCalledWith(
            `/verify-mfa?next=${encodeURIComponent("/projects/p1?tab=files")}`,
        );
    });
});
