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

const ROUTE_FIELDS = new Set(["name", "description", "model", "reasoning"]);

type Parsed = { ok: true; value: SubagentRoutes } | { ok: false; detail: string };

function parseRoute(raw: unknown, index: number): SubagentRoute | string {
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
    const model = typeof entry.model === "string" ? resolveModel(entry.model.trim(), "") : "";
    if (!model) return `${at} needs a supported model.`;
    const route: SubagentRoute = { name, description, model };
    if (entry.reasoning != null) {
        if (!(REASONING_LEVELS as readonly unknown[]).includes(entry.reasoning)) {
            return `${at} has an unknown reasoning level.`;
        }
        route.reasoning = entry.reasoning as ReasoningLevel;
    }
    return route;
}

/** Validate the routes a user saves; every failure names what to fix. */
export function validateSubagentRoutes(body: unknown): Parsed {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { ok: false, detail: "Send the routes as an object." };
    }
    const { routes: rawRoutes, default: rawDefault } = body as Record<string, unknown>;
    if (!Array.isArray(rawRoutes)) return { ok: false, detail: "routes must be a list." };
    if (rawRoutes.length > MAX_SUBAGENT_ROUTES) {
        return { ok: false, detail: `Save at most ${MAX_SUBAGENT_ROUTES} routes.` };
    }
    const routes: SubagentRoute[] = [];
    for (const [index, raw] of rawRoutes.entries()) {
        const route = parseRoute(raw, index);
        if (typeof route === "string") return { ok: false, detail: route };
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
    return { ok: true, value: { routes, default: fallback } };
}

/**
 * Read stored routes. A route that no longer validates (a model retired
 * from the catalog) is left out rather than repaired, and so is a default
 * that lost its route: the subagent then runs on the conversation's model.
 */
export function storedSubagentRoutes(stored: unknown): SubagentRoutes {
    const raw = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
    const routes = (Array.isArray(raw.routes) ? raw.routes : [])
        .slice(0, MAX_SUBAGENT_ROUTES)
        .map(parseRoute)
        .filter((r): r is SubagentRoute => typeof r !== "string")
        .filter((r, i, all) => all.findIndex((o) => o.name === r.name) === i);
    const fallback =
        typeof raw.default === "string" && routes.some((r) => r.name === raw.default)
            ? raw.default
            : null;
    return { routes, default: fallback };
}
