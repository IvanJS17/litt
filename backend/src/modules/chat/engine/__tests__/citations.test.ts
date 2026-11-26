import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
    parseCitations,
    parseCitationsWithDiagnostics,
    parsePartialCitationObjects,
    createCitation,
    CITATIONS_OPEN_TAG,
    CITATIONS_CLOSE_TAG,
} from "../citations";
import type { DocIndex, DocStore } from "../types";

function citationsBlock(json: string) {
    return `Answer text.\n${CITATIONS_OPEN_TAG}\n${json}\n${CITATIONS_CLOSE_TAG}`;
}

// ---------------------------------------------------------------------------
// parseCitationsWithDiagnostics
// ---------------------------------------------------------------------------

describe("parseCitationsWithDiagnostics", () => {
    it("reports no block when the tags are absent", () => {
        const { citations, diagnostics } =
            parseCitationsWithDiagnostics("plain answer");
        expect(citations).toEqual([]);
        expect(diagnostics).toEqual({ hasBlock: false, rawLength: 0, error: null });
    });

    it("reports a JSON parse error for malformed block content", () => {
        const { citations, diagnostics } = parseCitationsWithDiagnostics(
            citationsBlock("[{not json"),
        );
        expect(citations).toEqual([]);
        expect(diagnostics.hasBlock).toBe(true);
        expect(diagnostics.rawLength).toBeGreaterThan(0);
        expect(diagnostics.error).toBeTruthy();
    });

    it("reports an error when the block JSON is not an array", () => {
        const { citations, diagnostics } = parseCitationsWithDiagnostics(
            citationsBlock('{"ref": 1}'),
        );
        expect(citations).toEqual([]);
        expect(diagnostics.error).toBe("CITATIONS block JSON was not an array.");
    });

    // The block is parsed again on every streamed chunk, so a missing close
    // tag over a long answer must cost linear time. The regex form
    // (<CITATIONS>\s*([\s\S]*?)\s*</CITATIONS>) backtracks the whitespace run
    // one character at a time and never returns here; this proves the scan
    // terminates by running it in a child process with a hard timeout.
    it("does not spend unbounded time on a missing close tag", () => {
        const steps = [
            "const { parseCitationsWithDiagnostics } = require(process.argv[1]);",
            "process.stdout.write(JSON.stringify(parseCitationsWithDiagnostics('<CITATIONS>' + '\\t'.repeat(20000))));",
        ].join("\n");
        const output = execFileSync(
            process.execPath,
            [
                "--import",
                "tsx",
                "-e",
                steps,
                // Test files are typechecked as CommonJS here, where import.meta
                // is unavailable; vitest runs from the backend package root.
                join(process.cwd(), "src/modules/chat/engine/citations.ts"),
            ],
            { timeout: 5000, encoding: "utf8", stdio: "pipe" },
        );
        expect(JSON.parse(output)).toEqual({
            citations: [],
            diagnostics: { hasBlock: false, rawLength: 0, error: null },
        });
    });
});

// ---------------------------------------------------------------------------
// parseCitations — document citations
// ---------------------------------------------------------------------------

