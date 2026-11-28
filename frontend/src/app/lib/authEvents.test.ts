import { afterEach, describe, expect, it, vi } from "vitest";
import {
    authenticatedFetch,
    AUTH_SESSION_INVALIDATED_EVENT,
    TERMS_ACCEPTANCE_REQUIRED_EVENT,
} from "./authEvents";

describe("authenticatedFetch", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("always includes cookies and invalidates auth after a 401", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValue(new Response(null, { status: 401 }));
        const listener = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, listener);

        await authenticatedFetch("/api/projects", { credentials: "omit" });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/projects",
            expect.objectContaining({ credentials: "include" }),
        );
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, listener);
    });

    it("does not invalidate auth for successful responses", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
        );
        const listener = vi.fn();
        window.addEventListener(AUTH_SESSION_INVALIDATED_EVENT, listener);

        await authenticatedFetch("/api/projects");

        expect(listener).not.toHaveBeenCalled();
        window.removeEventListener(AUTH_SESSION_INVALIDATED_EVENT, listener);
    });

    it("announces a refusal for the Terms, and leaves the body readable", async () => {
        const refusal = new Response(
            JSON.stringify({ code: "terms_acceptance_required", detail: "Accept." }),
            { status: 403 },
        );
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refusal));
        const listener = vi.fn();
        window.addEventListener(TERMS_ACCEPTANCE_REQUIRED_EVENT, listener);

        const response = await authenticatedFetch("/api/projects");

        expect(listener).toHaveBeenCalledTimes(1);
        expect((await response.json()).code).toBe("terms_acceptance_required");
        window.removeEventListener(TERMS_ACCEPTANCE_REQUIRED_EVENT, listener);
    });

    it("stays quiet for any other 403, readable or not", async () => {
        const listener = vi.fn();
        window.addEventListener(TERMS_ACCEPTANCE_REQUIRED_EVENT, listener);
        for (const body of [JSON.stringify({ code: "mfa_verification_required" }), "not json"]) {
            vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 403 })));
            await authenticatedFetch("/api/projects");
        }
        expect(listener).not.toHaveBeenCalled();
        window.removeEventListener(TERMS_ACCEPTANCE_REQUIRED_EVENT, listener);
    });
});
