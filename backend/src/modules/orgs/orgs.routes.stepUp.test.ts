import { describe, expect, it } from "vitest";
import { requireMfaIfEnrolled } from "../../middleware/auth";
import { orgsRouter } from "./orgs.routes";

// Default-deny: every route of this router that writes needs the second factor
// when the acting account has one. A route added later fails here unless it
// carries requireMfaIfEnrolled ahead of its handler, or is listed below with
// its reason.
const ALLOWLIST: { method: string; path: string; reason: string }[] = [
    { method: "POST", path: "/", reason: "creates a new organization; changes no existing one" },
];

type Layer = {
    handle: unknown;
    route?: {
        path: string | string[];
        methods: Record<string, boolean>;
        stack: { handle: unknown }[];
    };
};

const layers = (orgsRouter as unknown as { stack: Layer[] }).stack;

describe("organization routes: second factor on writes", () => {
    it("every write route carries requireMfaIfEnrolled ahead of its handler", () => {
        const missing: string[] = [];
        let checked = 0;
        for (const { route } of layers) {
            if (!route) continue;
            const handlers = route.stack.map((s) => s.handle);
            // The routes that answer 405 change nothing.
            if ((handlers[handlers.length - 1] as { name: string }).name === "notSupported") continue;
            const guard = handlers.indexOf(requireMfaIfEnrolled);
            for (const path of [route.path].flat()) {
                for (const method of Object.keys(route.methods)) {
                    if (method === "get") continue;
                    const label = `${method.toUpperCase()} ${path}`;
                    if (ALLOWLIST.some((a) => `${a.method} ${a.path}` === label)) continue;
                    checked += 1;
                    if (guard < 0 || guard === handlers.length - 1) missing.push(label);
                }
            }
        }
        expect(checked).toBeGreaterThan(10);
        expect(missing).toEqual([]);
    });

    it("mounts nothing this walk cannot see", () => {
        // A sub-router or a `use` handler would carry routes past the check
        // above. Only the closing error handler (four arguments) is mounted
        // that way.
        const mounted = layers.filter((layer) => !layer.route);
        expect(mounted).toEqual([layers[layers.length - 1]]);
        expect(mounted[0].handle).toHaveLength(4);
    });
});
