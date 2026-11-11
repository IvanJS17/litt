import { diffLines, diffWordsWithSpace } from "diff";

/**
 * The one text-diff algorithm in the app (jsdiff). Playbook redlines read
 * `diffWords`; the version comparison reads `compareTexts`.
 */

export type DiffSegment = {
  type: "equal" | "removed" | "added";
  text: string;
};

/** Edit distance above which two lines are shown as a whole replacement. */
const WORD_MAX_EDIT_LENGTH = 1_500;

function push(segments: DiffSegment[], type: DiffSegment["type"], text: string) {
  segments.push({ type, text });
}

/**
 * A word-level diff of `before` into `after`. Joining the equal and removed
 * segments gives `before`; joining the equal and added segments gives `after`.
 */
export function diffWords(before: string, after: string): DiffSegment[] {
  if (!before && !after) return [];
  const parts = diffWordsWithSpace(before, after, {
    maxEditLength: WORD_MAX_EDIT_LENGTH,
  });
  if (!parts) {
    // Too different to align word by word: one removal, one addition.
    const whole: DiffSegment[] = [];
    if (before) whole.push({ type: "removed", text: before });
    if (after) whole.push({ type: "added", text: after });
    return whole;
  }
  const segments: DiffSegment[] = [];
  for (const part of parts) {
    push(
      segments,
      part.added ? "added" : part.removed ? "removed" : "equal",
      part.value,
    );
  }
  return joinChanges(segments);
}

/**
 * Reads as phrases rather than alternating words: whitespace between two
 * changes joins them, and each run of changes becomes one removal followed by
 * one addition.
 */
function joinChanges(segments: DiffSegment[]): DiffSegment[] {
  const joined: DiffSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) push(joined, "removed", removed);
    if (added) push(joined, "added", added);
    removed = "";
    added = "";
  };
  segments.forEach((segment, index) => {
    if (segment.type === "removed") removed += segment.text;
    else if (segment.type === "added") added += segment.text;
    else if (
      (removed || added) &&
      !segment.text.trim() &&
      segments[index + 1] &&
      segments[index + 1].type !== "equal"
    ) {
      removed += segment.text;
      added += segment.text;
    } else {
      flush();
      push(joined, "equal", segment.text);
    }
  });
  flush();
  return joined;
}

// ---------------------------------------------------------------------------
// Comparing the text of two versions
// ---------------------------------------------------------------------------

/** Past these sizes the comparison is refused instead of freezing the page. */
export const COMPARE_LIMITS = {
  maxLines: 20_000,
  maxChars: 2_000_000,
  /** jsdiff stops and returns nothing once this much time has passed. */
  timeoutMs: 2_000,
};

export interface DiffLine {
  /** 1-based line number on this side. */
  no: number;
  text: string;
  /** The line split into equal and changed words. */
  segments: DiffSegment[];
}

export interface TextChange {
  kind: "change";
  /** 0-based position among all changes. */
  index: number;
  removed: DiffLine[];
  added: DiffLine[];
  /** A digit [0-9] occurs in a changed fragment. Nothing else is read. */
  numeric: boolean;
  /** Nearest `#` heading in the revised text before or at the change. */
  heading: string | null;
  /** 1-based number of the revised paragraph the change starts at. */
  paragraph: number;
  /** A short line of the changed text, for the list of changes. */
  summary: string;
}

export interface EqualRun {
  kind: "equal";
  lines: { oldNo: number; newNo: number; text: string }[];
}

export interface TextComparison {
  items: (EqualRun | TextChange)[];
  changes: TextChange[];
}

export type CompareOutcome =
  | { status: "ok"; comparison: TextComparison }
  | { status: "too_large" };

const HAS_DIGIT = /[0-9]/;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;

/** One trailing newline, LF only, so a missing final newline is no change. */
function normalize(text: string): string {
  const lf = text.replace(/\r\n?/g, "\n");
  return lf && !lf.endsWith("\n") ? `${lf}\n` : lf;
}

