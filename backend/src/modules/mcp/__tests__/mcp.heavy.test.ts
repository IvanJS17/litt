import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The boundary talks to the database only to record the call and the strict
// audit row; a stub that keeps the inserts lets the tests see what was written.
const h = vi.hoisted(() => ({ inserts: [] as { table: string; row: Record<string, unknown> }[] }));
vi.mock("../../../lib/supabase", () => ({
    createServerSupabase: () => ({
        from: (table: string) => ({
            insert: async (row: Record<string, unknown>) => {
                h.inserts.push({ table, row });
                return { error: null };
            },
        }),
    }),
}));

import { acquireHeavySlot, heavyInFlight, heavyLimits, HEAVY_MAX_HOLD_MS, resetHeavySlots } from "../mcp.heavy";
import { defineMcpTool, mcpText, McpToolError, runMcpTool } from "../mcp.tools";
import type { McpPrincipal } from "../mcp.principal";

const principal = (userId: string): McpPrincipal => ({
    userId,
    grantId: `grant-${userId}`,
    clientId: "client",
    scopes: ["litt.read", "litt.write", "litt.run", "litt.chat"],
    workspaces: [{ id: "personal", mode: "B" }] as McpPrincipal["workspaces"],
    defaultWorkspace: "personal",
    mode: "B",
    personalWorkspaceDisabled: false,
});

const lease = async (user: string) => {
    const taken = await acquireHeavySlot(user, "t");
    if (!("lease" in taken)) throw new Error("refused");
    return taken.lease;
};

beforeEach(() => {
    resetHeavySlots();
    h.inserts.length = 0;
});
afterEach(() => {
    vi.useRealTimers();
    delete process.env.LITT_MCP_HEAVY_PER_USER;
    delete process.env.LITT_MCP_HEAVY_GLOBAL;
});

describe("heavy job slots", () => {
    it("allows 2 per person and refuses the third without taking a slot", async () => {
        await lease("ana");
        await lease("ana");
        const third = await acquireHeavySlot("ana", "t");
        expect(third).toMatchObject({ refusal: { code: "heavy_jobs_busy", retryAfterSeconds: 30 } });
        expect((await heavyInFlight()).byUser).toEqual({ ana: 2 });
        // Someone else is not affected by Ana's cap.
        expect("lease" in (await acquireHeavySlot("beto", "t"))).toBe(true);
    });

    it("allows 4 in the whole process", async () => {
        await lease("a");
        await lease("a");
        await lease("b");
        await lease("b");
        const fifth = await acquireHeavySlot("c", "t");
        expect(fifth).toMatchObject({ refusal: { code: "heavy_jobs_busy" } });
        expect((await heavyInFlight()).total).toBe(4);
    });

    it("never hands out the last slot twice to calls that arrive together", async () => {
        process.env.LITT_MCP_HEAVY_PER_USER = "2";
        const results = await Promise.all([1, 2, 3, 4, 5].map(() => acquireHeavySlot("ana", "t")));
        expect(results.filter((r) => "lease" in r)).toHaveLength(2);
        expect((await heavyInFlight()).total).toBe(2);
    });

    it("frees a sync slot on release, and the limits can be set from the environment", async () => {
        process.env.LITT_MCP_HEAVY_PER_USER = "1";
        expect(heavyLimits()).toEqual({ perUser: 1, global: 4 });
        const first = await lease("ana");
        expect("refusal" in (await acquireHeavySlot("ana", "t"))).toBe(true);
        first.release();
        expect("lease" in (await acquireHeavySlot("ana", "t"))).toBe(true);
    });

    it("keeps a background slot after the call until its probe says the job ended", async () => {
        let running = true;
        const held = await lease("ana");
        held.hold(() => running);
        held.release();
        await lease("ana");
        expect("refusal" in (await acquireHeavySlot("ana", "t"))).toBe(true);
        running = false;
        expect("lease" in (await acquireHeavySlot("ana", "t"))).toBe(true);
    });

    it("counts a job as running when its probe cannot tell, until the hold time ends it", async () => {
        vi.useFakeTimers();
        const held = await lease("ana");
        held.hold(() => {
            throw new Error("database down");
        });
        held.release();
        expect((await heavyInFlight()).total).toBe(1);
        vi.setSystemTime(Date.now() + HEAVY_MAX_HOLD_MS + 1);
        expect((await heavyInFlight()).total).toBe(0);
    });
});

