import { isRepairRefusal, RepairBudget, repairJson, setRepairObserverForTests } from "../boundedJsonRepair";
import { assertBoundedText, BoundedTextError, MODEL_TEXT_MAX_CHARS, stripCodeFence } from "../modelJsonFence";
import type { NormalizedToolCall } from "./types";

export { setRepairObserverForTests };

/**
 * The most a tool call's arguments may hold to be repaired rather than refused:
 * the size at which the engine stops putting a call's arguments before a
 * person for approval. The repair is not linear on every damaged shape.
 */
export const TOOL_ARGUMENT_REPAIR_MAX_CHARS = 200_000;

/**
 * The most time the repairs of one reading of a reply may take, in milliseconds, shared by every
 * text the reading repairs: the library is slow on some damaged shapes, and an honest reply (a few
 * documents of 150,000 characters, or dozens of 5,000-character ones) repairs in a small part of it.
 */
export const TOOL_ARGUMENT_REPAIR_REPLY_BUDGET_MS = 1_000;

/** The repairs of one reading of a reply (one call of a public entry point) are paid from one budget. */
const newRepairBudget = (): RepairBudget => new RepairBudget(TOOL_ARGUMENT_REPAIR_REPLY_BUDGET_MS);

const UNRECOVERABLE_CALL_MESSAGE =
  "The local model returned a tool call that LiTT could not recover. Retry the request or use the deterministic Trademark Monitor mode.";

/**
 * Runs a reading of a reply. An argument a bound refuses (the limit of its text or the time of the
 * reading) is not text that is not JSON: the reading ends with the error of a call that cannot be
 * read, and no call of the reply is handed on, rather than one with arguments missing or retyped.
 */
function endOnRefusal<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (isRepairRefusal(error)) throw new Error(UNRECOVERABLE_CALL_MESSAGE, { cause: error });
    throw error;
  }
}

/**
 * The JSON value of a tool call's text. Text that is valid JSON is read as it
 * is, whatever its size up to the shared bound (linear); only text that is not
 * is repaired, and only up to `TOOL_ARGUMENT_REPAIR_MAX_CHARS`.
 */
function parseToolJson(text: string, budget: RepairBudget): unknown {
  try {
    return JSON.parse(assertBoundedText(text));
  } catch {
    return JSON.parse(repairJson(text, { maxChars: TOOL_ARGUMENT_REPAIR_MAX_CHARS, maxMs: TOOL_ARGUMENT_REPAIR_REPLY_BUDGET_MS }, budget));
  }
}

// Tolerance for models that describe tool calls in prose instead of emitting
// them as structured tool-call fields. Self-hosted builds of Qwen, DeepSeek,
// GLM and friends routinely do this, in a different dialect each: a JSON
// object inside <tool_call> markers, an XML-ish <function=name> block, a
// DeepSeek DSML invoke, or a bare map whose single key is the tool name.
// Hosted providers never need any of it, so this module is only wired up for
// endpoints the registry marks as tolerant (see localModelMiddleware.ts).
//
// Everything here is pure text handling: no transport, no provider SDK.

const THINK_OPEN = "<think>";

const THINK_CLOSE = "</think>";

// Routes inline <think>...</think> blocks (qwen/deepseek style) to the
// reasoning channel instead of the visible content stream. Tags can be
// split across SSE chunks, so partial-tag suffixes are buffered.
export class ThinkTagFilter {
  private insideThink = false;
  private buffer = "";
  sawReasoning = false;

  feed(text: string): { content: string[]; reasoning: string[] } {
    this.buffer += text;
    const content: string[] = [];
    const reasoning: string[] = [];

    while (this.buffer.length) {
      const tag = this.insideThink ? THINK_CLOSE : THINK_OPEN;
      const idx = this.buffer.indexOf(tag);
      if (idx === -1) {
        const hold = this.partialTagSuffixLength(tag);
        const emit = this.buffer.slice(0, this.buffer.length - hold);
        this.buffer = this.buffer.slice(this.buffer.length - hold);
        if (emit) this.emit(emit, content, reasoning);
        break;
      }
      const before = this.buffer.slice(0, idx);
      if (before) this.emit(before, content, reasoning);
      this.buffer = this.buffer.slice(idx + tag.length);
      this.insideThink = !this.insideThink;
    }

    return { content, reasoning };
  }