function toLines(chunk: string): string[] {
  const lines = chunk.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function countLines(text: string): number {
  let count = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1))
    count += 1;
  return count;
}

function wholeLine(no: number, text: string, type: "removed" | "added"): DiffLine {
  return { no, text, segments: text ? [{ type, text }] : [] };
}

function changedText(lines: DiffLine[]): string {
  return lines
    .flatMap((line) => line.segments.filter((s) => s.type !== "equal"))
    .map((segment) => segment.text)
    .join(" ");
}

/**
 * Line by line, then word by word inside the lines that were rewritten.
 * Returns `too_large` instead of a result when the texts pass the limits or
 * the diff does not finish in time.
 */
export function compareTexts(
  base: string,
  head: string,
  limits: Partial<typeof COMPARE_LIMITS> = {},
): CompareOutcome {
  const { maxLines, maxChars, timeoutMs } = { ...COMPARE_LIMITS, ...limits };
  const a = normalize(base);
  const b = normalize(head);
  if (
    a.length > maxChars ||
    b.length > maxChars ||
    countLines(a) > maxLines ||
    countLines(b) > maxLines
  ) {
    return { status: "too_large" };
  }
  const parts = diffLines(a, b, { timeout: timeoutMs });
  if (!parts) return { status: "too_large" };

  const items: (EqualRun | TextChange)[] = [];
  const changes: TextChange[] = [];
  let oldNo = 1;
  let newNo = 1;
  let heading: string | null = null;
  let paragraphs = 0;

  const seeHeadLine = (text: string) => {
    const match = HEADING.exec(text);
    if (match) heading = match[1] || heading;
    if (text.trim()) paragraphs += 1;
  };

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part.added && !part.removed) {
      const lines = toLines(part.value).map((text) => {
        const line = { oldNo, newNo, text };
        oldNo += 1;
        newNo += 1;
        seeHeadLine(text);
        return line;
      });
      items.push({ kind: "equal", lines });
      continue;
    }
    // A run of removed and added parts is one change.
    let removedText: string[] = [];
    let addedText: string[] = [];
    for (; i < parts.length && (parts[i].added || parts[i].removed); i += 1) {
      const lines = toLines(parts[i].value);
      if (parts[i].added) addedText = addedText.concat(lines);
      else removedText = removedText.concat(lines);
    }
    i -= 1;

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    const paired = Math.min(removedText.length, addedText.length);
    const startOld = oldNo;
    const startNew = newNo;
    for (let k = 0; k < removedText.length; k += 1) {
      const text = removedText[k];
      const line = wholeLine(startOld + k, text, "removed");
      if (k < paired) {
        const words = diffWords(text, addedText[k]);
        line.segments = words.filter((s) => s.type !== "added");
        added.push({
          no: startNew + k,
          text: addedText[k],
          segments: words.filter((s) => s.type !== "removed"),
        });
      }
      removed.push(line);
    }
    for (let k = paired; k < addedText.length; k += 1) {
      added.push(wholeLine(startNew + k, addedText[k], "added"));
    }
    oldNo += removedText.length;
    newNo += addedText.length;

    // A change that adds a title belongs under that title.
    const addedHeading = addedText
      .map((text) => HEADING.exec(text))
      .find((match) => match !== null);
    const changeHeading: string | null = addedHeading
      ? addedHeading[1] || heading
      : heading;
    const paragraph = paragraphs + 1;
    for (const text of addedText) seeHeadLine(text);

    const fragment = `${changedText(removed)} ${changedText(added)}`;
    const summary = (
      added.map((l) => l.text.trim()).find(Boolean) ??
      removed.map((l) => l.text.trim()).find(Boolean) ??
      ""
    ).slice(0, 80);
    const change: TextChange = {
      kind: "change",
      index: changes.length,
      removed,
      added,
      numeric: HAS_DIGIT.test(fragment),
      heading: changeHeading,
      paragraph,
      summary,
    };
    changes.push(change);
    items.push(change);
  }
  return { status: "ok", comparison: { items, changes } };
}
