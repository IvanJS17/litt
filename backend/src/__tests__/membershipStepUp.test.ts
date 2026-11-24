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

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
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
// An entry here is a reviewable decision: say why, in one line.
const ALLOWLIST: { label: string; reason: string }[] = [
    { label: "PATCH /settings (memory/memory.routes.ts)", reason: "a person's own memory preferences; no firm setting" },
    { label: "POST /invitations/:invitationId/accept (user/user.routes.ts)", reason: "the invited person answers their own invitation; it changes nothing for the firm's other members" },
    { label: "POST /invitations/:invitationId/decline (user/user.routes.ts)", reason: "the invited person answers their own invitation; it changes nothing for the firm's other members" },
];

const MODULES = resolve(__dirname, "../modules");

async function routers(): Promise<{ file: string; name: string; stack: Layer[] }[]> {
    const found: { file: string; name: string; stack: Layer[] }[] = [];
    for (const domain of readdirSync(MODULES)) {
        for (const file of readdirSync(join(MODULES, domain)).filter((f) => /\.routes\.ts$/.test(f))) {
            const loaded = (await import(join(MODULES, domain, file))) as Record<string, unknown>;
            for (const [name, value] of Object.entries(loaded)) if (isRouter(value)) found.push({ file: `${domain}/${file}`, name, stack: value.stack });
        }
    }
    return found;
}

describe("second factor on membership, role, invitation and settings writes", () => {
    it("every such write route carries requireMfaIfEnrolled ahead of its handler", async () => {
        const missing: string[] = [];
        let sensitive = 0;
        for (const { file, stack } of await routers()) {
            for (const { route } of stack) {
                if (!route) continue;
                const handlers = route.stack.map((s) => s.handle);
                // A route that answers 405 changes nothing.
                if ((handlers[handlers.length - 1] as { name: string }).name === "notSupported") continue;
                const guard = handlers.indexOf(requireMfaIfEnrolled);
                for (const path of [route.path].flat()) {
                    for (const method of Object.keys(route.methods)) {
                        if (method === "get" || !SENSITIVE_PATH.test(path)) continue;
                        const label = `${method.toUpperCase()} ${path} (${file})`;
                        if (ALLOWLIST.some((a) => a.label === label)) continue;
                        sensitive += 1;
                        if (guard < 0 || guard === handlers.length - 1) missing.push(label);
                    }
                }
            }
        }
        expect(sensitive, "the path pattern should still find the firm's member, invitation and settings routes").toBeGreaterThanOrEqual(8);
        expect(missing, "add requireMfaIfEnrolled before the handler of each route listed (or list it in ALLOWLIST with a reason)").toEqual([]);
    });
});
