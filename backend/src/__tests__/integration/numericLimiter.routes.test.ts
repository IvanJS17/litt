import { describe, expect, it, vi } from "vitest";
import request from "supertest";

// A rate-limit setting of app.ts written with a thousands separator is not a
// number: the limiter keeps its default instead of a limit a thousand times
// smaller. The limiter's counters live as long as the process, so this has its own file.
vi.hoisted(() => {
    process.env.RATE_LIMIT_GENERAL_MAX = "1,000";
});
vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => ({})) }));

import { app } from "../../app";

describe("a general rate limit written as 1,000", () => {
    it("keeps the default of 300 requests", async () => {
        const first = await request(app).get("/no-such-route").set("X-Forwarded-For", "203.0.113.50");
        expect(first.headers["ratelimit-limit"]).toBe("300");
        for (let i = 0; i < 4; i += 1)
            expect((await request(app).get("/no-such-route").set("X-Forwarded-For", "203.0.113.50")).status).not.toBe(429);
    });
});
