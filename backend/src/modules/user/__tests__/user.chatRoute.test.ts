import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../../../lib/supabase";
import { saveApiKeyFor } from "../user.apiKeyStore";
import {
    chatRouteHost,
    governChatRoute,
    loadPinnedChatRoute,
    pinChatRoute,
    titleModelForRoute,
} from "../user.chatRoute";

type Row = Record<string, unknown>;

/** Tables as arrays; `.eq` filters, `.maybeSingle` returns the first match. */
function fakeDb(tables: Record<string, Row[]>) {
    const calls: { table: string; filters: Record<string, unknown> }[] = [];
    const db = {
        from(table: string) {
            const filters: Record<string, unknown> = {};
            let upsertPayload: Row | null = null;
            const rows = () =>
                (tables[table] ?? []).filter((row) =>
                    Object.entries(filters).every(([column, value]) =>
                        column.includes(".") ? true : row[column] === value,
                    ),
                );
            const builder: Record<string, unknown> = {
                select: () => builder,
                eq: (column: string, value: unknown) => {
                    filters[column] = value;
                    return builder;
                },
                is: () => builder,
                upsert: (payload: Row) => {
                    upsertPayload = payload;
                    return builder;
                },
                maybeSingle: async () => {
                    calls.push({ table, filters: { ...filters } });
                    return { data: rows()[0] ?? null, error: null };
                },
                then: (resolve: (value: unknown) => unknown) => {
                    if (upsertPayload) {
                        (tables[table] ??= []).push({ ...upsertPayload });
                        return Promise.resolve({ error: null }).then(resolve);
                    }
                    return Promise.resolve({ data: rows(), error: null }).then(resolve);
                },
            };
            return builder;
        },
    };
    return { db: db as unknown as Db, calls, tables };
}

/** A saved key row as the database stores it (version from the trigger). */
async function keyRow(
    owner: { kind: "user" | "org"; id: string },
    provider: string,
    secret: string,
    version = 1,
    extra: Row = {},
): Promise<Row> {
    const capture = fakeDb({});
    await saveApiKeyFor(owner, provider as never, secret, capture.db);
    const table = owner.kind === "user" ? "user_api_keys" : "org_api_keys";
    const row = capture.tables[table]![0]!;
    return {
        ...row,
        version,
        credential_ref: `${provider}:v${version}`,
        ...extra,
    };
}

beforeEach(() => {
    vi.stubEnv("USER_API_KEYS_ENCRYPTION_SECRET", "synthetic-secret");
    for (const name of [
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "GEMINI_API_KEY",
        "OPENAI_API_KEY",
    ]) {
        vi.stubEnv(name, "");
    }
});
afterEach(() => vi.unstubAllEnvs());

