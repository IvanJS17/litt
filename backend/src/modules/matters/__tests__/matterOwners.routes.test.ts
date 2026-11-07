import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const MATTER = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";

vi.mock("../../../middleware/auth", () => ({
  requireAuth: (
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    res.locals.userId = ACTOR;
    next();
  },
  requireMfaIfEnrolled: (
    _req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => next(),
}));

vi.mock("../../../lib/supabase", () => ({
  createServerSupabase: vi.fn(() => ({ rpc })),
}));

import { mattersRouter } from "../matters.routes";

function app() {
  const server = express();
  server.use(express.json());
  server.use("/matters", mattersRouter);
  return server;
}

beforeEach(() => rpc.mockReset());

describe("GET /matters/without-owner", () => {
  it("lists the firm's matters without an owner, with no title", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          matter_id: MATTER,
          cm_number: "CM-7",
          visibility: "private",
          created_at: "2026-11-07T10:00:00+00:00",
          last_owner_user_id: TARGET,
          last_owner_display_name: "Former partner",
          last_owner_email: "former@example.test",
          member_count: 0,
          name: "must never be forwarded",
        },
      ],
      error: null,
    });
    const res = await request(app()).get(`/matters/without-owner?org=${ORG}`);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("list_matters_without_owner", {
      p_actor_id: ACTOR,
      p_org_id: ORG,
    });
    expect(res.body).toEqual({
      matters: [
        {
          matter_id: MATTER,
          cm_number: "CM-7",
          visibility: "private",
          created_at: "2026-11-07T10:00:00+00:00",
          last_owner: {
            user_id: TARGET,
            display_name: "Former partner",
            email: "former@example.test",
          },
          member_count: 0,
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toContain("must never be forwarded");
  });

  it("refuses a malformed organization without asking the database", async () => {
    const res = await request(app()).get("/matters/without-owner?org=nope");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_request");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 403 to a member who is neither owner nor admin", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "raw sql" } });
    const res = await request(app()).get(`/matters/without-owner?org=${ORG}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain("raw sql");
  });
});

describe("POST /matters/:id/owner", () => {
  it("names the owner through the database function", async () => {
    rpc.mockResolvedValue({
      data: { matter_id: MATTER, owner_user_id: TARGET, changed: true },
      error: null,
    });
    const res = await request(app())
      .post(`/matters/${MATTER}/owner`)
      .send({ user_id: TARGET });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("assign_matter_owner", {
      p_actor_id: ACTOR,
      p_matter_id: MATTER,
      p_target_user_id: TARGET,
    });
    expect(res.body).toEqual({ matter_id: MATTER, owner_user_id: TARGET, changed: true });
  });

  it.each([
    ["P0002", 404, "not_found"],
    ["42501", 403, undefined],
    ["22023", 400, "matter_owner_target_invalid"],
  ])("maps SQLSTATE %s to %i", async (sqlstate, status, code) => {
    rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: "raw sql" } });
    const res = await request(app())
      .post(`/matters/${MATTER}/owner`)
      .send({ user_id: TARGET });
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toContain("raw sql");
  });

  it("refuses a body without a user id", async () => {
    const res = await request(app()).post(`/matters/${MATTER}/owner`).send({});
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("hides a malformed matter id", async () => {
    const res = await request(app())
      .post("/matters/nope/owner")
      .send({ user_id: TARGET });
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
