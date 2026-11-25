import type { Readable } from "node:stream";
import JSZip from "jszip";
import { extractPdfText } from "../../lib/pdfText";
import { UserFacingError } from "../../lib/userFacingError";
import { firstXmlElement, scanXmlElements, xmlAttribute } from "../../lib/xmlScan";

export type PlaybookSourceRef = {
  id: string;
  kind: "paragraph" | "table_cell";
  text: string;
  style: string | null;
  level: number | null;
  table?: number;
  row?: number;
  column?: number;
};

export type PlaybookWordStructure = {
  format: "docx" | "pdf";
  blocks: Array<
    | {
        kind: "paragraph";
        sourceRef: string;
        text: string;
        style: string | null;
        level: number | null;
      }
    | {
        kind: "table";
        index: number;
        rows: Array<Array<{ sourceRef: string; text: string }>>;
      }
  >;
  sources: PlaybookSourceRef[];
  text: string;
};

function decodeXml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
  };
  // Decode only references in the original input. A decoded ampersand must
  // not start another decode (for example, &amp;lt; must remain &lt;).
  return value.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#[xX][0-9a-fA-F]+);/g,
    (_, entity: string) => {
      if (!entity.startsWith("#")) return named[entity];
      const hex = entity[1].toLowerCase() === "x";
      return String.fromCodePoint(
        Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10),
      );
    },
  );
}

function attr(attrs: string, name: string): string | null {
  const value = xmlAttribute(attrs, name);
  return value === null ? null : decodeXml(value);
}

/** The value of the first `tag` start tag in `xml`: its w:val, else its val. */
function tagValue(xml: string, tag: string): string | null {
  const element = firstXmlElement(xml, [], [tag]);
  return element ? attr(element.attrs, "w:val") ?? attr(element.attrs, "val") : null;
}

/** `text` without the blanks and tabs that come right before a line break. */
function stripBlanksBeforeLineBreaks(text: string): string {
  const pieces: string[] = [];
  let kept = 0;
  for (let i = 0; i < text.length; ) {
    if (text[i] !== " " && text[i] !== "\t") {
      i++;
      continue;
    }
    let end = i;
    while (text[end] === " " || text[end] === "\t") end++;
    if (text[end] === "\n") {
      pieces.push(text.slice(kept, i));
      kept = end;
    }
    i = end;
  }
  pieces.push(text.slice(kept));
  return pieces.join("");
}

function textFromParagraph(xml: string): string {
  const pieces: string[] = [];
  // A self-closing <w:t/> is an empty run, and a text run with no closing
  // tag is not one: neither takes the text of the run that follows.
  for (const element of scanXmlElements(xml, ["w:t"], ["w:tab", "w:br", "w:cr"])) {
    if (element.name === "w:tab") pieces.push("\t");
    else if (element.name === "w:t") {
      if (!element.selfClosing) pieces.push(decodeXml(element.inner));
    } else pieces.push("\n");
  }
  return stripBlanksBeforeLineBreaks(pieces.join("")).trim();
}

function styleNames(stylesXml: string): Map<string, string> {
  const styles = new Map<string, string>();
  for (const style of scanXmlElements(stylesXml, ["w:style"])) {
    const id = attr(style.attrs, "w:styleId");
    // The first self-closing <w:name/> of the style.
    let name: string | null = null;
    for (const tag of scanXmlElements(style.inner, [], ["w:name"])) {
      if (!tag.selfClosing) continue;
      name = attr(tag.attrs.slice(0, -1), "w:val");
      break;
    }
    if (id) styles.set(id, name || id);
  }
  return styles;
}

function paragraphMetadata(
  xml: string,
  styles: Map<string, string>,
  headingLevels: Map<string, number | null>,
): { style: string | null; level: number | null } {
  const styleId = tagValue(xml, "w:pStyle");
  const style = styleId ? styles.get(styleId) ?? styleId : null;
  const outline = tagValue(xml, "w:outlineLvl");
  let headingLevel: number | null = null;
  if (outline === null && style !== null) {
    // A style name can be long and many paragraphs can use it: read it once.
    if (!headingLevels.has(style)) {
      const headingMatch = style.match(/heading\s*(\d+)/i);
      headingLevels.set(style, headingMatch ? Number.parseInt(headingMatch[1], 10) : null);
    }
    headingLevel = headingLevels.get(style) ?? null;
  }
  const level = outline !== null ? Number.parseInt(outline, 10) + 1 : headingLevel;
  return { style, level: level !== null && Number.isFinite(level) ? level : null };
}

/**
 * A part of the Word file that inflates to more than this is not read. A
 * playbook body holds a few MiB of XML at the most (the import refuses more
 * than 150,000 characters of text), and a larger part only holds the jobs
 * thread and memory before that refusal.
 */
export const MAX_WORD_PART_BYTES = 16 * 1024 * 1024;

const TOO_LARGE = "The document is too large to import.";

