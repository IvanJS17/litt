// What a Word file holds that a conversion would lose or change: comments,
// tracked changes, pictures, notes, headers and footers. The counts come from
// the package itself (jszip), so the notice before converting describes this
// document and not a generic one.

import JSZip from "jszip";
import { scanXmlElements } from "./xmlScan";

export type DocxInventory = {
    comments: number;
    tracked_insertions: number;
    tracked_deletions: number;
    images: number;
    /** Footnotes and endnotes: the separators Word always writes are not notes. */
    footnotes: number;
    /** Header parts that carry text. */
    headers: number;
    /** Footer parts that carry text. */
    footers: number;
};

/** A part larger than this is not read: the counts that depend on it stay 0. */
const MAX_PART_BYTES = 64 * 1024 * 1024;

const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

const CLOSE_TEXT_TAG = "</w:t>";

/**
 * Whether a part holds a text run that is not blank. A run is a `<w:t>` start
 * tag (the name followed by `>` or a blank), then text and `</w:t>`. One
 * stray `<` among the text counts as a character of it, so
 * `<w:t> <b/> </w:t>` has text; two do not end the run.
 */
function hasTextRun(xml: string): boolean {
    for (const tag of scanXmlElements(xml, [], ["w:t"])) {
        if (tag.attrs !== "" && tag.attrs.charAt(0).trim() !== "") continue;
        const first = xml.indexOf("<", tag.end);
        if (first < 0) continue;
        if (xml.startsWith(CLOSE_TEXT_TAG, first) && xml.slice(tag.end, first).trim() !== "") return true;
        const second = xml.indexOf("<", first + 1);
        if (second >= 0 && xml.startsWith(CLOSE_TEXT_TAG, second)) return true;
    }
    return false;
}

async function readPart(zip: JSZip, name: string): Promise<string> {
    const entry = zip.file(name);
    if (!entry) return "";
    // jszip keeps the declared sizes on the entry; a lying header is bounded by the read below.
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof declared === "number" && declared > MAX_PART_BYTES) return "";
    return entry.async("string");
}

export async function inspectDocx(bytes: ArrayBuffer | Buffer): Promise<DocxInventory> {
    const zip = await JSZip.loadAsync(bytes);
    const document = await readPart(zip, "word/document.xml");
    const comments = await readPart(zip, "word/comments.xml");
    const footnotes = await readPart(zip, "word/footnotes.xml");
    const endnotes = await readPart(zip, "word/endnotes.xml");

    const partNames = Object.keys(zip.files);
    const withText = async (prefix: string) => {
        let total = 0;
        for (const name of partNames.filter((n) => new RegExp(`^word/${prefix}\\d*\\.xml$`).test(n))) {
            if (hasTextRun(await readPart(zip, name))) total++;
        }
        return total;
    };

    // A note without a w:type is a real one; separators carry w:type="separator" and the like.
    const realNotes = (xml: string, tag: string) => {
        let total = 0;
        for (const note of scanXmlElements(xml, [], [`w:${tag}`])) {
            if (note.attrs.charAt(0).trim() === "" && note.attrs !== "" && !note.attrs.includes("w:type=")) total++;
        }
        return total;
    };

    return {
        comments: count(comments, /<w:comment[\s>]/g),
        // Moves are tracked changes too: the origin counts as a deletion, the destination as an insertion.
        tracked_insertions: count(document, /<w:(?:ins|moveTo)[\s>/]/g),
        tracked_deletions: count(document, /<w:(?:del|moveFrom)[\s>/]/g),
        images: count(document, /<w:(?:drawing|pict)[\s>/]/g),
        footnotes: realNotes(footnotes, "footnote") + realNotes(endnotes, "endnote"),
        headers: await withText("header"),
        footers: await withText("footer"),
    };
}
