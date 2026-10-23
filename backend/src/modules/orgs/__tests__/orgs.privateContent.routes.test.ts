import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), personal: false }));
vi.mock("../../../lib/supabase", () => ({ createServerSupabase: () => ({ rpc: mocks.rpc }) }));
vi.mock("../../../lib/personalOrgs", () => ({ isPersonalOrg: async () => mocks.personal }));
vi.mock("../../../middleware/auth", () => ({
    requireAuth: (_req: unknown, res: { locals: Record<string, unknown> }, next: () => void) => { res.locals.userId = "authenticated-actor"; next(); },
    requireMfaIfEnrolled: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import { orgsRouter } from "../orgs.routes";
const app = express(); app.use(express.json()); app.use("/orgs", orgsRouter);
const itemId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { mocks.personal = false; mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null }); });
describe("private content HTTP boundary", () => {
    // LiTT C2 (docs/UPSTREAM_SYNC_PLAN.md §3, §4.2): organization owners and
    // admins get no standing access to members' private content, so the
    // administrative private-content routes answer 405 without any RPC.
    const ROUTES = [
        ["get", "/orgs/org/private-content"],
        ["put", `/orgs/org/members/${itemId}/private-content-permission`],
        ["post", `/orgs/org/private-content/document/${itemId}/open`],
        ["delete", `/orgs/org/private-content/document/${itemId}`],
    ] as const;
    it.each(ROUTES)("%s %s answers 405 before any private-content RPC", async (method, path) => {
        const response = await request(app)[method](path).send({ enabled: true });
        expect(response.status).toBe(405);
        expect(response.body).toEqual({ detail: "Not supported" });
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
    it("denies personal workspaces before any private-content RPC", async () => {
        mocks.personal = true;
        await request(app).get("/orgs/personal/private-content").expect(404);
        await request(app).post(`/orgs/personal/private-content/document/${itemId}/open`).expect(404);
        expect(mocks.rpc).not.toHaveBeenCalled();
    });
});