/**
 * The text of a part of the Word file, or null when there is none. The part
 * is inflated in chunks and refused as soon as the text it holds passes the
 * bound, whatever size its header declares.
 */
async function readWordPart(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = entry.nodeStream("nodebuffer") as Readable;
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_WORD_PART_BYTES) {
        chunks.length = 0;
        stream.destroy();
        reject(new UserFacingError(TOO_LARGE));
      } else chunks.push(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export async function extractPlaybookWordStructure(
  buffer: Buffer,
): Promise<PlaybookWordStructure> {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await readWordPart(zip, "word/document.xml");
  if (!documentXml) throw new Error("The Word file does not contain a document body.");
  const stylesXml = (await readWordPart(zip, "word/styles.xml")) ?? "";
  const styles = styleNames(stylesXml);
  const headingLevels = new Map<string, number | null>();
  const body = firstXmlElement(documentXml, ["w:body"])?.inner;
  if (!body) throw new Error("The Word document body could not be read.");

  const blocks: PlaybookWordStructure["blocks"] = [];
  const sources: PlaybookSourceRef[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  for (const block of scanXmlElements(body, ["w:p", "w:tbl"])) {
    const xml = block.outer;
    if (block.name === "w:p") {
      const text = textFromParagraph(xml);
      if (!text) continue;
      paragraphIndex += 1;
      const sourceRef = `P${paragraphIndex}`;
      const metadata = paragraphMetadata(xml, styles, headingLevels);
      sources.push({
        id: sourceRef,
        kind: "paragraph",
        text,
        style: metadata.style,
        level: metadata.level,
      });
      blocks.push({ kind: "paragraph", sourceRef, text, ...metadata });
      continue;
    }

    tableIndex += 1;
    const rows: Array<Array<{ sourceRef: string; text: string }>> = [];
    let rowIndex = 0;
    for (const row of scanXmlElements(xml, ["w:tr"])) {
      rowIndex += 1;
      const cells: Array<{ sourceRef: string; text: string }> = [];
      let columnIndex = 0;
      for (const cell of scanXmlElements(row.inner, ["w:tc"])) {
        columnIndex += 1;
        const paragraphs = [...scanXmlElements(cell.inner, ["w:p"])]
          .map((item) => textFromParagraph(item.outer))
          .filter(Boolean);
        const text = paragraphs.join("\n").trim();
        const sourceRef = `T${tableIndex}R${rowIndex}C${columnIndex}`;
        cells.push({ sourceRef, text });
        if (text) {
          sources.push({
            id: sourceRef,
            kind: "table_cell",
            text,
            style: null,
            level: null,
            table: tableIndex,
            row: rowIndex,
            column: columnIndex,
          });
        }
      }
      if (cells.length) rows.push(cells);
    }
    if (rows.length) blocks.push({ kind: "table", index: tableIndex, rows });
  }

  const text = blocks
    .map((block) => {
      if (block.kind === "paragraph") {
        const prefix = block.level ? `${"#".repeat(Math.min(6, block.level))} ` : "";
        return `[${block.sourceRef}] ${prefix}${block.text}`;
      }
      return block.rows
        .map((row) => row.map((cell) => `[${cell.sourceRef}] ${cell.text}`).join(" | "))
        .join("\n");
    })
    .join("\n\n")
    .trim();

  if (!text) throw new Error("The Word playbook does not contain readable text.");
  return { format: "docx", blocks, sources, text };
}

/** A line extractPdfText writes between pages, not text from the PDF. */
const PDF_PAGE_MARKER = /^\[Page \d+(?: form fields)?\]$/;

/**
 * The same structure for a PDF playbook. A PDF has no paragraph or table
 * markup, so each block of lines extractPdfText separates with a vertical
 * gap becomes one cited paragraph, and a paragraph never spans a page.
 * The text is empty when no page has a text layer.
 */
export async function extractPlaybookPdfStructure(
  buffer: Buffer,
): Promise<PlaybookWordStructure> {
  const raw = await extractPdfText(
    buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer,
  );
  const blocks: PlaybookWordStructure["blocks"] = [];
  const sources: PlaybookSourceRef[] = [];
  let lines: string[] = [];
  const flush = () => {
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    lines = [];
    if (!text) return;
    const sourceRef = `P${sources.length + 1}`;
    sources.push({ id: sourceRef, kind: "paragraph", text, style: null, level: null });
    blocks.push({ kind: "paragraph", sourceRef, text, style: null, level: null });
  };
  for (const line of raw.split("\n")) {
    if (!line.trim() || PDF_PAGE_MARKER.test(line.trim())) flush();
    else lines.push(line.trim());
  }
  flush();

  const text = blocks
    .map((block) =>
      block.kind === "paragraph" ? `[${block.sourceRef}] ${block.text}` : "",
    )
    .join("\n\n")
    .trim();
  // Empty for a scanned PDF; the import explains that to the user.
  return { format: "pdf", blocks, sources, text };
}
