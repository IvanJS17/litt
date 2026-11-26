// Citation support check (docs/citation-support-check.md) for the tabular
// review: the citations of a cell, and the citations of the review chat.
//
// Both build the same inputs the chat builds (lib/citationSupport) and hand
// them to the same runner, after the row is saved and detached from the work
// that saved it: nothing here is awaited by the grid or by the chat, and
// nothing here throws. Silent mode: the result is stored as numbers and
// references only, never shown.
import {
    answerProse,
    buildCitationSupportInputs,
    createCitationSupportRunner,
    claimForRef,
    forgetCitationSupportChecks,
    inputFromSpans,
    MAX_CHECKED_CITATIONS,
    type CitationSupportInput,
} from "../../lib/citationSupport";
import { citationCheckApiKey } from "../../lib/chatFeatureGates";
import { BoundedTextError, replaceInlineCitations } from "../../lib/modelJsonFence";
import { createQuoteVerifier } from "../chat/chat.service";
import type { TabularCellStore } from "../chat/chat.service";
import { LEGAL_VERSION } from "../user/user.service";
import type { CellResult, Db } from "./tabular.shared";

/** Inline markers are `[[document:ID||page:N||quote:...]]`, `[[page:N||quote:...]]` or the spreadsheet form. */
const SOURCE_HEADER = "Source document ID: ";
const SECTION_END = "\n\n---\n\n## Source document:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InlineCitation = { documentId: string | null; quote: string };

/** The document and the quote of one inline marker, or null for a tag such as `[[Yes]]`. */
function parseInlineCitation(metadata: string): InlineCitation | null {
    const page = /^(?:document:([^|]+)\|\|)?page:(\d+)\|\|(?:quote:)?([\s\S]+)$/i.exec(metadata);
    if (page) return { documentId: page[1]?.trim() || null, quote: page[3].trim() };
    const at = metadata.search(/\|\|quote:/i);
    if (at < 0) return null;
    const quote = metadata.slice(at).replace(/^\|\|quote:/i, "").trim();
    const document = /(?:^|\|\|)document:([^|]+)/i.exec(metadata.slice(0, at));
    return quote ? { documentId: document?.[1]?.trim() || null, quote } : null;
}

/** The text of one source document inside the row's combined text (see loadRowDocumentText). */
function sourceSection(markdown: string, documentId: string): string | null {
    const header = `${SOURCE_HEADER}${documentId}\n\n`;
    const start = markdown.indexOf(header);
    if (start < 0) return null;
    const bodyStart = start + header.length;
    const end = markdown.indexOf(SECTION_END, bodyStart);
    return markdown.slice(bodyStart, end < 0 ? markdown.length : end);
}

/**
 * One input per verified citation of a finished cell: the cell's own words
 * around the marker are the claim, the cited quote is the quote, and the
 * context is the cited document's text around it. A quote that is not in the
 * document, or a document the row does not hold, is skipped (as in the chat).
 */