  flush(): { content: string[]; reasoning: string[] } {
    const content: string[] = [];
    const reasoning: string[] = [];
    if (this.buffer) {
      this.emit(this.buffer, content, reasoning);
      this.buffer = "";
    }
    return { content, reasoning };
  }

  private emit(text: string, content: string[], reasoning: string[]) {
    if (this.insideThink) {
      this.sawReasoning = true;
      reasoning.push(text);
    } else {
      content.push(text);
    }
  }

  private partialTagSuffixLength(tag: string): number {
    const max = Math.min(this.buffer.length, tag.length - 1);
    for (let len = max; len > 0; len--) {
      if (this.buffer.endsWith(tag.slice(0, len))) return len;
    }
    return 0;
  }
}

const TEXT_TOOL_MARKERS = [
  "<tool_call",
  "<toolcall",
  "<|tool_call",
  "<function=",
  "<function name=",
  "<｜dsml｜tool_calls",
  "<｜dsml｜invoke",
  "<|dsml|tool_calls",
  "<|dsml|invoke",
];

const LONGEST_TEXT_TOOL_MARKER = Math.max(...TEXT_TOOL_MARKERS.map((marker) => marker.length));

/** Suppress textual tool markup even when its opening marker spans chunks. */
export class TextToolMarkupFilter {
  private buffer = "";
  private suppressing = false;

  /** Whether a tool marker has been seen: what follows it is not shown. */
  get suppressed(): boolean {
    return this.suppressing;
  }

  feed(text: string): string {
    if (this.suppressing || !text) return "";
    this.buffer += text;
    const lower = this.buffer.toLowerCase();
    let markerIndex = -1;
    for (const marker of TEXT_TOOL_MARKERS) {
      const index = lower.indexOf(marker);
      if (index >= 0 && (markerIndex < 0 || index < markerIndex)) {
        markerIndex = index;
      }
    }
    if (markerIndex >= 0) {
      const visible = this.buffer.slice(0, markerIndex);
      this.buffer = "";
      this.suppressing = true;
      return visible;
    }

    // The held-back tail is a marker's beginning: it starts at one of the last
    // "<" no more than a marker's length from the end, so earlier ones (their
    // tails only get longer) are not looked at.
    for (
      let index = lower.lastIndexOf("<");
      index >= 0 && lower.length - index <= LONGEST_TEXT_TOOL_MARKER;
      index = index === 0 ? -1 : lower.lastIndexOf("<", index - 1)
    ) {
      const suffix = lower.slice(index);
      if (TEXT_TOOL_MARKERS.some((marker) => marker.startsWith(suffix))) {
        const visible = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index);
        return visible;
      }
    }
    const visible = this.buffer;
    this.buffer = "";
    return visible;
  }

  flush(): string {
    if (this.suppressing) return "";
    const visible = this.buffer;
    this.buffer = "";
    return visible;
  }
}

