// The person's own list of document types for splitting a case file
// (layer 7, docs/document-split.md), from Settings > Features. Stored in
// user_profiles.split_classes; null means "use the firm's, then the built-in
// list". The resolution (personal, firm, built-in) lives in lib/ocr/splitClassStore.
import { readUserSplitClasses, saveUserSplitClasses } from "../../lib/ocr/splitClassStore";
import { parseSplitClassesBody, splitClassesSettings, type SplitClassesSettings } from "../../lib/ocr/splitClasses";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { type Db } from "./user.shared";

export async function getSplitClasses(db: Db, userId: string): Promise<ServiceResult<SplitClassesSettings>> {
    try {
        return ok(splitClassesSettings(await readUserSplitClasses(db, userId)));
    } catch (error) {
        return internalFailure(error);
    }
}

export async function saveSplitClasses(db: Db, userId: string, body: unknown): Promise<ServiceResult<SplitClassesSettings>> {
    const parsed = parseSplitClassesBody(body);
    if (!parsed.ok) return failure("validation", parsed.detail);
    try {
        if (!(await saveUserSplitClasses(db, userId, parsed.classes))) return failure("not_found", "Profile not found");
        return ok(splitClassesSettings(parsed.classes));
    } catch (error) {
        return internalFailure(error);
    }
}
