// user subagent routes — implementation behind the module facade.
//
// LiTT: the named model routes chat subagents may run on, from Settings >
// Subagents (owner decision 2026-10-30). Stored whole in one JSON column,
// user_profiles.subagent_routes; validation lives in lib/subagentRoutes.
import type { SubagentRoutes } from "@mike/contracts";
import {
    failure,
    internalFailure,
    ok,
    type ServiceResult,
} from "../../lib/serviceResult";
import {
    EMPTY_SUBAGENT_ROUTES,
    storedSubagentRoutes,
} from "../../lib/subagentRoutes";
import { type Db } from "./user.shared";

const COLUMN = "subagent_routes";

/** The column is not there yet: deployed before migrating. */
function isNotMigrated(error: unknown): boolean {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    return (
        (code === "42703" || code === "PGRST204") &&
        typeof message === "string" &&
        message.includes(COLUMN)
    );
}

/** A database that has not migrated yet reads as no routes. */
export async function loadSubagentRoutes(db: Db, userId: string): Promise<SubagentRoutes> {
    const { data, error } = await db
        .from("user_profiles")
        .select(COLUMN)
        .eq("user_id", userId)
        .maybeSingle();
    if (error) {
        if (isNotMigrated(error)) return EMPTY_SUBAGENT_ROUTES;
        throw error;
    }
    return storedSubagentRoutes((data as { subagent_routes?: unknown } | null)?.subagent_routes);
}

export async function getSubagentRoutes(
    db: Db,
    userId: string,
): Promise<ServiceResult<SubagentRoutes>> {
    try {
        return ok(await loadSubagentRoutes(db, userId));
    } catch (error) {
        return internalFailure(error);
    }
}

/** Replaces the user's routes with routes already validated by validateSubagentRoutes. */
export async function saveSubagentRoutes(
    db: Db,
    userId: string,
    routes: SubagentRoutes,
): Promise<ServiceResult<SubagentRoutes>> {
    const { data, error } = await db
        .from("user_profiles")
        .update({ [COLUMN]: routes })
        .eq("user_id", userId)
        .select(COLUMN)
        .maybeSingle();
    if (error) {
        if (isNotMigrated(error)) {
            return failure("unavailable", "Subagent routes are not available yet.");
        }
        return internalFailure(error);
    }
    if (!data) return failure("not_found", "Profile not found");
    return ok(storedSubagentRoutes((data as { subagent_routes?: unknown }).subagent_routes));
}