describe("parseCitations (document citations)", () => {
    it("parses a minimal document citation", () => {
        const [citation] = parseCitations(
            citationsBlock(
                '[{"ref": 1, "doc_id": "doc-1", "page": 3, "quote": "the term"}]',
            ),
        );
        expect(citation).toMatchObject({
            kind: "document",
            ref: 1,
            doc_id: "doc-1",
            page: 3,
            quote: "the term",
        });
        expect(citation.quotes).toHaveLength(1);
    });

    it("derives ref from a [N] marker when ref is missing", () => {
        const [citation] = parseCitations(
            citationsBlock(
                '[{"marker": "[7]", "doc_id": "doc-1", "page": 1, "quote": "q"}]',
            ),
        );
        expect(citation.ref).toBe(7);
    });

    it("drops entries without a usable ref or marker", () => {
        expect(
            parseCitations(
                citationsBlock('[{"doc_id": "doc-1", "quote": "q", "marker": "nope"}]'),
            ),
        ).toEqual([]);
    });

    it("drops document entries without doc_id or quote", () => {
        expect(
            parseCitations(citationsBlock('[{"ref": 1, "doc_id": "doc-1"}]')),
        ).toEqual([]);
        expect(
            parseCitations(citationsBlock('[{"ref": 1, "quote": "q"}]')),
        ).toEqual([]);
    });

    it("drops non-object entries but keeps valid ones", () => {
        const citations = parseCitations(
            citationsBlock(
                '[null, "junk", {"ref": 2, "doc_id": "doc-2", "page": 4, "quote": "kept"}]',
            ),
        );
        expect(citations).toHaveLength(1);
        expect(citations[0]).toMatchObject({ ref: 2, doc_id: "doc-2" });
    });

    it("accepts a text field as a quote alias", () => {
        const [citation] = parseCitations(
            citationsBlock('[{"ref": 1, "doc_id": "doc-1", "page": 2, "text": "aliased"}]'),
        );
        expect(citation.kind).toBe("document");
        expect((citation as { quote: string }).quote).toBe("aliased");
    });

    it("normalizes pages: numbers kept, ranges kept, junk becomes 1", () => {
        const citations = parseCitations(
            citationsBlock(
                '[{"ref": 1, "doc_id": "d", "page": 5, "quote": "a"},' +
                    '{"ref": 2, "doc_id": "d", "page": "3-5", "quote": "b"},' +
                    '{"ref": 3, "doc_id": "d", "page": "12", "quote": "c"},' +
                    '{"ref": 4, "doc_id": "d", "page": "unknown", "quote": "d"}]',
            ),
        );
        expect(citations.map((c) => (c as { page: number | string }).page)).toEqual([
            5,
            "3-5",
            12,
            1,
        ]);
    });

    it("keeps at most 3 quotes and inherits top-level page/sheet/cell", () => {
        const [citation] = parseCitations(
            citationsBlock(
                JSON.stringify([
                    {
                        ref: 1,
                        doc_id: "doc-1",
                        page: 9,
                        sheet: "Summary",
                        cell: "B7",
                        quotes: [
                            { quote: "one" },
                            { quote: "two", page: 2 },
                            { quote: "three", sheet: "Detail", cell: "C1" },
                            { quote: "four" },
                        ],
                    },
                ]),
            ),
        );
        expect(citation.kind).toBe("document");
        const doc = citation as {
            page: number | string;
            quotes: { page: number | string; quote: string; sheet?: string; cell?: string }[];
        };
        expect(doc.quotes).toHaveLength(3);
        expect(doc.quotes[0]).toEqual({
            page: 9,
            quote: "one",
            sheet: "Summary",
            cell: "B7",
        });
        expect(doc.quotes[1].page).toBe(2);
        expect(doc.quotes[2]).toMatchObject({ sheet: "Detail", cell: "C1" });
        // Top-level fields mirror the first quote.
        expect(doc.page).toBe(9);
    });

    it("skips quote rows without text", () => {
        const [citation] = parseCitations(
            citationsBlock(
                '[{"ref": 1, "doc_id": "doc-1", "page": 1,' +
                    ' "quotes": [{"page": 2}, {"quote": "  "}, {"quote": "real"}]}]',
            ),
        );
        expect((citation as { quotes: unknown[] }).quotes).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// parseCitations — case-law citations are not part of the vocabulary
// ---------------------------------------------------------------------------

describe("parseCitations (case-law citations removed)", () => {
    it("drops a cluster_id entry instead of emitting a case citation", () => {
        expect(
            parseCitations(
                citationsBlock(
                    '[{"ref": 1, "cluster_id": 12345, "quotes": [{"opinion_id": 7, "quote": "held that"}]}]',
                ),
            ),
        ).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// parsePartialCitationObjects
// ---------------------------------------------------------------------------

describe("parsePartialCitationObjects", () => {
    it("returns [] when no array has started", () => {
        expect(parsePartialCitationObjects("streaming <CITATIONS>")).toEqual([]);
    });

    it("extracts complete objects and ignores a trailing incomplete one", () => {
        const partial =
            '<CITATIONS>[{"ref": 1, "doc_id": "doc-1", "page": 2, "quote": "done"},' +
            ' {"ref": 2, "doc_id": "doc-2", "page": 3, "quote": "still stream';
        const citations = parsePartialCitationObjects(partial);
        expect(citations).toHaveLength(1);
        expect(citations[0]).toMatchObject({ ref: 1, doc_id: "doc-1" });
    });

    it("handles braces and escaped quotes inside string values", () => {
        const partial =
            '<CITATIONS>[{"ref": 1, "doc_id": "doc-1", "page": 1,' +
            ' "quote": "clause {a} says \\"stop\\""}';
        const citations = parsePartialCitationObjects(partial);
        expect(citations).toHaveLength(1);
        expect((citations[0] as { quote: string }).quote).toBe(
            'clause {a} says "stop"',
        );
    });

    it("ignores content after the closing tag", () => {
        const text =
            '<CITATIONS>[{"ref": 1, "doc_id": "a", "page": 1, "quote": "q"}]</CITATIONS>' +
            '[{"ref": 9, "doc_id": "b", "page": 1, "quote": "after"}]';
        const citations = parsePartialCitationObjects(text);
        expect(citations).toHaveLength(1);
        expect(citations[0]).toMatchObject({ ref: 1 });
    });

    it("stops at the array close bracket", () => {
        const text =
            '[{"ref": 1, "doc_id": "a", "page": 1, "quote": "q"}] {"ref": 2, "doc_id": "b", "page": 1, "quote": "outside"}';
        const citations = parsePartialCitationObjects(text);
        expect(citations).toHaveLength(1);
    });

    it("skips malformed objects but keeps later valid ones", () => {
        const text =
            '[{"ref": bad}, {"ref": 2, "doc_id": "doc-2", "page": 1, "quote": "ok"}';
        const citations = parsePartialCitationObjects(text);
        expect(citations).toHaveLength(1);
        expect(citations[0]).toMatchObject({ ref: 2 });
    });
});

// ---------------------------------------------------------------------------
// createCitation
// ---------------------------------------------------------------------------

describe("createCitation", () => {
    const docIndex: DocIndex = {
        "doc-1": {
            document_id: "uuid-aaa",
            filename: "contract.pdf",
            version_id: "ver-1",
            version_number: 2,
        },
    };

    it("builds a document citation payload from the doc index", () => {
        const [parsed] = parseCitations(
            citationsBlock('[{"ref": 1, "doc_id": "doc-1", "page": 4, "quote": "q"}]'),
        );
        expect(createCitation(parsed, docIndex)).toMatchObject({
            type: "citation_data",
            kind: "document",
            ref: 1,
            doc_id: "doc-1",
            document_id: "uuid-aaa",
            version_id: "ver-1",
            version_number: 2,
            filename: "contract.pdf",
            page: 4,
            quote: "q",
            document: {
                document_id: "uuid-aaa",
                title: "contract.pdf",
                type: "pdf",
                metadata: [],
                quotes: [{ quote: "q", target: { page: 4 } }],
            },
        });
    });

    it("falls back to the raw doc_id as filename when unresolvable", () => {
        const [parsed] = parseCitations(
            citationsBlock('[{"ref": 1, "doc_id": "doc-9", "page": 1, "quote": "q"}]'),
        );
        const citation = createCitation(parsed, docIndex);
        expect(citation).toMatchObject({
            filename: "doc-9",
            document_id: undefined,
            version_id: null,
        });
    });

    it("uses request-scoped document metadata for inline citations", () => {
        const [parsed] = parseCitations(
            citationsBlock('[{"ref": 1, "doc_id": "active-word-document", "quote": "q"}]'),
        );
        const docStore: DocStore = new Map([
            [
                "active-word-document",
                {
                    storage_path: "inline:word-document:test",
                    file_type: "text/markdown",
                    filename: "Contract.docx",
                    inline_text: "q",
                },
            ],
        ]);

        expect(createCitation(parsed, docIndex, docStore)).toMatchObject({
            filename: "Contract.docx",
            document: { title: "Contract.docx" },
        });
    });

    describe("a citation names the document it cites however the model named it", () => {
        const stored = (filename: string) => ({
            storage_path: "p",
            file_type: "pdf",
            filename,
        });
        const index: DocIndex = {
            "doc-1": {
                document_id: "uuid-aaa",
                filename: "contract.pdf",
                version_id: "ver-1",
                version_number: 2,
            },
            "doc-2": {
                document_id: "uuid-bbb",
                filename: "lease.pdf",
                version_id: "ver-9",
                version_number: 5,
            },
        };
        const store: DocStore = new Map([
            ["doc-1", stored("contract.pdf")],
            ["doc-2", stored("lease.pdf")],
        ]);
        const cite = (docId: string, docIndex = index, docStore = store) => {
            const [parsed] = parseCitations(
                citationsBlock(
                    JSON.stringify([{ ref: 1, doc_id: docId, quote: "q" }]),
                ),
            );
            return createCitation(parsed, docIndex, docStore);
        };
        const lease = {
            document_id: "uuid-bbb",
            version_id: "ver-9",
            version_number: 5,
            filename: "lease.pdf",
            document: {
                document_id: "uuid-bbb",
                version_id: "ver-9",
                version_number: 5,
            },
        };

        it("by label, by filename and by document id store the same document", () => {
            for (const name of ["doc-2", "lease.pdf", "uuid-bbb"]) {
                expect(cite(name)).toMatchObject({ doc_id: name, ...lease });
            }
        });

        it("keeps an unknown name as the model wrote it", () => {
            expect(cite("missing.pdf")).toMatchObject({
                doc_id: "missing.pdf",
                document_id: undefined,
                version_id: null,
                filename: "missing.pdf",
                document: { document_id: "missing.pdf", version_id: null },
            });
        });

        it("resolves the first of two documents with the same filename", () => {
            const twinIndex: DocIndex = {
                ...index,
                "doc-3": { ...index["doc-2"], document_id: "uuid-ccc" },
            };
            const twinStore: DocStore = new Map([...store, ["doc-3", stored("lease.pdf")]]);
            expect(cite("lease.pdf", twinIndex, twinStore)).toMatchObject({
                document_id: "uuid-bbb",
            });
        });

        it("keeps the open Word document's handle when the open document is in the store", () => {
            const wordIndex: DocIndex = {
                ...index,
                "active-word-document": {
                    document_id: "uuid-open",
                    filename: "Open.docx",
                    version_id: null,
                    version_number: null,
                },
            };
            const wordStore: DocStore = new Map([
                ...store,
                ["active-word-document", stored("Open.docx")],
                ["doc-9", stored("active-word-document")],
            ]);
            wordIndex["doc-9"] = {
                document_id: "uuid-file",
                filename: "active-word-document",
            };
            expect(cite("active-word-document", wordIndex, wordStore)).toMatchObject({
                document_id: "uuid-open",
                filename: "Open.docx",
            });
        });

        it("stores a document that is in the turn but not indexed under its label, by label or by filename", () => {
            // The document open in Word is offered under a fixed handle and has no stored document.
            const openStore: DocStore = new Map([
                ...store,
                ["active-word-document", { ...stored("Open.docx"), inline_text: "text" }],
            ]);
            for (const name of ["active-word-document", "Open.docx"]) {
                expect(cite(name, index, openStore)).toMatchObject({
                    doc_id: name,
                    document_id: undefined,
                    version_id: null,
                    filename: "Open.docx",
                    document: { document_id: "active-word-document", title: "Open.docx", version_id: null },
                });
            }
        });

        it("stores a file that is named like the handle under its own id when no document is open", () => {
            const fileIndex: DocIndex = {
                "doc-9": {
                    document_id: "uuid-file",
                    filename: "active-word-document",
                    version_id: "ver-3",
                    version_number: 1,
                },
            };
            const fileStore: DocStore = new Map([
                ["doc-9", stored("active-word-document")],
            ]);
            expect(cite("active-word-document", fileIndex, fileStore)).toMatchObject({
                document_id: "uuid-file",
                version_id: "ver-3",
                version_number: 1,
            });
        });
    });

});