export function cellCitationInputs(args: {
    result: CellResult;
    /** The row's combined source text, as the model read it. */
    markdown: string;
    /** The row's source documents: a citation without a document id belongs to the only one. */
    sourceDocumentIds: readonly string[];
}): CitationSupportInput[] {
    const inputs: CitationSupportInput[] = [];
    let ref = 0;
    // Markers examined, found or not: an unverified one costs as much as a verified one.
    let examined = 0;
    // Each source section is cut out and indexed at most once per cell.
    const sections = new Map<string, { source: string; verify: ReturnType<typeof createQuoteVerifier> } | null>();
    const sectionFor = (documentId: string) => {
        if (!sections.has(documentId)) {
            const source = sourceSection(args.markdown, documentId);
            sections.set(documentId, source ? { source, verify: createQuoteVerifier(source) } : null);
        }
        return sections.get(documentId) ?? null;
    };
    for (const field of [args.result.summary, args.result.reasoning]) {
        if (!field) continue;
        const found = new Map<number, InlineCitation>();
        // Each citation marker becomes a plain [n], so the sentence it ends is
        // found the way the chat finds it. A cell over the shared bound is not checked.
        let prose: string;
        try {
            prose = replaceInlineCitations(field, (marker, metadata) => {
                const citation = parseInlineCitation(metadata);
                if (!citation) return marker;
                ref += 1;
                found.set(ref, citation);
                return `[${ref}]`;
            });
        } catch (error) {
            if (error instanceof BoundedTextError) continue;
            throw error;
        }
        for (const [n, citation] of found) {
            if (examined >= MAX_CHECKED_CITATIONS) return inputs;
            examined += 1;
            const documentId =
                citation.documentId ??
                (args.sourceDocumentIds.length === 1 ? args.sourceDocumentIds[0] : null);
            const section = documentId ? sectionFor(documentId) : null;
            if (!documentId || !section) continue;
            const claim = claimForRef(prose, n);
            if (!claim) continue;
            const { source } = section;
            const verification = section.verify(citation.quote);
            if (
                !verification.verified ||
                typeof verification.start_char !== "number" ||
                typeof verification.end_char !== "number"
            )
                continue;
            inputs.push(
                inputFromSpans({
                    ref: n,
                    claim,
                    source,
                    documentId: UUID.test(documentId) ? documentId : null,
                    versionId: null,
                    spans: [
                        {
                            start: verification.start_char,
                            end: verification.end_char,
                            text: verification.source_excerpt ?? citation.quote,
                        },
                    ],
                }),
            );
        }
    }
    return inputs;
}

/** What a cell looks like to the review chat: its words without the citation markers. */
const plainCell = (cell: { summary: string; reasoning?: string }) => {
    try {
        return [cell.summary, cell.reasoning ?? ""]
            .map((part) => replaceInlineCitations(part, (marker, metadata) => (parseInlineCitation(metadata) ? "" : marker)))
            .filter(Boolean)
            .join("\n");
    } catch (error) {
        // A cell over the shared bound is not a source to quote from.
        if (error instanceof BoundedTextError) return "";
        throw error;
    }
};

/**
 * One input per citation of a tabular chat answer. Those citations quote the
 * review's own cells (not the source documents): the claim is the answer's
 * sentence, the quote is the cited cell text, and the context is that cell.
 */
export async function chatCitationInputs(args: {
    fullText: string;
    annotations: readonly { ref: number; col_index: number; row_index: number; quote: string }[];
    store: TabularCellStore;
}): Promise<CitationSupportInput[]> {
    // col_index and row_index are positions (the COL/ROW numbers of the
    // prompt); the store keys cells by the column's own index, which has gaps
    // once a column is deleted.
    // Each cell is cleaned once per answer, however many annotations cite it.
    const cleaned = new Map<string, string>();
    const cellText = (annotation: { col_index: number; row_index: number }) => {
        const column = args.store.columns[annotation.col_index];
        const document = args.store.documents[annotation.row_index];
        if (!column || !document) return "";
        const key = `${column.index}:${document.id}`;
        let text = cleaned.get(key);
        if (text === undefined) {
            const cell = args.store.cells.get(key);
            text = cell ? plainCell(cell) : "";
            cleaned.set(key, text);
        }
        return text;
    };
    // At most the checked number of annotations are verified, found or not,
    // and each cited cell is indexed once however many annotations cite it.
    const verifiers = new Map<string, ReturnType<typeof createQuoteVerifier>>();
    const citations: { ref: number; doc_id: string; quotes: { quote: string; verification: ReturnType<ReturnType<typeof createQuoteVerifier>> }[] }[] = [];
    for (const annotation of args.annotations) {
        if (citations.length >= MAX_CHECKED_CITATIONS) break;
        if (!annotation || typeof annotation.ref !== "number" || typeof annotation.quote !== "string") continue;
        const text = cellText(annotation);
        if (!text) continue;
        const key = `${annotation.col_index}:${annotation.row_index}`;
        let verify = verifiers.get(key);
        if (!verify) {
            verify = createQuoteVerifier(text);
            verifiers.set(key, verify);
        }
        citations.push({ ref: annotation.ref, doc_id: key, quotes: [{ quote: annotation.quote, verification: verify(annotation.quote) }] });
    }
    return buildCitationSupportInputs({
        prose: answerProse(args.fullText, "<CITATIONS>"),
        citations,
        getSourceText: async (key) => {
            const [col, row] = key.split(":").map(Number);
            return cellText({ col_index: col, row_index: row });
        },
    });
}

