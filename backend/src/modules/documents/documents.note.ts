// A new Markdown note, written from text, in a matter.
//
// The result is always a NEW document in the matter's top level, version 1,
// `source` 'mcp_client' (written by another app, such as Claude, on the person's behalf), stored as a
// UTF-8 `.md` file exactly as given. Nothing that exists is changed. Who may
// create one is who may open an upload into the matter on the web: a member
// with edit rights on it (a viewer is refused, a stranger sees "not found"),
// and a pasante's note is sealed as the version of its author like any other.

import { checkProjectAccess } from "../../lib/access";
import { can } from "../../lib/permissions";
import { storageEnabled } from "../../lib/storage";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import { namesInContainer, storeDerivedDocument } from "./documents.convert";
import type { Db } from "./documents.shared";

/** Most characters of Markdown one note may hold. */
export const NOTE_MAX_MARKDOWN_CHARS = 100_000;
export const NOTE_MAX_TITLE_CHARS = 120;

export type NoteDocumentResult = {
    document_id: string;
    version_id: string;
    filename: string;
    project_id: string;
};

/** `Title.md`, then `Title (2).md`… until it differs from every name in the matter's top level. */
export function noteFilename(title: string, taken: ReadonlySet<string>): string {
    const stem =
        title
            .normalize("NFC")
            .replace(/[^\p{L}\p{M}\p{N} -]/gu, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, NOTE_MAX_TITLE_CHARS)
            .trim() || "Nota";
    for (let counter = 1; ; counter++) {
        const candidate = `${stem}${counter > 1 ? ` (${counter})` : ""}.md`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

export async function createNoteDocument(
    db: Db,
    args: { projectId: string; userId: string; userEmail: string | undefined; title: unknown; markdown: unknown },
): Promise<ServiceResult<NoteDocumentResult>> {
    const { title, markdown } = args;
    if (typeof title !== "string" || !title.trim()) return failure("validation", "title is required");
    if (typeof markdown !== "string" || !markdown.trim()) return failure("validation", "markdown is required");
    if (markdown.length > NOTE_MAX_MARKDOWN_CHARS)
        return failure(
            "validation",
            `The note is longer than ${NOTE_MAX_MARKDOWN_CHARS} characters.`,
            "note_too_large",
        );

    const access = await checkProjectAccess(args.projectId, args.userId, args.userEmail, db);
    if (!access.ok) return failure("not_found", "Project not found");
    if (!can(access.projectRole, "content.edit"))
        return failure("forbidden", "You do not have permission to write in this project.");
    if (!storageEnabled) return failure("unavailable", "File storage is not available right now.");

    const doc = {
        // `namesInContainer` only reads project/folder/org; the row does not exist yet, so it has no id.
        id: "",
        user_id: args.userId,
        project_id: args.projectId,
        org_id: access.project.org_id ?? null,
        folder_id: null,
    };
    let filename: string;
    try {
        filename = noteFilename(title, await namesInContainer(db, doc, args.userId));
    } catch (error) {
        return internalFailure(error);
    }
    const stored = await storeDerivedDocument(db, {
        doc,
        userId: args.userId,
        filename,
        bytes: Buffer.from(markdown, "utf8"),
        fileType: "md",
        source: "mcp_client",
    });
    if (!stored.ok) return stored;
    return ok({
        document_id: stored.data.document_id,
        version_id: stored.data.version_id,
        filename: stored.data.filename,
        project_id: args.projectId,
    });
}