export function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function deduplicateToolCalls(
  calls: NormalizedToolCall[],
): NormalizedToolCall[] {
  const seen = new Set<string>();
  return calls.filter((call) => {
    const key = `${call.name}\n${JSON.stringify(call.input)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Whether the text holds anything that reads as a tool call. A key on a line of
 * its own (`name:`) counts only when nothing but whitespace comes before it on
 * that line; the whitespace before a key is looked at once per key, never as a
 * run that starts again at every line break.
 */
function hasToolMarkup(text: string): boolean {
  if (/<(?:tool_call|toolcall)\b|<\|tool_call(?:_start)?\|>|<function(?:=|\s+name=)/i.test(text)) return true;
  const key = /(?:tool|function|name)\s*[:=]/gi;
  for (let match = key.exec(text); match; match = key.exec(text)) {
    let before = match.index - 1;
    while (before >= 0 && /\s/.test(text[before])) {
      if (text[before] === "\n") return true;
      before--;
    }
    if (before < 0) return true;
  }
  return false;
}

/**
 * Each block that opens with `open` and ends at the first `close` after it
 * (both global patterns, used from where the last block ended);
 * an opening with no closing after it, and so every later one, is not a block.
 * The closing is searched once from the end of each block, so the work
 * follows the text, not the number of openings.
 */
function* blocksBetween(
  text: string,
  open: RegExp,
  close: RegExp,
): Generator<{ open: RegExpExecArray; inner: string }> {
  const opening = open;
  const closing = close;
  for (let from = 0; from <= text.length; ) {
    opening.lastIndex = from;
    const start = opening.exec(text);
    if (!start) return;
    const innerStart = start.index + start[0].length;
    closing.lastIndex = innerStart;
    const end = closing.exec(text);
    if (!end) return;
    yield { open: start, inner: text.slice(innerStart, end.index) };
    from = end.index + end[0].length;
  }
}

/** Whether a reply is longer than the reader scans and holds the opening of a tool call. */
export function isUnreadableToolCallReply(text: string): boolean {
  if (text.length <= MODEL_TEXT_MAX_CHARS) return false;
  const filter = new TextToolMarkupFilter();
  filter.feed(text);
  return filter.suppressed;
}

/**
 * The calls a model wrote as text. A reply longer than `MODEL_TEXT_MAX_CHARS`
 * (the bound that applies to model text everywhere else; a streamed reply may
 * be larger than it) is not scanned and is plain text.
 */
export function parseTextToolCalls(
  text: string,
  iteration: number,
): NormalizedToolCall[] {
  if (text.length > MODEL_TEXT_MAX_CHARS) return [];
  return endOnRefusal(() => readTextToolCalls(text, iteration));
}

function readTextToolCalls(
  text: string,
  iteration: number,
): NormalizedToolCall[] {
  const budget = newRepairBudget();
  const dsmlCalls = readDsmlToolCalls(text, iteration, budget);
  if (dsmlCalls.length) return deduplicateToolCalls(dsmlCalls);
  if (!hasToolMarkup(text)) return [];
  const bodies: string[] = [];
  const tagPattern =
    /<(?:tool_call|toolcall)\b[^>]{0,200}>|<\|tool_call(?:_start)?\|>/gi;
  const openTags = [...text.matchAll(tagPattern)];
  for (const [index, openTag] of openTags.entries()) {
    const start = (openTag.index ?? 0) + openTag[0].length;
    const nextStart = openTags[index + 1]?.index ?? text.length;
    const segment = text.slice(start, nextStart);
    const closeIndex = segment.search(
      /<\/(?:tool_call|toolcall)>|<\|tool_call_end\|>/i,
    );
    bodies.push(closeIndex >= 0 ? segment.slice(0, closeIndex) : segment);
  }

  const calls = bodies.flatMap((body, bodyIndex): NormalizedToolCall[] => {
    const xmlStyleCall = parseXmlStyleToolCall(body, iteration, bodyIndex, budget);
    if (xmlStyleCall) return [xmlStyleCall];
    try {
      const candidate = normalizeQwenToolMapSyntax(extractJsonCandidate(body));
      const parsed = parseToolJson(candidate, budget);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      const parsedCalls = rows.flatMap(
        (row, rowIndex): NormalizedToolCall[] => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return [];
          const record = row as Record<string, unknown>;
          const functionRecord =
            record.function &&
            typeof record.function === "object" &&
            !Array.isArray(record.function)
              ? (record.function as Record<string, unknown>)
              : null;
          const entries = Object.entries(record);
          const mapStyleCall =
            record.name == null &&
            functionRecord?.name == null &&
            entries.length === 1 &&
            entries[0][1] &&
            typeof entries[0][1] === "object" &&
            !Array.isArray(entries[0][1])
              ? entries[0]
              : null;
          const rawName =
            record.name ?? functionRecord?.name ?? mapStyleCall?.[0];
          const name = typeof rawName === "string" ? rawName.trim() : "";
          if (!name) return [];
          return [
            {
              id:
                typeof record.id === "string" && record.id
                  ? record.id
                  : `call_text_${iteration}_${bodyIndex}_${rowIndex}`,
              name,
              input: parseToolInput(
                record.arguments ??
                  record.input ??
                  record.parameters ??
                  functionRecord?.arguments ??
                  mapStyleCall?.[1],
              ),
            },
          ];
        },
      );
      if (parsedCalls.length) return parsedCalls;
      // Read loosely only when the JSON holds no call: the reading is paid for from the budget.
      const looseCall = parseLooseTextToolCall(body, iteration, bodyIndex, budget);
      return looseCall ? [looseCall] : [];
    } catch (error) {
      // A refused repair is not a body that holds no call: it ends the reading.
      if (isRepairRefusal(error)) throw error;
      const looseCall = parseLooseTextToolCall(body, iteration, bodyIndex, budget);
      if (looseCall) return [looseCall];
      if (process.env.DEBUG_LLM_TOOL_CALLS === "1") {
        console.error("[openai-compatible] unrecoverable textual tool call", {
          body: body.slice(0, 4_000),
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw new Error(UNRECOVERABLE_CALL_MESSAGE);
    }
  });
  if (!calls.length) {
    throw new Error(
      "The local model did not identify an executable tool. Retry the request or use the deterministic Trademark Monitor mode.",
    );
  }
  return deduplicateToolCalls(calls);
}

export function parseDsmlToolCalls(
  value: string,
  iteration: number,
): NormalizedToolCall[] {
  return endOnRefusal(() => readDsmlToolCalls(value, iteration, newRepairBudget()));
}

function readDsmlToolCalls(
  value: string,
  iteration: number,
  budget: RepairBudget,
): NormalizedToolCall[] {
  if (value.length > MODEL_TEXT_MAX_CHARS) return [];
  if (!/<[｜|]DSML[｜|]invoke\b/i.test(value)) return [];
  const calls: NormalizedToolCall[] = [];
  // A tool or parameter name is at most 200 characters, and so are the attributes of an opening tag.
  const invokes = blocksBetween(
    value,
    /<[｜|]DSML[｜|]invoke\s+name=["']?([^>"'\s]{1,200})["']?\s*>/gi,
    /<\/[｜|]DSML[｜|]invoke\s*>/gi,
  );
  for (const [index, invoke] of [...invokes].entries()) {
    const input: Record<string, unknown> = {};
    const parameters = blocksBetween(
      invoke.inner,
      /<[｜|]DSML[｜|]parameter\s+name=["']?([^>"'\s]{1,200})["']?(?:\s[^>]{0,200})?>/gi,
      /<\/[｜|]DSML[｜|]parameter\s*>/gi,
    );
    for (const parameter of parameters) {
      input[parameter.open[1]] = readToolScalar(parameter.inner, budget);
    }
    calls.push({
      id: `call_text_${iteration}_dsml_${index}`,
      name: invoke.open[1].trim(),
      input,
    });
  }
  return calls;
}

export function collapseTrademarkOwnerCalls(
  calls: NormalizedToolCall[],
): NormalizedToolCall[] {
  const groups = new Map<string, NormalizedToolCall[]>();
  for (const call of calls) {
    if (
      !call.name.startsWith("mcp_") ||
      !/tm_search_trademarks/i.test(call.name) ||
      typeof call.input.owner_name !== "string" ||
      !call.input.owner_name.trim()
    ) {
      continue;
    }
    const group = groups.get(call.name) ?? [];
    group.push(call);
    groups.set(call.name, group);
  }
  if (![...groups.values()].some((group) => group.length > 1)) return calls;

  const collapsed = new Set<NormalizedToolCall>();
  const replacements = new Map<string, NormalizedToolCall>();
  for (const [name, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0];
    const ownerNames = group
      .map((call) => String(call.input.owner_name).trim())
      .filter(Boolean);
    replacements.set(name, {
      id: first.id,
      name,
      input: {
        ...first.input,
        owner_name: undefined,
        owner_names: ownerNames,
      },
    });
    group.forEach((call) => collapsed.add(call));
  }
  return calls.flatMap((call) => {
    if (!collapsed.has(call)) return [call];
    const replacement = replacements.get(call.name);
    if (!replacement || replacement.id !== call.id) return [];
    const input = Object.fromEntries(
      Object.entries(replacement.input).filter(
        ([, value]) => value !== undefined,
      ),
    );
    return [{ ...replacement, input }];
  });
}

function parseLooseTextToolCall(
  value: string,
  iteration: number,
  bodyIndex: number,
  budget: RepairBudget,
): NormalizedToolCall | null {
  const nameMatch = value.match(
    /(?:["']?name["']?|["']?(?:tool|function)["']?)\s*[:=]\s*["']?([^"'\s,}]+)["']?/i,
  );
  const name = nameMatch?.[1]?.trim();
  if (!name) return null;

  const input: Record<string, unknown> = {};
  const argumentsMatch = value.match(
    /["']?(?:arguments|input|parameters)["']?\s*[:=]\s*/i,
  );
  if (argumentsMatch && argumentsMatch.index != null) {
    const candidate = value.slice(
      argumentsMatch.index + argumentsMatch[0].length,
    );
    const repaired = normalizeQwenToolMapSyntax(
      extractJsonCandidate(candidate),
    );
    try {
      const parsed = parseToolJson(repaired, budget);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(input, parsed);
      }
    } catch (error) {
      // A refusal by a bound is not an argument payload that is not JSON.
      if (isRepairRefusal(error)) throw error;
      // A call with an unrecoverable argument payload is still returned so the
      // connector can provide its normal validation error instead of hiding the
      // model's tool name behind a generic parser failure.
    }
  }
  return {
    id: `call_text_${iteration}_${bodyIndex}_loose`,
    name,
    input,
  };
}

function parseXmlStyleToolCall(
  value: string,
  iteration: number,
  bodyIndex: number,
  budget: RepairBudget,
): NormalizedToolCall | null {
  const functionMatch = value.match(
    /<function(?:=|\s+name=["'])([^>"'\s]{1,200})["']?\s*>/i,
  );
  if (!functionMatch) return null;
  const input: Record<string, unknown> = {};
  // `<name>value</name>`: the closing tag must repeat the name, and the value
  // ends at the first such closing after the opening. Every closing tag is
  // found once, with its position kept under its name; the openings are
  // visited from left to right, so each name's cursor only moves forward and
  // an opening costs no search of its own.
  const closings = new Map<string, number[]>();
  const closingTag = /<\/([a-zA-Z_][\w.-]*)>/g;
  for (let match = closingTag.exec(value); match; match = closingTag.exec(value)) {
    const positions = closings.get(match[1]);
    if (positions) positions.push(match.index);
    else closings.set(match[1], [match.index]);
  }
  const cursors = new Map<string, number>();
  const fieldOpen = /<([a-zA-Z_][\w.-]*)>/g;
  for (let match = fieldOpen.exec(value); match; match = fieldOpen.exec(value)) {
    const name = match[1];
    const positions = closings.get(name);
    if (!positions) continue;
    const innerStart = match.index + match[0].length;
    let cursor = cursors.get(name) ?? 0;
    while (cursor < positions.length && positions[cursor] < innerStart) cursor++;
    cursors.set(name, cursor);
    if (cursor === positions.length) continue;
    const closeAt = positions[cursor];
    input[name] = readToolScalar(value.slice(innerStart, closeAt).trim(), budget);
    fieldOpen.lastIndex = closeAt + name.length + 3;
  }
  return {
    id: `call_text_${iteration}_${bodyIndex}_xml`,
    name: functionMatch[1],
    input,
  };
}

export function parseToolScalar(value: string): unknown {
  return endOnRefusal(() => readToolScalar(value, newRepairBudget()));
}

function readToolScalar(value: string, budget: RepairBudget): unknown {
  const trimmed = value.trim();
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^(?:null|none)$/i.test(trimmed)) return null;
  if (/^[\[{]/.test(trimmed)) {
    try {
      return parseToolJson(trimmed, budget);
    } catch (error) {
      // A refusal by a bound is not a value that is not JSON.
      if (isRepairRefusal(error)) throw error;
      // Preserve the original string when a nested value is not JSON-like.
    }
  }
  return trimmed;
}

export function normalizeQwenToolMapSyntax(value: string): string {
  return value
    .replace(/^(\s*\{\s*)"{2,}/, '$1"')
    .replace(/^(\s*\{\s*"[^"]+")\s*:{2,}/, "$1:");
}

/** The JSON value inside a model's text; "" when the text is over the shared bound. */
export function extractJsonCandidate(value: string): string {
  let cleaned: string;
  try {
    cleaned = stripCodeFence(value);
  } catch (error) {
    if (error instanceof BoundedTextError) return "";
    throw error;
  }
  const start = cleaned.search(/[\[{]/);
  if (start < 0) return cleaned;

  const opening = cleaned[start];
  const closing = opening === "[" ? "]" : "}";
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }
  return cleaned.slice(start);
}
