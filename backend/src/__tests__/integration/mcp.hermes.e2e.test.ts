import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Row } from "../helpers/memoryDb";

// End to end with a REAL MCP client: Hermes. Skipped unless MCP_E2E_HERMES=1
// (it needs the `hermes` CLI and, for the client's own metadata document, the
// internet). Run it with `backend/scripts/mcp-e2e-hermes.sh`, which also
// isolates Hermes' home directory.
//
// What is real: the Express app (discovery, authorize, consent API, token,
// /mcp), the Hermes client (discovery → OAuth with PKCE → tools/list). What is
// stubbed: the database (in memory) and the person's web session (the
// consent call is made as a fixed test user, standing in for the browser).
const enabled = process.env.MCP_E2E_HERMES === "1";
const h = vi.hoisted(() => ({ state: null as null | { db: unknown; tables: Record<string, Row[]> } }));

vi.mock("../../lib/supabase", () => ({ createServerSupabase: vi.fn(() => h.state!.db) }));
vi.mock("../../middleware/auth", async () => {
    const { authMock } = await import("../helpers/authMock.js");
    const mock = authMock();
    return {
        ...mock,
        requireAuth: (req: unknown, res: { locals: Record<string, unknown> }, next: () => void) =>
            mock.requireAuth(req, res, () => {
                res.locals.token = "web-session-token";
                next();
            }),
    };
});

import { app } from "../../app";
import { memoryDb } from "../helpers/memoryDb";

const HERMES_HOME = process.env.HERMES_HOME ?? "";
const SERVER_NAME = "litt_local";
let server: Server;
let base = "";
let login: ChildProcess | null = null;

const hermes = (...args: string[]) =>
    spawnSync("hermes", args, {
        env: { ...process.env, HERMES_HOME, BROWSER: "/bin/true", PYTHONUNBUFFERED: "1" },
        encoding: "utf8",
        timeout: 120_000,
    });

/**
 * Asynchronous: the server under test runs in THIS process, so a blocking
 * spawn would freeze it while the client waits for an answer.
 */
