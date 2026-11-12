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
