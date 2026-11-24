// Routes that change who belongs to a firm, what role they hold, who is
// invited, or a firm's settings need the second factor when the acting account
// has one (`requireMfaIfEnrolled`).
//
// `modules/orgs/orgs.routes.stepUp.test.ts` walks every write of the
// organization router. This test covers the rest of the backend: it loads the
// router of every module, reads the registered routes (not a list kept by
// hand) and fails when a write whose path names members, roles, invitations,
// owners or settings has no `requireMfaIfEnrolled` ahead of its handler. A new
// route in any module is judged without anyone remembering to add it here.
//
// Scope: the test goes by the route's own path as registered in its router, not
// by the prefix the router is mounted under. It covers paths naming members,
// roles, invitations, owners or settings; other kinds of change to who can reach
// something (granting access to a matter or a conversation, sharing, visibility)
// are outside this test.

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Router } from "express";
import { describe, expect, it } from "vitest";
import { requireMfaIfEnrolled } from "../middleware/auth";

type Layer = {
    handle: unknown;
    route?: { path: string | string[]; methods: Record<string, boolean>; stack: { handle: unknown }[] };
};
const isRouter = (value: unknown): value is { stack: Layer[] } =>
    typeof value === "function" && Array.isArray((value as { stack?: unknown }).stack);

// What makes a write a membership, role, invitation or settings change.
const SENSITIVE_PATH = /(^|\/)(members?|roles?|invitations?|owners?|settings?)(\/|$|:)|\/(owner|retainer|drive-folder)(\/|$)/i;

// Routes that match but legitimately skip the second factor, with the reason.
// An entry is keyed by method, path, file and the exported router's name, and
// must match exactly one registered route. An entry is a reviewable decision:
// say why, in one line, and only what is true of that one route.
const ALLOWLIST: { label: string; reason: string }[] = [
    { label: "PATCH /settings (memory/memory.routes.ts userMemoryRouter)", reason: "a person's own memory preferences; no firm setting" },
    {
        label: "PATCH /settings (memory/memory.routes.ts projectMemoryRouter)",
        reason: "a matter's memory setting, changed by someone who manages that matter; not a firm-wide setting",
    },
    { label: "POST /invitations/:invitationId/accept (user/user.routes.ts userRouter)", reason: "the invited person answers their own invitation; it changes nothing for the firm's other members" },
    { label: "POST /invitations/:invitationId/decline (user/user.routes.ts userRouter)", reason: "the invited person answers their own invitation; it changes nothing for the firm's other members" },
];

const MODULES = resolve(__dirname, "../modules");

async function routers(): Promise<Found[]> {
    const found: Found[] = [];
    for (const domain of readdirSync(MODULES)) {
        for (const file of readdirSync(join(MODULES, domain)).filter((f) => /\.routes\.ts$/.test(f))) {
            const loaded = (await import(join(MODULES, domain, file))) as Record<string, unknown>;
            for (const [name, value] of Object.entries(loaded)) if (isRouter(value)) found.push({ file: `${domain}/${file}`, name, stack: value.stack });
        }
    }
    return found;
}

type Found = { file: string; name: string; stack: Layer[] };

/** Judges every non-read route whose path matches: which lack the guard, how many matched, and how often each allowlist entry matched. */
function judge(found: Found[], allowlist: { label: string }[] = ALLOWLIST) {
    const missing: string[] = [];
    const matches = new Map(allowlist.map((a) => [a.label, 0]));
    let sensitive = 0;
    for (const { file, name, stack } of found) {
        for (const { route } of stack) {
            if (!route) continue;
            const handlers = route.stack.map((s) => s.handle);
            // A route that answers 405 changes nothing.
            if ((handlers[handlers.length - 1] as { name: string }).name === "notSupported") continue;
            const guard = handlers.indexOf(requireMfaIfEnrolled);
            for (const path of [route.path].flat()) {
                for (const method of Object.keys(route.methods)) {
                    if (method === "get" || !SENSITIVE_PATH.test(path)) continue;
                    const label = `${method.toUpperCase()} ${path} (${file} ${name})`;
                    if (matches.has(label)) {
                        matches.set(label, (matches.get(label) ?? 0) + 1);
                        continue;
                    }
                    sensitive += 1;
                    if (guard < 0 || guard === handlers.length - 1) missing.push(label);
                }
            }
        }
    }
    return { missing, sensitive, matches };
}

const wrongEntries = (matches: Map<string, number>) =>
    [...matches].filter(([, count]) => count !== 1).map(([label, count]) => `${label} matches ${count} registered routes (it must match exactly one)`);

describe("second factor on membership, role, invitation and settings writes", () => {
    it("every such write route carries requireMfaIfEnrolled ahead of its handler", async () => {
        const { missing, sensitive } = judge(await routers());
        expect(sensitive, "the path pattern should still find the firm's member, invitation and settings routes").toBeGreaterThanOrEqual(8);
        expect(missing, "add requireMfaIfEnrolled before the handler of each route listed (or list it in ALLOWLIST with a reason)").toEqual([]);
    });

    it("every ALLOWLIST entry names exactly one registered route", async () => {
        const { matches } = judge(await routers());
        expect(wrongEntries(matches), "fix or remove each ALLOWLIST entry listed: one that matches no route is stale, one that matches several exempts more than its reason says").toEqual([]);
    });

    describe("the judgement itself", () => {
        const fake = (file: string, name: string, routes: [string, string][]): Found => {
            const router = Router();
            for (const [method, path] of routes) (router as unknown as Record<string, (p: string, h: () => void) => void>)[method](path, () => {});
            return { file, name, stack: router.stack as unknown as Layer[] };
        };
        const entry = [{ label: "PATCH /settings (a/a.routes.ts firstRouter)" }];

        it("exempts only the route the entry names, not another with the same method and path in the same file", () => {
            const { missing, matches } = judge([fake("a/a.routes.ts", "firstRouter", [["patch", "/settings"]]), fake("a/a.routes.ts", "secondRouter", [["patch", "/settings"]])], entry);
            expect(missing).toEqual(["PATCH /settings (a/a.routes.ts secondRouter)"]);
            expect(wrongEntries(matches)).toEqual([]);
        });

        it("reports an entry whose route no longer exists", () => {
            const { matches } = judge([fake("a/a.routes.ts", "secondRouter", [["patch", "/settings"]])], entry);
            expect(wrongEntries(matches)).toEqual(["PATCH /settings (a/a.routes.ts firstRouter) matches 0 registered routes (it must match exactly one)"]);
        });
    });
});
