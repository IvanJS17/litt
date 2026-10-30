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
import { extractDocumentMarkdown } from "./tabular.extract";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { type Db } from "./tabular.shared";
import { loadReviewRows, type ReviewRow } from "../../lib/tabularReadAccess";

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
    const { data, error } = await db
        .from("documents")
        .select(
            "id, current_version_id, project_id, folder_id, library_folder_id",
        )
        .in("id", documentIds);
    if (error) throw new Error(error.message);
    const docs = (data ?? []) as (Omit<
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


/** Load one row of a review (with its source ids resolved), or null. */
export async function loadReviewRow(
    db: Db,
    reviewId: string,
    rowId: string,
): Promise<ReviewRow | null> {
    const rows = await loadReviewRows(db, reviewId);
    return rows.find((row) => row.id === rowId) ?? null;
}

export async function loadRowDocumentText(
    db: Db,
    row: ReviewRow,
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
                markdown = await extractDocumentMarkdown(
                    () => downloadFile(storagePath),
                    doc.file_type,
                );
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