/**
 * Forget the silent citation checks of cells whose content was blanked
 * (clear-cells). Only deletes results; never sends anything.
 */
export async function forgetTabularCellChecks(db: Db, cellIds: readonly string[]): Promise<void> {
    for (let i = 0; i < cellIds.length; i += CELL_CHECK_DELETE_BATCH)
        await forgetCitationSupportChecks(db, {
            surface: "tabular_cell",
            ownerIds: cellIds.slice(i, i + CELL_CHECK_DELETE_BATCH),
        });
}

const CELL_CHECK_DELETE_BATCH = 200;

/**
 * The cell check of one run (a review's generation, a worker's row, a single
 * regeneration), or undefined when the server switch or the key is off. The person's permission is read once, on the first cell that
 * has something to check, and never before the cell is saved.
 */
export type TabularCellCheck = (cell: {
    cellId: string;
    result: CellResult;
    markdown: string;
    sourceDocumentIds: readonly string[];
}) => void;

export function createTabularCellCheck(args: {
    db: Db;
    /** The person whose action started the generation: their opt-out and acceptance count. */
    userId: string;
    reviewId: string;
}): TabularCellCheck | undefined {
    // Without the server switch and the platform key this capability runs no code.
    if (!citationCheckApiKey()) return undefined;
    let runner: ReturnType<typeof createCitationSupportRunner> | undefined;
    // One lookup of the review's firm per run, not one per cell.
    let orgId: Promise<string | null> | undefined;
    const reviewOrgId = () =>
        (orgId ??= (async () => {
            const { data } = await args.db.from("tabular_reviews").select("org_id").eq("id", args.reviewId).maybeSingle();
            return (data as { org_id?: string | null } | null)?.org_id ?? null;
        })());
    return (cell) => {
        void (async () => {
            try {
                // The previous content's results go first, even when the new
                // content has nothing to check.
                await forgetCitationSupportChecks(args.db, { surface: "tabular_cell", ownerId: cell.cellId });
                const inputs = cellCitationInputs(cell);
                if (!inputs.length) return;
                runner ??= createCitationSupportRunner({
                    db: args.db,
                    userId: args.userId,
                    legalVersion: LEGAL_VERSION,
                    orgId: reviewOrgId,
                });
                await (await runner)?.run({ surface: "tabular_cell", ownerId: cell.cellId }, inputs);
            } catch {
                // Silent mode: nothing here reaches the grid.
            }
        })();
    };
}

/** After a review chat answer is saved: fire and forget. */
export function checkTabularChatCitations(args: {
    db: Db;
    userId: string;
    orgId: string | null | undefined;
    messageId: string;
    fullText: string;
    annotations: readonly { ref: number; col_index: number; row_index: number; quote: string }[];
    store: TabularCellStore;
}): void {
    void (async () => {
        try {
            if (!args.annotations.length) return;
            const runner = await createCitationSupportRunner({
                db: args.db,
                userId: args.userId,
                legalVersion: LEGAL_VERSION,
                orgId: args.orgId,
            });
            if (!runner) return;
            const inputs = await chatCitationInputs(args);
            await runner.run({ surface: "tabular_chat", ownerId: args.messageId }, inputs);
        } catch {
            // Silent mode: nothing here reaches the chat.
        }
    })();
}