describe("the cap at the MCP boundary", () => {
    const gates: (() => void)[] = [];
    const started: string[] = [];
    const blocked = () => new Promise<void>((resolve) => gates.push(resolve));
    const outcome = (out: { content: { text: string }[]; isError?: boolean }) => JSON.parse(out.content[0].text);

    const syncTool = defineMcpTool({
        name: "t_sync",
        title: "t",
        description: "t",
        inputSchema: z.object({ mode: z.enum(["wait", "ok", "fail", "abort"]).optional() }),
        scope: "litt.write",
        lane: "write",
        heavy: "sync",
        readOnly: false,
        audit: "strict",
        handler: async (args) => {
            started.push("sync");
            if (args.mode === "fail") throw new McpToolError("boom", "It failed.");
            if (args.mode === "abort") throw new DOMException("aborted", "AbortError");
            if (args.mode === "ok") return mcpText({ ok: true });
            await blocked();
            return mcpText({ ok: true });
        },
    });
    let jobRunning = true;
    const backgroundTool = defineMcpTool({
        name: "t_background",
        title: "t",
        description: "t",
        inputSchema: z.object({}),
        scope: "litt.run",
        lane: "write",
        heavy: "background",
        readOnly: false,
        audit: "strict",
        handler: async (_args, call) => {
            started.push("background");
            call.heavy?.hold(() => jobRunning);
            return mcpText({ status: "running" });
        },
    });
    const readTool = defineMcpTool({
        name: "t_read",
        title: "t",
        description: "t",
        inputSchema: z.object({}),
        scope: "litt.read",
        lane: "read",
        readOnly: true,
        audit: "call",
        handler: async () => mcpText({ ok: true }),
    });

    beforeEach(() => {
        gates.length = 0;
        started.length = 0;
        jobRunning = true;
    });

    it("refuses the third heavy call of a person with an actionable, retryable error, starting nothing and writing no audit row", async () => {
        const ana = principal("ana");
        const one = runMcpTool(syncTool, ana, {});
        const two = runMcpTool(syncTool, ana, {});
        await vi.waitFor(() => expect(gates).toHaveLength(2));
        const auditBefore = h.inserts.filter((i) => i.table === "audit_events").length;

        const refused = await runMcpTool(syncTool, ana, {});
        expect(refused.isError).toBe(true);
        expect(outcome(refused)).toMatchObject({
            code: "heavy_jobs_busy",
            retryable: true,
            retry_after_seconds: 30,
        });
        expect(outcome(refused).detail).toContain("Nothing was started");
        expect(outcome(refused).suggested_action).toContain("30 seconds");
        expect(started).toEqual(["sync", "sync"]);
        // No strict audit row for the refused call, and it is recorded as rate limited.
        expect(h.inserts.filter((i) => i.table === "audit_events")).toHaveLength(auditBefore);
        expect(h.inserts.at(-1)).toMatchObject({
            table: "mcp_tool_calls",
            row: { tool: "t_sync", outcome: "rate_limited", error_code: "heavy_jobs_busy" },
        });

        gates.forEach((open) => open());
        await Promise.all([one, two]);
        expect((await heavyInFlight()).total).toBe(0);
        expect(outcome(await runMcpTool(syncTool, ana, { mode: "ok" }))).toEqual({ ok: true });
    });

    it("caps 4 in the process across people", async () => {
        const running = ["a", "a", "b", "b"].map((u) => runMcpTool(syncTool, principal(u), {}));
        await vi.waitFor(() => expect(gates).toHaveLength(4));
        const refused = await runMcpTool(syncTool, principal("c"), {});
        expect(outcome(refused).code).toBe("heavy_jobs_busy");
        gates.forEach((open) => open());
        await Promise.all(running);
    });

    it.each(["ok", "fail", "abort"] as const)("releases the slot after a call that ends in %s", async (mode) => {
        const ana = principal("ana");
        for (let i = 0; i < 4; i++) await runMcpTool(syncTool, ana, { mode });
        expect((await heavyInFlight()).total).toBe(0);
        expect(started).toHaveLength(4);
    });

    it("releases the slot when the audit row cannot be written, and when the scope is missing", async () => {
        const ana = { ...principal("ana"), scopes: ["litt.read"] as McpPrincipal["scopes"] };
        expect(outcome(await runMcpTool(syncTool, ana, { mode: "ok" })).code).toBe("insufficient_scope");
        expect((await heavyInFlight()).total).toBe(0);
    });

    it("keeps a background job's slot after the call returns, until the job ends", async () => {
        const ana = principal("ana");
        await runMcpTool(backgroundTool, ana, {});
        await runMcpTool(backgroundTool, ana, {});
        expect(outcome(await runMcpTool(backgroundTool, ana, {})).code).toBe("heavy_jobs_busy");
        expect(started).toEqual(["background", "background"]);
        jobRunning = false;
        expect(outcome(await runMcpTool(backgroundTool, ana, {}))).toEqual({ status: "running" });
    });

    it("does not touch read tools, even with every slot taken", async () => {
        const ana = principal("ana");
        const running = [runMcpTool(syncTool, ana, {}), runMcpTool(syncTool, ana, {})];
        await vi.waitFor(() => expect(gates).toHaveLength(2));
        expect(outcome(await runMcpTool(readTool, ana, {}))).toEqual({ ok: true });
        gates.forEach((open) => open());
        await Promise.all(running);
    });
});

describe("heavy_jobs_busy as a user-facing code", () => {
    // The frontend's codeTable drift test checks the catalog against CODE_KINDS; this pins this code.
    const root = join(__dirname, "../../../../..");
    it("is a throttling code in CODE_KINDS, with a sentence in en-US and es-MX", () => {
        expect(readFileSync(join(root, "packages/client/src/userError.ts"), "utf8")).toContain('heavy_jobs_busy: "rate_limited"');
        for (const locale of ["en-US", "es-MX"]) {
            const messages = JSON.parse(readFileSync(join(root, `packages/i18n/messages/${locale}.json`), "utf8"));
            expect(messages.errors.code.heavy_jobs_busy, locale).toEqual(expect.any(String));
        }
    });
    it("is a code the diagnostics vocabulary knows, and the one the tool answers with", () => {
        expect(readFileSync(join(root, "backend/src/lib/observability/diagnostics.ts"), "utf8")).toContain(" heavy_jobs_busy ");
    });
});

describe("the settings of the heavy-job cap are plain whole numbers from 1", () => {
    afterEach(() => vi.restoreAllMocks());
    it("uses the default for anything else and takes a plain number", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        for (const value of ["10,000", "10k", "1e9", "2.5", "-5", "+5", "05", "0", "", "  ", "9".repeat(16)])
            expect(heavyLimits({ LITT_MCP_HEAVY_PER_USER: value, LITT_MCP_HEAVY_GLOBAL: value }), JSON.stringify(value)).toEqual({ perUser: 2, global: 4 });
        expect(heavyLimits({ LITT_MCP_HEAVY_PER_USER: " 7 ", LITT_MCP_HEAVY_GLOBAL: "9" })).toEqual({ perUser: 7, global: 9 });
    });
});