const hermesAsync = (...args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
        const child = spawn("hermes", args, {
            env: { ...process.env, HERMES_HOME, BROWSER: "/bin/true", PYTHONUNBUFFERED: "1" },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        const timer = setTimeout(() => child.kill(), 120_000);
        child.on("exit", (status) => {
            clearTimeout(timer);
            resolve({ status, stdout, stderr });
        });
    });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(!enabled)("LiTT MCP server with Hermes as the client", () => {
    beforeAll(async () => {
        expect(HERMES_HOME, "run through scripts/mcp-e2e-hermes.sh").not.toBe("");
        h.state = memoryDb(
            {
                mcp_oauth_clients: [],
                mcp_oauth_requests: [],
                mcp_grants: [],
                mcp_oauth_codes: [],
                mcp_oauth_tokens: [],
                mcp_oauth_audit: [],
                org_members: [],
                organizations: [],
                user_profiles: [],
            },
            { mcp_oauth_purge: () => null },
        );
        (h.state.db as { auth?: unknown }).auth = {
            mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }) },
        };
        server = await new Promise<Server>((resolve) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
        });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        vi.stubEnv("LITT_MCP_SERVER", "enabled");
        vi.stubEnv("LITT_MCP_PUBLIC_URL", base);
        vi.stubEnv("FRONTEND_URL", "http://localhost:3000");
        // CIMD needs the internet (Hermes publishes its metadata on GitHub
        // Pages); LITT_MCP_E2E_CIMD=disabled makes Hermes register itself.
        if (process.env.LITT_MCP_E2E_CIMD === "disabled") vi.stubEnv("LITT_MCP_CIMD", "disabled");

        expect(hermes("config", "set", `mcp_servers.${SERVER_NAME}.url`, `${base}/mcp`).status).toBe(0);
        expect(hermes("config", "set", `mcp_servers.${SERVER_NAME}.auth`, "oauth").status).toBe(0);
    }, 120_000);

    afterAll(async () => {
        login?.kill();
        await new Promise((resolve) => server?.close(resolve));
        vi.unstubAllEnvs();
    });

    it("discovers, signs in with OAuth + PKCE, and lists the whoami tool", async () => {
        // The server answers an unauthenticated call the way clients expect.
        const unauthenticated = await fetch(`${base}/mcp`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
            body: "{}",
        });
        expect(unauthenticated.status).toBe(401);
        expect(unauthenticated.headers.get("www-authenticate")).toContain("resource_metadata=");

        // `hermes mcp login` prints the authorization URL and waits on a loopback port.
        login = spawn("hermes", ["mcp", "login", SERVER_NAME], {
            env: { ...process.env, HERMES_HOME, BROWSER: "/bin/true", PYTHONUNBUFFERED: "1" },
        });
        let output = "";
        login.stdout!.on("data", (chunk: Buffer) => (output += chunk.toString()));
        login.stderr!.on("data", (chunk: Buffer) => (output += chunk.toString()));
        const done = new Promise<number | null>((resolve) => login!.on("exit", resolve));

        let authorizeUrl = "";
        for (let i = 0; i < 90 && !authorizeUrl; i++) {
            authorizeUrl = output.match(new RegExp(`${base.replace(/\./g, "\\.")}/oauth/authorize[^\\s"']*`))?.[0] ?? "";
            if (!authorizeUrl) await sleep(1000);
        }
        expect(authorizeUrl, `Hermes printed no authorization URL:\n${output}`).not.toBe("");

        // The "browser": authorize → consent page → approve → back to Hermes.
        const authorize = await fetch(authorizeUrl, { redirect: "manual" });
        expect(authorize.status).toBe(302);
        const consentUrl = new URL(authorize.headers.get("location")!);
        expect(consentUrl.pathname).toBe("/connect/authorize");
        const requestId = consentUrl.searchParams.get("request")!;

        const view = await (await fetch(`${base}/mcp-connect/authorizations/${requestId}`)).json();
        console.info(`[e2e] consent for client "${view.client.name}" returning to ${view.client.redirect_host}`);
        const decision = await fetch(`${base}/mcp-connect/authorizations/${requestId}/decision`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ decision: "approve", workspaces: ["personal"], scopes: view.scopes }),
        });
        expect(decision.status).toBe(200);
        const { redirect_url } = await decision.json();
        expect(new URL(redirect_url).searchParams.get("iss")).toBe(base);

        // Hermes opens its loopback listener a moment after printing the URL.
        let callbackStatus = 0;
        for (let i = 0; i < 30 && !callbackStatus; i++) {
            try {
                callbackStatus = (await fetch(redirect_url)).status;
            } catch {
                await sleep(1000);
            }
        }
        expect(callbackStatus).toBe(200);
        await Promise.race([done, sleep(30_000)]);
        console.info(`[e2e] hermes login output:\n${output.split("\n").filter((l) => !/Bitwarden/.test(l)).join("\n")}`);

        // Hermes now holds tokens: connect, initialize, tools/list.
        const test = await hermesAsync("mcp", "test", SERVER_NAME);
        const text = `${test.stdout}\n${test.stderr}`;
        console.info(`[e2e] hermes mcp test:\n${text.split("\n").filter((l) => !/Bitwarden/.test(l)).join("\n")}`);
        expect(text).toContain("whoami");

        // What the server recorded.
        const tables = h.state!.tables;
        expect(tables.mcp_grants).toHaveLength(1);
        expect(tables.mcp_oauth_tokens.length).toBeGreaterThanOrEqual(2);
        expect(tables.mcp_oauth_audit.map((r) => r.event)).toEqual(
            expect.arrayContaining(["authorization_requested", "consent_granted", "token_issued"]),
        );
    }, 240_000);
});
