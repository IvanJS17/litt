import { loadVersionTextState, cachedTextForModel } from "../../lib/documentTextCache";
import { createTextExtractionCache, type TextExtractionCache } from "../../lib/textExtractionCache";
// Row loading for the tabular-review module.
//
// A review's grid is made of ROWS (tabular_review_rows): a row is either one
// document or a folder grouping several source documents. These helpers load
// the rows with their source-document ids resolved, and build the combined
// text a row's extraction runs over. The synchronous SSE route and the async
// extraction worker share this one copy.

import { ExtractionBusyError, ExtractionLimitError } from "../../lib/extraction/isolated";
import { downloadFile } from "../../lib/storage";
import { attachActiveVersionPaths } from "../../lib/documentVersions";
import { selectAllByKey, selectInBatches } from "../../lib/batchedQuery";
import { extractDocumentMarkdown } from "./tabular.extract";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { type Db } from "./tabular.shared";
import { type ReviewRow } from "../../lib/tabularReadAccess";

// Row readability lives in lib so the account export applies the same rule
// without importing this module (see lib/tabularReadAccess.ts).
export {
    filterReadableReviewRows,
    loadReviewRows,
    type ReviewRow,
} from "../../lib/tabularReadAccess";


export type SourceDocument = {
    id: string;
    filename: string;
    file_type: string | null;
    current_version_id?: string | null;
    project_id?: string | null;
    folder_id?: string | null;
    library_folder_id?: string | null;
};

export async function fetchSourceDocuments(
    db: Db,
    documentIds: string[],
): Promise<SourceDocument[]> {
    if (documentIds.length === 0) return [];
    const data = await selectInBatches("source documents", documentIds, (batch) =>
        db
            .from("documents")
            .select(
                "id, current_version_id, project_id, folder_id, library_folder_id",
            )
            .in("id", batch),
    );
    const docs = data as (Omit<
        SourceDocument,
        "filename" | "file_type"
    > & {
        filename?: string | null;
        file_type?: string | null;
    })[];
    await attachActiveVersionPaths(db, docs);
    const position = new Map(documentIds.map((id, index) => [id, index]));
    return docs
        .map((doc) => ({
            ...doc,
            filename: doc.filename?.trim() || "Untitled document",
            file_type: doc.file_type ?? null,
        }))
        .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
}


/**
 * Every cell of a review (only `columns`, which must include `id`), paged by
 * id so a review past max_rows cells is read completely instead of as a
 * plausible-looking prefix.
 */
export async function loadReviewCells<T extends Record<string, unknown> & { id: string } = Record<string, unknown> & { id: string }>(
    db: Db,
    reviewId: string,
    columns = "*",
): Promise<T[]> {
    return selectAllByKey<T>("review cells", () =>
        db.from("tabular_cells").select(columns).eq("review_id", reviewId),
    );
}

/** Load one row of a review (with its source ids resolved), or null. */
export async function loadReviewRow(
    db: Db,
    reviewId: string,
    rowId: string,
): Promise<ReviewRow | null> {
    const { data, error } = await db
        .from("tabular_review_rows")
        .select("*")
        .eq("review_id", reviewId)
        .eq("id", rowId)
        .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as ReviewRow;
    const { data: sources, error: sourceError } = await db
        .from("tabular_review_row_sources")
        .select("document_id")
        .eq("row_id", rowId)
        .order("sort_index", { ascending: true });
    if (sourceError) throw new Error(sourceError.message);
    return {
        ...row,
        source_document_ids: sources?.length
            ? sources.map((source) => source.document_id)
            : row.document_id ? [row.document_id] : [],
    };
}

export async function loadRowDocumentText(
    db: Db,
    row: ReviewRow,
    textCache: TextExtractionCache = createTextExtractionCache(),
): Promise<string> {
    const sourceIds =
        row.source_document_ids ?? (row.document_id ? [row.document_id] : []);
    const docs = await fetchSourceDocuments(db, sourceIds);
    const sections: string[] = [];
    for (const doc of docs) {
        const storagePath = (doc as SourceDocument & { storage_path?: string })
            .storage_path;
        let markdown = "";
        if (storagePath) {
            try {
                const stored = doc.current_version_id
                    ? await loadVersionTextState(db, doc.id, doc.current_version_id, storagePath) : null;
                if (stored?.text !== null && stored?.text !== undefined) {
                    markdown = cachedTextForModel(stored);
                } else {
                    const load = () => extractDocumentMarkdown(() => downloadFile(storagePath), doc.file_type);
                    // Without a revision we cannot safely reuse a mutable path.
                    markdown = stored
                        ? await textCache(`${doc.id}:${doc.current_version_id}:${stored.revision}:${storagePath}`, load)
                        : await load();
                }
            } catch (error) {
                // Do not ask the model to fill cells from a source we refused.
                if (error instanceof ExtractionBusyError || error instanceof ExtractionLimitError) throw error;
                // The row goes on with an empty source section; the
                // parser's or converter's error is the cause, so its
                // class and code say what failed. Logging the reported
                // object keeps the console bridge from filing it twice.
                const failure = new AppError(
                    "extraction.failed",
                    "Tabular source document text extraction failed",
                    { cause: error },
                );
                reportError(failure, { extra: { document_id: doc.id } });
                console.error(
                    `[tabular] extraction error doc=${doc.id}`,
                    failure,
                );
            }
        }
        sections.push(
            `## Source document: ${doc.filename}\nSource document ID: ${doc.id}\n\n${markdown}`,
        );
    }
    return sections.join("\n\n---\n\n");
}
