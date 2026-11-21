import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { memoryDb, type Row } from "../../../__tests__/helpers/memoryDb";
import { sha256Hex } from "../mcp.crypto";
import { grantPredatesSignOut } from "../mcp.grants";
import { revalidatePrincipal } from "../mcp.principal";
import { verifyAccessToken } from "../mcp.tokens";
import type { GrantRow } from "../mcp.shared";

// Each place that decides whether a connection is still good, on its own:
// a connection made before the person's last global sign-out is refused even
// though it is not revoked (the stamp alone ends it).
const RESOURCE = "https://mcp.test.example/mcp";
const MADE = "2026-11-21T10:00:00.123Z";

const grantMadeAt = (created_at: string) => ({ created_at }) as GrantRow;

describe("grantPredatesSignOut", () => {
    it.each([
        ["earlier", MADE, "2026-11-21T10:00:05.000Z", true],
        ["the same millisecond", MADE, MADE, true],
        ["later", "2026-11-21T10:00:05.000Z", MADE, false],
        ["Postgres microseconds and +00:00, earlier", "2026-11-21T10:00:00.123456+00:00", "2026-11-21T10:00:01.000000+00:00", true],
        ["Postgres microseconds and +00:00, same millisecond", "2026-11-21T10:00:00.123456+00:00", "2026-11-21T10:00:00.123Z", true],
        ["Postgres microseconds and +00:00, later", "2026-11-21T10:00:01.500000+00:00", "2026-11-21T10:00:01.123000+00:00", false],
        ["no stamp", MADE, null, false],
        ["an undefined stamp", MADE, undefined, false],
    ])("%s", (_label, created, stamp, predates) => {
        expect(grantPredatesSignOut(grantMadeAt(created), stamp)).toBe(predates);
    });
});

describe("the gate of a connection made before the last global sign-out", () => {
    let tables: Record<string, Row[]>;
    let db: Db;
    const stampAt = (value: string | null) => {
        tables.user_profiles[0].sessions_ended_at = value;
    };

    beforeEach(() => {
        vi.stubEnv("LITT_MCP_SERVER", "enabled");
        vi.stubEnv("LITT_MCP_PUBLIC_URL", "https://mcp.test.example");
        tables = {
            // Not revoked: only the stamp can end it.
            mcp_grants: [
                {
                    id: "grant-1",
                    user_id: "user-1",
                    client_id: "client-1",
                    resource: RESOURCE,
                    scopes: ["litt.read"],
                    workspaces: ["personal"],
                    default_workspace: "personal",
                    mfa_verified_at: null,
                    created_at: MADE,
                    last_used_at: null,
                    expires_at: "2999-01-01T00:00:00.000Z",
                    revoked_at: null,
                },
            ],
            mcp_oauth_tokens: [
                {
                    id: "tok-1",
                    grant_id: "grant-1",
                    kind: "access",
                    token_hash: sha256Hex("access-1"),
                    expires_at: "2999-01-01T00:00:00.000Z",
                    used_at: null,
                    revoked_at: null,
                },
            ],
            user_profiles: [{ user_id: "user-1", account_deletion_requested_at: null, sessions_ended_at: null }],
            org_members: [],
            organizations: [],
            training_stages: [],
        };
        db = memoryDb(tables).db;
    });
    afterEach(() => vi.unstubAllEnvs());

    it("verifyAccessToken accepts it with no stamp or an earlier one, and refuses it at or after its creation", async () => {
        expect(await verifyAccessToken(db, "access-1")).not.toBeNull();
        stampAt("2026-11-21T09:00:00.000Z");
        expect(await verifyAccessToken(db, "access-1")).not.toBeNull();
        stampAt(MADE);
        expect(await verifyAccessToken(db, "access-1")).toBeNull();
        stampAt("2026-11-21T10:30:00.000Z");
        expect(await verifyAccessToken(db, "access-1")).toBeNull();
    });

    it("revalidatePrincipal accepts it with no stamp or an earlier one, and refuses it at or after its creation", async () => {
        expect((await revalidatePrincipal(db, "grant-1")).ok).toBe(true);
        stampAt("2026-11-21T09:00:00.000Z");
        expect((await revalidatePrincipal(db, "grant-1")).ok).toBe(true);
        for (const stamp of [MADE, "2026-11-21T10:30:00.000Z"]) {
            stampAt(stamp);
            const refused = await revalidatePrincipal(db, "grant-1");
            expect(refused).toMatchObject({ ok: false, status: 401, code: "invalid_token" });
        }
    });
});