describe("pinChatRoute", () => {
    it("pins a new chat to the person's own key, with its version", async () => {
        const { db } = fakeDb({
            user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own", 3)],
        });
        const result = await pinChatRoute(db, {
            userId: "u1",
            orgId: null,
            model: "claude-sonnet-5-5",
        });
        expect(result).toMatchObject({
            ok: true,
            route: {
                provider: "claude",
                model: "claude-sonnet-5-5",
                credentialRef: "user:u1:claude:v3",
            },
        });
        if (!result.ok) return;
        expect(result.apiKeys.claude).toBe("sk-own");
        // Every other provider is off, so nothing in the turn can reach one.
        expect(result.apiKeys.disabledProviders).toContain("openai");
        expect(result.apiKeys.disabledProviders).not.toContain("claude");
    });

    it("never resolves an organization's key implicitly", async () => {
        const { db } = fakeDb({
            org_members: [{ org_id: "o1", user_id: "u1" }],
            organizations: [{ id: "o1", allow_personal_api_keys: false }],
            org_api_keys: [await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm")],
        });
        const result = await pinChatRoute(db, {
            userId: "u1",
            orgId: "o1",
            model: "claude-sonnet-5-5",
        });
        expect(result).toMatchObject({
            ok: false,
            status: 422,
            code: "chat_route_credential_required",
        });
    });

    it("uses an organization's key when it is chosen explicitly", async () => {
        const { db } = fakeDb({
            org_members: [{ org_id: "o1", user_id: "u1" }],
            organizations: [{ id: "o1", allow_personal_api_keys: true }],
            org_api_keys: [await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm", 2)],
        });
        const result = await pinChatRoute(db, {
            userId: "u1",
            orgId: "o1",
            model: "claude-sonnet-5-5",
            requestedCredentialRef: "org:o1:claude:v2",
        });
        expect(result).toMatchObject({
            ok: true,
            route: { credentialRef: "org:o1:claude:v2" },
        });
        if (result.ok) expect(result.apiKeys.claude).toBe("sk-firm");
    });

    it("falls back to the deployment key only when there is no personal key", async () => {
        vi.stubEnv("GEMINI_API_KEY", "env-gemini");
        const { db } = fakeDb({});
        const result = await pinChatRoute(db, {
            userId: "u1",
            orgId: null,
            model: "gemini-3.8-flash",
        });
        expect(result).toMatchObject({
            ok: true,
            route: { provider: "gemini", credentialRef: "env:gemini" },
        });
    });

    it("pins an operator endpoint without any saved key", async () => {
        const { db } = fakeDb({});
        const result = await pinChatRoute(db, {
            userId: "u1",
            orgId: null,
            model: "ollama/qwen3.6",
        });
        expect(result).toMatchObject({
            ok: true,
            route: { provider: "ollama", credentialRef: "operator:ollama" },
        });
    });
});

describe("loadPinnedChatRoute", () => {
    const route = {
        provider: "claude" as const,
        model: "claude-sonnet-5-5",
        credentialRef: "user:u1:claude:v1",
    };

    it("refuses a different model on a pinned conversation", async () => {
        const { db } = fakeDb({
            user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own")],
        });
        await expect(
            loadPinnedChatRoute(db, {
                userId: "u1",
                orgId: null,
                route,
                requestedModel: "gpt-6.1-sol",
            }),
        ).resolves.toMatchObject({ ok: false, status: 409, code: "chat_route_pinned" });
    });

    it("fails closed when the pinned key was rotated, with no fallback", async () => {
        vi.stubEnv("ANTHROPIC_API_KEY", "env-claude");
        const { db } = fakeDb({
            user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-new", 2)],
        });
        await expect(
            loadPinnedChatRoute(db, { userId: "u1", orgId: null, route }),
        ).resolves.toMatchObject({
            ok: false,
            status: 409,
            code: "chat_route_credential_unavailable",
        });
    });

    it("fails closed when the pinned key was disabled or deleted", async () => {
        const disabled = fakeDb({
            user_api_keys: [
                await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own", 1, { enabled: false }),
            ],
        });
        await expect(
            loadPinnedChatRoute(disabled.db, { userId: "u1", orgId: null, route }),
        ).resolves.toMatchObject({ code: "chat_route_credential_unavailable" });
        const deleted = fakeDb({});
        await expect(
            loadPinnedChatRoute(deleted.db, { userId: "u1", orgId: null, route }),
        ).resolves.toMatchObject({ code: "chat_route_credential_unavailable" });
    });

    it("never runs a colleague's personal key", async () => {
        const { db } = fakeDb({
            user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own")],
        });
        await expect(
            loadPinnedChatRoute(db, { userId: "u2", orgId: null, route }),
        ).resolves.toMatchObject({ code: "chat_route_credential_unavailable" });
    });

    it("drops an organization key once the actor leaves the organization", async () => {
        const orgRoute = { ...route, credentialRef: "org:o1:claude:v1" };
        const { db } = fakeDb({
            org_members: [],
            organizations: [{ id: "o1", allow_personal_api_keys: true }],
            org_api_keys: [await keyRow({ kind: "org", id: "o1" }, "claude", "sk-firm")],
        });
        await expect(
            loadPinnedChatRoute(db, { userId: "u1", orgId: "o1", route: orgRoute }),
        ).resolves.toMatchObject({ code: "chat_route_credential_unavailable" });
    });

    it("loads the same version and hands over only that key", async () => {
        const { db } = fakeDb({
            user_api_keys: [await keyRow({ kind: "user", id: "u1" }, "claude", "sk-own")],
        });
        const result = await loadPinnedChatRoute(db, { userId: "u1", orgId: null, route });
        expect(result).toMatchObject({ ok: true, route });
        if (result.ok) {
            expect(result.apiKeys.claude).toBe("sk-own");
            expect(result.apiKeys.gemini).toBeUndefined();
        }
    });
});

describe("governChatRoute", () => {
    it("pins a chat stored before routes on its next turn", async () => {
        vi.stubEnv("GEMINI_API_KEY", "env-gemini");
        const { db } = fakeDb({});
        const result = await governChatRoute(db, {
            userId: "u1",
            orgId: null,
            chat: { model: "gemini-3.8-flash", model_provider: null, credential_ref: null },
            selectedModel: "gemini-3.8-flash",
        });
        expect(result).toMatchObject({ ok: true, pinNow: true, route: { credentialRef: "env:gemini" } });
    });

    it("refuses a different credential on a pinned chat", async () => {
        const { db } = fakeDb({});
        await expect(
            governChatRoute(db, {
                userId: "u1",
                orgId: null,
                chat: {
                    model: "gemini-3.8-flash",
                    model_provider: "gemini",
                    credential_ref: "env:gemini",
                },
                selectedModel: "gemini-3.8-flash",
                requestedCredentialRef: "user:u1:gemini:v1",
            }),
        ).resolves.toMatchObject({ ok: false, code: "chat_route_pinned" });
    });
});

describe("route provenance", () => {
    it("names the host each route sends to", () => {
        expect(
            chatRouteHost(
                { provider: "custom", model: "custom/m", credentialRef: "user:u1:custom:v1" },
                { providerSettings: { custom: { baseUrl: "https://llm.example.com/v1" } } },
            ),
        ).toBe("llm.example.com");
        expect(
            chatRouteHost(
                { provider: "claude", model: "claude-sonnet-5-5", credentialRef: "env:claude" },
                {},
            ),
        ).toBe("api.anthropic.com");
    });

    it("keeps a title model only on the route's provider", () => {
        const route = { provider: "claude" as const, model: "claude-sonnet-5-5", credentialRef: "env:claude" };
        expect(titleModelForRoute(route, "claude-haiku-4-5")).toBe("claude-haiku-4-5");
        expect(titleModelForRoute(route, "gpt-6-luna")).toBeNull();
    });
});
