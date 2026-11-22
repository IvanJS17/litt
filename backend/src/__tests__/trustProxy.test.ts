import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ createServerSupabase: vi.fn() }));

import { app } from "../app";

// Per-IP rate limits key on req.ip. With the default setting, the address
// the one trusted hop observed (the right-most entry) wins over any
// address earlier in the header.
describe("client address behind the single trusted hop", () => {
    it("identifies a request by the right-most X-Forwarded-For entry", async () => {
        const probe = express();
        probe.set("trust proxy", app.get("trust proxy"));
        probe.get("/ip", (req, res) => {
            res.json({ ip: req.ip });
        });

        const response = await request(probe)
            .get("/ip")
            .set("X-Forwarded-For", "198.51.100.9, 203.0.113.5");

        expect(response.body).toEqual({ ip: "203.0.113.5" });
    });
});
