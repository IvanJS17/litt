// Where the list of Split types lives (layer 7, docs/document-split.md): one
// jsonb value, user_profiles.split_classes for a person and
// organizations.split_classes for a firm. NULL means "use the built-in list".
// One rule per workspace: inside a firm's workspace the firm's list governs
// (a member's personal list is not read there); in the personal workspace the
// person's list does. No table, no merge function: the whole list is replaced
// in one update, like the router model lists, and the server is the only
// reader and writer.
import type { Db } from "../supabase";
import { DEFAULT_SPLIT_CLASSES, readStoredSplitClasses, type SplitClass } from "./splitClasses";

export type SplitClassesSource = "user" | "org" | "default";
export type EffectiveSplitClasses = { classes: SplitClass[]; source: SplitClassesSource };

export async function readUserSplitClasses(db: Db, userId: string): Promise<SplitClass[] | null> {
    const { data, error } = await db.from("user_profiles").select("split_classes").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return readStoredSplitClasses((data as { split_classes?: unknown } | null)?.split_classes);
}

export async function readOrgSplitClasses(db: Db, orgId: string): Promise<SplitClass[] | null> {
    const { data, error } = await db.from("organizations").select("split_classes").eq("id", orgId).maybeSingle();
    if (error) throw error;
    return readStoredSplitClasses((data as { split_classes?: unknown } | null)?.split_classes);
}

/**
 * The list that governs a split of content of `orgId`: in a firm's workspace
 * the firm's, else the built-in one; in the personal workspace (`orgId` null)
 * the person's, else the built-in one. A personal list never reaches into a
 * firm's workspace, and the firm's never into the personal one.
 */
export async function resolveSplitClasses(
    db: Db,
    userId: string,
    orgId: string | null | undefined,
): Promise<EffectiveSplitClasses> {
    if (orgId) {
        const firm = await readOrgSplitClasses(db, orgId);
        if (firm) return { classes: firm, source: "org" };
    } else {
        const own = await readUserSplitClasses(db, userId);
        if (own) return { classes: own, source: "user" };
    }
    return { classes: DEFAULT_SPLIT_CLASSES.map((c) => ({ ...c })), source: "default" };
}

/** Replace a person's list; null restores the built-in one. Returns false when the profile row does not exist. */
export async function saveUserSplitClasses(db: Db, userId: string, classes: SplitClass[] | null): Promise<boolean> {
    const { data, error } = await db
        .from("user_profiles")
        .update({ split_classes: classes })
        .eq("user_id", userId)
        .select("user_id");
    if (error) throw error;
    return (data ?? []).length > 0;
}

/** Replace a firm's list; null restores the built-in one. Returns false when the firm does not exist. */
export async function saveOrgSplitClasses(db: Db, orgId: string, classes: SplitClass[] | null): Promise<boolean> {
    const { data, error } = await db
        .from("organizations")
        .update({ split_classes: classes, updated_at: new Date().toISOString() })
        .eq("id", orgId)
        .select("id");
    if (error) throw error;
    return (data ?? []).length > 0;
}
