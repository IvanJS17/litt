import type { SubagentRoute, SubagentRoutes } from "@mike/contracts";
import { resolveModel } from "./llm/models";
import { REASONING_LEVELS, type ReasoningLevel } from "./llm/types";

/**
 * LiTT: the named model routes a user lets chat subagents run on, modelled
 * on the `model_map` mode of the Hermes advanced-delegation plugin (owner
 * decision 2026-10-30). The agent only ever sees a route's name and
 * description; the model and reasoning stay on the server.
 */
export const MAX_SUBAGENT_ROUTES = 8;
export const SUBAGENT_ROUTE_NAME = /^[a-z0-9-]{1,32}$/;
export const MAX_SUBAGENT_ROUTE_DESCRIPTION = 200;

export const EMPTY_SUBAGENT_ROUTES: SubagentRoutes = { routes: [], default: null };

/** `unavailable` is ours, sent back as read; it is never stored. */
const ROUTE_FIELDS = new Set(["name", "description", "model", "reasoning", "unavailable"]);

/**
 * The database's own limit: `octet_length(subagent_routes::text) <= 6000`
 * (migration 20261030_50_litt_subagent_routes.sql).
 */
export const MAX_SUBAGENT_ROUTES_BYTES = 6000;

type Parsed = { ok: true; value: SubagentRoutes } | { ok: false; detail: string };

/** Whether a route whose model left the catalog may stay as it is. */
type KeepRetired = (name: string, model: string) => boolean;

function parseRoute(raw: unknown, index: number, keepRetired: KeepRetired): SubagentRoute | string {
    const at = `Route ${index + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return `${at} must be an object.`;
    const entry = raw as Record<string, unknown>;
    const extra = Object.keys(entry).find((key) => !ROUTE_FIELDS.has(key));
    if (extra) return `${at} has an unexpected field "${extra}".`;
    const name = typeof entry.name === "string" ? entry.name : "";
    if (!SUBAGENT_ROUTE_NAME.test(name)) {
        return `${at} needs a name of 1 to 32 lowercase letters, digits or hyphens.`;
    }
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (
        !description ||
        description.length > MAX_SUBAGENT_ROUTE_DESCRIPTION ||
        /[\r\n]/.test(description)
    ) {
        return `${at} needs a one-line description of up to ${MAX_SUBAGENT_ROUTE_DESCRIPTION} characters.`;
    }
    const requested = typeof entry.model === "string" ? entry.model.trim() : "";
    const model = requested ? resolveModel(requested, "") : "";
    const retired = !model && Boolean(requested) && keepRetired(name, requested);
    if (!model && !retired) return `${at} needs a supported model.`;
    const route: SubagentRoute = { name, description, model: model || requested };
    if (entry.reasoning != null) {
        if (!(REASONING_LEVELS as readonly unknown[]).includes(entry.reasoning)) {
            return `${at} has an unknown reasoning level.`;
        }
        route.reasoning = entry.reasoning as ReasoningLevel;
    }
    return retired ? { ...route, unavailable: true } : route;
}

/**
 * The size of `subagent_routes::text` as PostgreSQL prints a jsonb value:
 * ", " and ": " separators, the same string escapes as JSON.stringify.
 * Key order differs, length does not.
 */
export function storedSubagentRoutesBytes(routes: SubagentRoutes): number {
    const text = (value: unknown): string => {
        if (Array.isArray(value)) return `[${value.map(text).join(", ")}]`;
        if (value && typeof value === "object") {
            return `{${Object.entries(value)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${JSON.stringify(k)}: ${text(v)}`)
                .join(", ")}}`;
        }
        return JSON.stringify(value);
    };
    return Buffer.byteLength(text(routes), "utf8");
}

/**
 * Validate the routes a user saves; every failure names what to fix. A
 * route whose model left the catalog may be saved back exactly as `stored`
 * has it, so editing another route does not erase it; it is stored without
 * its `unavailable` mark.
 */
export function validateSubagentRoutes(body: unknown, stored?: SubagentRoutes): Parsed {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, detail: "Send the routes as an object." };
    }
    const { routes: rawRoutes, default: rawDefault } = body as Record<string, unknown>;
    if (!Array.isArray(rawRoutes)) return { ok: false, detail: "routes must be a list." };
    if (rawRoutes.length > MAX_SUBAGENT_ROUTES) {
        return { ok: false, detail: `Save at most ${MAX_SUBAGENT_ROUTES} routes.` };
    }
    const keepRetired: KeepRetired = (name, model) =>
        Boolean(stored?.routes.some((r) => r.unavailable && r.name === name && r.model === model));
    const routes: SubagentRoute[] = [];
    for (const [index, raw] of rawRoutes.entries()) {
        const parsed = parseRoute(raw, index, keepRetired);
        if (typeof parsed === "string") return { ok: false, detail: parsed };
        const { unavailable: _unavailable, ...route } = parsed;
        if (routes.some((r) => r.name === route.name)) {
            return { ok: false, detail: `The route name "${route.name}" repeats.` };
        }
        routes.push(route);
    }
    if (rawDefault != null && typeof rawDefault !== "string") {
        return { ok: false, detail: "default must be a route name or null." };
    }
    const fallback = rawDefault || null;
    if (fallback && !routes.some((r) => r.name === fallback)) {
        return { ok: false, detail: "The default must be one of the routes." };
    }
    const value = { routes, default: fallback };
    if (storedSubagentRoutesBytes(value) > MAX_SUBAGENT_ROUTES_BYTES) {
        return { ok: false, detail: "The routes are too long to save. Shorten their descriptions." };
    }
    return { ok: true, value };
}

/**
 * Read stored routes. A route whose model left the catalog is kept, marked
 * `unavailable`, and stays the default if it was: a subagent sent to it
 * fails and says why instead of running on another model. A malformed
 * entry is left out, and so is a default that names no route.
 */
export function storedSubagentRoutes(stored: unknown): SubagentRoutes {
    const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
    const routes = (Array.isArray(raw.routes) ? raw.routes : [])
        .slice(0, MAX_SUBAGENT_ROUTES)
        .map((entry, index) => parseRoute(entry, index, () => true))
        .filter((r): r is SubagentRoute => typeof r !== "string")
        .filter((r, i, all) => all.findIndex((o) => o.name === r.name) === i);
    const fallback =
        typeof raw.default === "string" && routes.some((r) => r.name === raw.default)
            ? raw.default
            : null;
    return { routes, default: fallback };
}
