import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import type { Response } from "express";

// The connector sign-in callback only relays to the signed-in gateway; the
// authorization code is redeemed there, for the person who started the flow.
const mocks = vi.hoisted(() => ({
    auth: true,
    mfa: true,
    complete: vi.fn(),
    db: {} as unknown,
}));
vi.mock("../../lib/supabase", () => ({ createServerSupabase: () => mocks.db }));
vi.mock("../../middleware/auth", () => ({
    requireAuth: (_r: unknown, res: Response, next: () => void) => {
        if (!mocks.auth) return void res.status(401).end();
        res.locals.userId = "owner";
        next();
    },
    requireMfaIfEnrolled: (_r: unknown, res: Response, next: () => void) => {
        if (!mocks.mfa)
            return void res
                .status(403)
                .json({ code: "mfa_verification_required" });
        next();
    },
}));
vi.mock("../../lib/mcpConnectors", async (original) => ({
    ...(await original<typeof import("../../lib/mcpConnectors")>()),
    completeUserMcpConnectorOAuth: mocks.complete,
}));
import { app } from "../../app";

beforeEach(() => {
    vi.clearAllMocks();
    mocks.db = {};
    mocks.auth = true;
    mocks.mfa = true;
    vi.stubEnv("FRONTEND_URL", "https://app.mike.test");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

describe("connector OAuth callback", () => {
    it("relays only the OAuth parameters to the fixed signed-in gateway without redeeming the code", async () => {
        mocks.auth = false;
        const relay = await request(app)
            .get("/user/mcp-connectors/oauth/callback")
            .query({ state: "s", code: "c", redirect_uri: "https://other.test" })
            .set("Host", "other.test");
        expect(relay.status).toBe(303);
        expect(relay.headers.location).toBe(
            "https://app.mike.test/api/user/mcp-connectors/oauth/finish?state=s&code=c",
        );
        expect(relay.headers["cache-control"]).toBe("no-store");
        expect(relay.headers["referrer-policy"]).toBe("no-referrer");
        expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("relays a refused consent so the signed-in page can report it", async () => {
        const relay = await request(app)
            .get("/user/mcp-connectors/oauth/callback")
            .query({ state: "s", error: "access_denied" });
        expect(relay.status).toBe(303);
        expect(relay.headers.location).toBe(
            "https://app.mike.test/api/user/mcp-connectors/oauth/finish?state=s&error=access_denied",
        );
    });

    it("completes only behind a session, and only for that session's user", async () => {
        const finish = "/user/mcp-connectors/oauth/finish?state=s&code=c";
        mocks.auth = false;
        expect((await request(app).get(finish)).status).toBe(401);
        mocks.auth = true;
        mocks.mfa = false;
        expect((await request(app).get(finish)).status).toBe(403);
        expect(mocks.complete).not.toHaveBeenCalled();

        mocks.mfa = true;
        mocks.complete.mockResolvedValue({ connectorId: "c1" });
        const done = await request(app).get(finish);
        expect(done.status).toBe(200);
        expect(done.text).toContain('"success":true');
        expect(done.headers["cache-control"]).toBe("no-store");
        expect(mocks.complete).toHaveBeenCalledWith("owner", "s", "c", {});
    });

    it("answers a failed completion with the fixed failure page", async () => {
        mocks.complete.mockRejectedValue(new Error("OAuth state is invalid"));
        const res = await request(app).get(
            "/user/mcp-connectors/oauth/finish?state=s&code=c",
        );
        expect(res.status).toBe(400);
        expect(res.text).toContain("could not be completed");
        expect(res.text).not.toContain("invalid");
        expect(res.headers["cross-origin-opener-policy"]).toBe("unsafe-none");
    });

    it("keeps a </script> breakout in ?error= out of the failure page", async () => {
        const res = await request(app).get(
            "/user/mcp-connectors/oauth/finish?error=" +
                encodeURIComponent("</script><script>evil()</script>"),
        );
        expect(res.status).toBe(400);
        expect(res.text).not.toContain("evil()");
        expect(res.text.match(/<\/script>/g)).toHaveLength(1);
    });
});
