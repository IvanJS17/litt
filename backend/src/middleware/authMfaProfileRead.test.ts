import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

// LiTT (ledger §16.3 "Sign-in, MFA and identity"): the sign-in MFA
// preference is read fail-closed. If it cannot be read — a missing column
// included — the request is refused, never waved through as "MFA off".
const mocks = vi.hoisted(() => ({
    profileError: null as null | { code: string; message: string },
    getAssurance: vi.fn(),
}));
vi.mock("../lib/userLookup", () => ({ syncProfileEmail: async () => null }));
vi.mock("../lib/supabase", () => ({
    createServerSupabase: () => ({
        auth: {
            getUser: async () => ({
                data: { user: { id: "u1", email: "u1@example.com", email_confirmed_at: "2026-01-01" } },
                error: null,
            }),
            mfa: { getAuthenticatorAssuranceLevel: mocks.getAssurance },
        },
        from: () => {
            let columns = "";
            const builder = {
                select: (c: string) => {
                    columns = c;
                    return builder;
                },
                eq: () => builder,
                maybeSingle: async () =>
                    !columns.includes("mfa_on_login")
                        ? { data: null, error: null }
                        : mocks.profileError
                          ? { data: null, error: mocks.profileError }
                          : { data: { mfa_on_login: true }, error: null },
            };
            return builder;
        },
    }),
}));
import { requireAuth } from "./auth";

async function run() {
    const req = {
        headers: { authorization: "Bearer token" },
        method: "GET",
        originalUrl: "/projects",
        path: "/projects",
        get: () => undefined,
    } as unknown as Request;
    const res = {
        locals: {} as Record<string, unknown>,
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        headersSent: false,
    };
    const next = vi.fn() as unknown as NextFunction;
    await requireAuth(req as never, res as unknown as Response, next);
    return { res, next };
}

describe("requireAuth sign-in MFA preference", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.profileError = null;
        mocks.getAssurance.mockResolvedValue({
            data: { currentLevel: "aal1", nextLevel: "aal2" },
            error: null,
        });
    });

    it("refuses when the preference column is missing", async () => {
        mocks.profileError = { code: "42703", message: "column does not exist" };
        const { res, next } = await run();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it("requires the enrolled factor when the preference is on", async () => {
        const { res, next } = await run();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });
});
