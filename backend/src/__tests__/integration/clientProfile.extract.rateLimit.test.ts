import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Row } from "../helpers/memoryDb";

// One run is one model call on the person's key with a whole document in it:
// the lane is per person, not per address, and a refusal costs nothing.
const h = vi.hoisted(() => {
    process.env.RATE_LIMIT_PROFILE_EXTRACT_MAX = "3";
    process.env.RATE_LIMIT_PROFILE_EXTRACT_WINDOW_MINUTES = "15";
    return {
        caller: { id: "" },
        state: null as null | { db: unknown; tables: Record<string, Row[]> },
        calls: 0,
    };
});
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => h.state!.db) }));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.userId = h.caller.id;
                res.locals.userEmail = `${h.caller.id}@test.local`;
                next();
            }),
    };
});
vi.mock("../../lib/llm", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../lib/llm")>()),
    completeText: vi.fn(async () => {
        h.calls += 1;
        return "[]";
    }),
}));

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const path = `/projects/${id(120)}/matters/${id(130)}/profile/versions/${id(210)}/extract`;
const as = (userId: string) => {
    h.caller.id = userId;
};

beforeEach(() => {
    h.state = memoryDb({});
    h.calls = 0;
});

describe("the extraction lane", () => {
    it("answers 429 with the machine code after the person's third run, and keeps the others' lanes apart", async () => {
        // Nobody here belongs to the matter: the requests end in 404 once they pass the lane.
        as(id(1));
        for (let attempt = 0; attempt < 3; attempt += 1) expect((await request(app).post(path).send({})).status).toBe(404);
        const refused = await request(app).post(path).send({});
        expect(refused.status).toBe(429);
        expect(refused.body.code).toBe("rate_limited");
        expect(refused.headers["ratelimit-limit"]).toBe("3");
        // The same address, another person: their own lane.
        as(id(2));
        expect((await request(app).post(path).send({})).status).toBe(404);
        // The first person stays refused, and the lane covers every version of the matter.
        as(id(1));
        expect((await request(app).post(path.replace(id(210), id(211))).send({})).status).toBe(429);
        expect(h.calls).toBe(0);
    });

    it("does not count reading the profile or where the text would go", async () => {
        as(id(3));
        const base = `/projects/${id(120)}/matters/${id(130)}/profile`;
        for (let attempt = 0; attempt < 6; attempt += 1) {
            expect((await request(app).get(`${base}/extraction`)).status).toBe(404);
            expect((await request(app).get(base)).status).toBe(404);
        }
    });
});
