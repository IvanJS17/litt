import { describe, expect, it } from "vitest";
import { scriptedDb } from "../../__tests__/helpers/scriptedDb";
import { loadVersionTextState, cachedTextForModel } from "../documentTextCache";
const slice = (text: string, length = text.length) => ({ rpc: "document_text_slice", data: { text, text_length: length } });
describe("revision-bound text cache", () => {
    it("uses ready text only from the same live document/version/revision/path", async () => {
        const fake = scriptedDb([{ table: "document_versions", data: { text_revision: "new", document_version_texts: { extractor_version: 1, source_revision: "new", status: "ready", textless_page_count: 2 } } }, slice("clause")]);
        const state = await loadVersionTextState(fake.db, "doc", "version", "source");
        expect(state).toEqual({ revision: "new", text: "clause", textlessPageCount: 2 });
        expect(fake.calls[0].filters).toEqual([["eq", "id", "version"], ["eq", "document_id", "doc"], ["is", "deleted_at", null], ["eq", "storage_path", "source"]]);
        expect(cachedTextForModel(state!)).toContain("need OCR");
        expect(fake.calls[1].args).toEqual({ p_version_id: "version", p_source_revision: "new", p_offset: 0, p_length: 500_000 }); fake.done();
    });
    it.each([['old', 'ready'], ['new', 'pending'], ['new', 'failed']])("refuses %s/%s text", async (revision, status) => {
        const fake = scriptedDb([{ table: "document_versions", data: { text_revision: "new", document_version_texts: { extractor_version: 1, source_revision: revision, status } } }]);
        expect((await loadVersionTextState(fake.db, "doc", "version"))?.text).toBeNull();
    });
    it("refuses ready text produced by an obsolete extractor", async () => {
        const fake = scriptedDb([{ table: "document_versions", data: { text_revision: "new", document_version_texts: { extractor_version: 0, source_revision: "new", status: "ready" } } }]);
        expect((await loadVersionTextState(fake.db, "doc", "version"))?.text).toBeNull();
    });
    it("distinguishes ready empty text from a missing cache entry", async () => {
        const fake = scriptedDb([{ table: "document_versions", data: { text_revision: "new", document_version_texts: [{ extractor_version: 1, source_revision: "new", status: "ready" }] } }, slice("")]);
        expect((await loadVersionTextState(fake.db, "doc", "version"))?.text).toBe("");
    });
    it("never takes the text through the version query: a long text arrives in bounded slices", async () => {
        const text = "é".repeat(500_000) + "😀" + "tail";
        const fake = scriptedDb([
            { table: "document_versions", data: { text_revision: "new", document_version_texts: { extractor_version: 1, source_revision: "new", status: "ready", textless_page_count: 0 } } },
            slice(text.slice(0, 500_000), 500_005), slice(Array.from(text).slice(500_000).join(""), 500_005),
        ]);
        expect((await loadVersionTextState(fake.db, "doc", "version"))?.text).toBe(text);
        expect(fake.calls.slice(1).map((c) => (c.args as { p_offset: number }).p_offset)).toEqual([0, 500_000]); fake.done();
    });
});
