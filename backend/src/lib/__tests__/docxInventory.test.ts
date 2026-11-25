import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { inspectDocx } from "../docxInventory";
import { buildRichDocx } from "./docxFixtures";

describe("inspectDocx", () => {
    it("counts each thing a conversion would lose", async () => {
        expect(await inspectDocx(await buildRichDocx())).toEqual({
            comments: 1,
            tracked_insertions: 1,
            tracked_deletions: 1,
            images: 1,
            footnotes: 1,
            headers: 1,
            footers: 1,
        });
    });

    it("counts zero for a file with none of them", async () => {
        const zip = new JSZip();
        zip.file("word/document.xml", '<w:document><w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>');
        zip.file("word/header1.xml", "<w:hdr><w:p><w:r><w:t></w:t></w:r></w:p></w:hdr>");
        zip.file(
            "word/footnotes.xml",
            '<w:footnotes><w:footnote w:type="separator" w:id="-1"/><w:footnote w:type="continuationSeparator" w:id="0"/></w:footnotes>',
        );
        expect(await inspectDocx(await zip.generateAsync({ type: "nodebuffer" }))).toEqual({
            comments: 0,
            tracked_insertions: 0,
            tracked_deletions: 0,
            images: 0,
            footnotes: 0,
            headers: 0,
            footers: 0,
        });
    });

    it("counts moves as tracked changes, endnotes as notes and ignores table borders named ins*", async () => {
        const zip = new JSZip();
        zip.file(
            "word/document.xml",
            "<w:document><w:body><w:moveFrom w:id='1'/><w:moveTo w:id='2'/><w:tblBorders><w:insideH w:val='single'/></w:tblBorders><w:pict/></w:body></w:document>",
        );
        zip.file("word/endnotes.xml", '<w:endnotes><w:endnote w:id="1"><w:p/></w:endnote></w:endnotes>');
        expect(await inspectDocx(await zip.generateAsync({ type: "nodebuffer" }))).toMatchObject({
            tracked_insertions: 1,
            tracked_deletions: 1,
            images: 1,
            footnotes: 1,
        });
    });

    it("rejects a file that is not a zip", async () => {
        await expect(inspectDocx(Buffer.from("nope"))).rejects.toThrow();
    });
});

describe("inspectDocx of well-formed parts", () => {
    const part = (name: string, xml: string) => {
        const zip = new JSZip();
        zip.file("word/document.xml", "<w:document><w:body/></w:document>");
        zip.file(name, xml);
        return zip.generateAsync({ type: "nodebuffer" });
    };

    it("counts a header or footer only when a text run holds something other than blanks", async () => {
        const zip = new JSZip();
        zip.file("word/document.xml", "<w:document><w:body/></w:document>");
        zip.file("word/header1.xml", '<w:hdr><w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p></w:hdr>');
        zip.file("word/header2.xml", '<w:hdr><w:p><w:r><w:t xml:space="preserve"> Acme </w:t></w:r></w:p></w:hdr>');
        zip.file("word/header3.xml", "<w:hdr><w:p><w:r><w:t/></w:r><w:r><w:tab/></w:r></w:p></w:hdr>");
        zip.file("word/footer1.xml", "<w:ftr><w:p><w:r><w:t>Page</w:t></w:r></w:p></w:ftr>");
        zip.file("word/footer2.xml", "<w:ftr><w:p><w:r><w:t>   \n\t</w:t></w:r></w:p></w:ftr>");
        zip.file("word/footer3.xml", "<w:ftr><w:p><w:r><w:t>a &amp; b</w:t></w:r><w:r><w:t>more</w:t></w:r></w:p></w:ftr>");
        // One stray tag inside a run is read as a character of its text; two are not.
        zip.file("word/footer4.xml", "<w:ftr><w:p><w:r><w:t>text <b/> more</w:t></w:r></w:p></w:ftr>");
        zip.file("word/footer5.xml", "<w:ftr><w:p><w:r><w:t>a<b/>c<i/>d</w:t></w:r></w:p></w:ftr>");
        zip.file("word/footer6.xml", "<w:ftr><w:p><w:r><w:t> <b/> </w:t></w:r></w:p></w:ftr>");
        zip.file("word/footer7.xml", '<w:ftr><w:p><w:r><w:t a="x>y">z</w:t></w:r></w:p></w:ftr>');
        const inventory = await inspectDocx(await zip.generateAsync({ type: "nodebuffer" }));
        expect(inventory).toMatchObject({ headers: 1, footers: 5 });
    });

    it("counts a note without a type and not a separator, whatever the order of its attributes", async () => {
        const notes = await part(
            "word/footnotes.xml",
            `<w:footnotes>
              <w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>
              <w:footnote w:id="1"><w:p><w:r><w:t>One</w:t></w:r></w:p></w:footnote>
              <w:footnote w:id="2" w:type="continuationNotice"><w:p/></w:footnote>
              <w:footnote
                 w:id="3"><w:p/></w:footnote>
              <w:footnotePr/><w:footnoteReference w:id="1"/>
            </w:footnotes>`,
        );
        expect((await inspectDocx(notes)).footnotes).toBe(2);
    });
});

describe("inspectDocx cost", () => {
    // Bounds are generous: the machine may be busy, and the quadratic scans
    // these replaced take many seconds on inputs this size.
    const shapes: Record<string, (n: number) => Record<string, string>> = {
        "text runs in a header never ended by >": (n) => ({ "word/header1.xml": `<w:hdr>${"<w:t ".repeat(n)}</w:hdr>` }),
        "footnote tags never ended by >": (n) => ({ "word/footnotes.xml": `<w:footnotes>${"<w:footnote ".repeat(n)}` }),
        "endnote tags that carry a type": (n) => ({
            "word/endnotes.xml": `<w:endnotes>${'<w:endnote w:id="1" '.repeat(n)}</w:endnotes>`,
        }),
    };

    async function elapsed(files: Record<string, string>): Promise<number> {
        const zip = new JSZip();
        zip.file("word/document.xml", "<w:document/>");
        for (const [name, xml] of Object.entries(files)) zip.file(name, xml);
        const buffer = await zip.generateAsync({ type: "nodebuffer" });
        const started = performance.now();
        await inspectDocx(buffer);
        return performance.now() - started;
    }

    it.each(Object.entries(shapes))(
        "reads %s in time proportional to its length",
        async (_label, make) => {
            await elapsed(make(200));
            // The fastest of three runs: a pause of a busy machine slows one run, not all.
            const small = Math.min(await elapsed(make(10_000)), await elapsed(make(10_000)), await elapsed(make(10_000)));
            expect(small, `10000 tags took ${small.toFixed(0)} ms`).toBeLessThan(1_500);
            const large = Math.min(await elapsed(make(40_000)), await elapsed(make(40_000)));
            expect(large, `40000 tags took ${large.toFixed(0)} ms`).toBeLessThan(6_000);
            const ratio = large / Math.max(small, 50);
            expect(ratio, `ratio ${ratio.toFixed(1)}`).toBeLessThan(10);
        },
        120_000,
    );
});
