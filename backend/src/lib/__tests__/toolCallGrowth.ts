import {
    extractJsonCandidate,
    normalizeQwenToolMapSyntax,
    parseDsmlToolCalls,
    parseTextToolCalls,
    parseToolInput,
    parseToolScalar,
    TextToolMarkupFilter,
    ThinkTagFilter,
} from "../llm/toolCallParsing";

// Test-only: the generators of adversarial text and the growth check of the reader of tool calls
// written as text (see toolCallParsing.growth.test.ts). When a new marker, tag or keyword is added to
// the reader, add it to MARKERS.

type Marker = (i: number) => string;
const fixed = (text: string): Marker => () => text;
const MARKERS: Record<string, Marker> = {
    // toolCallParsing.ts: TEXT_TOOL_MARKERS and hasToolMarkup
    toolCallOpen: fixed("<tool_call>"),
    toolCallWithAttributes: fixed("<tool_call "),
    toolcallOpen: fixed("<toolcall>"),
    pipeToolCall: fixed("<|tool_call|>"),
    pipeToolCallStart: fixed("<|tool_call_start|>"),
    toolCallClose: fixed("</tool_call>"),
    toolcallClose: fixed("</toolcall>"),
    pipeToolCallEnd: fixed("<|tool_call_end|>"),
    functionEquals: fixed("<function="),
    functionEqualsWithName: fixed("<function=f>"),
    functionNameAttribute: fixed('<function name="'),
    functionNameComplete: fixed('<function name="f">'),
    dsmlToolCalls: fixed("<|dsml|tool_calls>"),
    dsmlToolCallsFullWidth: fixed("<｜dsml｜tool_calls>"),
    dsmlInvokeComplete: fixed("<|DSML|invoke name=a>"),
    dsmlInvokeFullWidth: fixed("<｜DSML｜invoke name=a>"),
    dsmlInvokeOpen: fixed("<|DSML|invoke "),
    dsmlInvokeClose: fixed("</|DSML|invoke>"),
    dsmlParameterComplete: fixed("<|DSML|parameter name=p>"),
    dsmlParameterOpen: fixed("<|DSML|parameter name=p "),
    dsmlParameterClose: fixed("</|DSML|parameter>"),
    fieldSameName: fixed("<a>"),
    fieldSameNameClose: fixed("</a>"),
    fieldDistinctNames: (i) => `<a${i}>`,
    fieldDistinctClosings: (i) => `</a${i}>`,
    keyName: fixed("name:"),
    keyNameEquals: fixed("name="),
    keyTool: fixed("tool:"),
    keyFunction: fixed("function:"),
    keyQuotedName: fixed('"name":'),
    keyArguments: fixed('"arguments":'),
    keyInput: fixed("input="),
    keyParameters: fixed("parameters:"),
    braceOpen: fixed("{"),
    bracketOpen: fixed("["),
    doubleQuote: fixed('"'),
    singleQuote: fixed("'"),
    qwenDoubledQuote: fixed('{""'),
    qwenDoubledColon: fixed('{"a"::'),
    fence: fixed("```"),
    fenceJson: fixed("```json\n"),
    thinkOpen: fixed("<think>"),
    thinkClose: fixed("</think>"),
    lineBreak: fixed("\n"),
    spaces: fixed("   "),
    angle: fixed("<"),
};
export const MARKER_NAMES = Object.keys(MARKERS);

export const make = (n: number, unit: Marker): string => {
    const parts: string[] = [];
    let length = 0;
    for (let i = 0; length < n; i++) {
        const part = unit(i);
        parts.push(part);
        length += part.length;
    }
    return parts.join("");
};

export type Family = { name: string; text: (n: number) => string };
export const families: Family[] = [];
const add = (name: string, text: (n: number) => string) => families.push({ name, text });

// 1. The families the cost probes of the earlier checks used, as they were written.
const repeat = (unit: string) => (n: number) => unit.repeat(Math.ceil(n / unit.length));
add("probe: whitespace lines", repeat("\n "));
add("probe: whitespace runs, then a key in mid line", repeat("x" + " ".repeat(20) + "name:"));
add("probe: tool_call tags never closed", repeat("<tool_call "));
add("probe: one field never closed", (n) => `<tool_call><function=f>${repeat("<a>")(n)}`);
add("probe: a field then spaces", (n) => `<tool_call><function=f><a>${" ".repeat(n)}`);
add("probe: DISTINCT fields never closed", (n) => `<tool_call><function=f>${make(n, (i) => `<a${i}>`)}`);
add("probe: DISTINCT fields, each with a closing of another name", (n) => `<tool_call><function=f>${make(n, (i) => `<a${i}></b${i}>`)}`);
add("probe: DSML invokes never closed", repeat("<|DSML|invoke name=a>"));
add("probe: DSML parameters never closed", (n) => `<|DSML|invoke name=a>${repeat("<|DSML|parameter name=p>")(n)}</|DSML|invoke>`);
add("probe: DSML parameter tags never ended", (n) => `<|DSML|invoke name=a>${repeat("<|DSML|parameter name=p ")(n)}</|DSML|invoke>`);
add("probe: function= repeated inside a tool_call", (n) => `<tool_call>${repeat("<function=")(n)}`);
add("probe: function= repeated with no tool_call", repeat("<function="));
add("probe: function name= repeated", (n) => `<tool_call>${repeat('<function name="')(n)}`);
add("probe: JSON with a whitespace run", (n) => `<tool_call>{"name":"n"${" ".repeat(n)}`);
add("probe: fence and whitespace", (n) => `<tool_call>\`\`\`json\n{"name":"n"}${" ".repeat(n)}x</tool_call>`);
add("probe: name repeated", (n) => `<tool_call>${repeat("name ")(n)}`);
add("probe: tag attributes at the bound", (n) => repeat("<tool_call " + "a".repeat(990))(n));
add("probe: function with spaces", repeat("<function \t"));
add("probe: name then spaces", (n) => "name" + " ".repeat(n));
add("probe: closings that never match", repeat("</tool_call <|tool_call_"));
add("probe: DSML invoke then spaces", (n) => "<|DSML|invoke" + " ".repeat(n));
add("probe: DSML closing then spaces", (n) => "</|DSML|invoke" + " ".repeat(n));
add("probe: name colon tab", (n) => `<tool_call>${repeat("name:\t")(n)}`);
add("probe: name, spaces, value", (n) => `<tool_call>name${" ".repeat(n)}x`);
add("probe: input then spaces", (n) => `<tool_call>input${" ".repeat(n)}`);
add("probe: an opening angle and letters", (n) => "<" + "a".repeat(n));
add("probe: angle letter repeated", repeat("<a"));
add("probe: a long key with doubled colon", (n) => `{"${repeat("a ")(n)}" :`);
add("probe: whitespace around a brace and a quote", (n) => " ".repeat(n) + "{" + " ".repeat(n) + '"');
add("probe: quote and letter repeated", (n) => `<tool_call>${repeat("'a")(n)}`);
add("probe: one open quote", (n) => `<tool_call>'${"a".repeat(n)}`);

// Text a model may write as an argument, damaged the way a model damages it: the library that repairs it
// re-reads for each quote that does not pair.
const inCall = (body: (n: number) => string) => (n: number) => `<tool_call>${body(n)}`;
add("repair: unescaped quotes inside a string", inCall((n) => `{"name":"n","arguments":{"text":"he said "hi" and "bye" ${repeat('and "x" ')(n)}"}}`));
add("repair: double quote and letter repeated", inCall((n) => `"${repeat('"a')(n)}`));
add("repair: single quote and letter repeated", inCall((n) => repeat("'a")(n)));
add("repair: curly quote and letter repeated", inCall((n) => `{${repeat("\u2018a")(n)}`));
add("repair: quoted words never paired", inCall((n) => `{"name":"n","arguments":{"a":"b${repeat('"c"')(n)}`));
add("repair: an array cut after many strings", inCall((n) => `{"name":"n","arguments":{"a":[${repeat('"item text",')(n)}`));
add("repair: an object cut after many keys", inCall((n) => `{"name":"n","arguments":{${make(n, (i) => `"k${i}":"v${i}",`)}`));
add("repair: single-quoted keys", inCall((n) => `{${make(n, (i) => `'k${i}':'v${i}',`)}}`));
add("repair: a cut string of one long word", inCall((n) => `{"name":"n","arguments":{"text":"${"x".repeat(n)}`));
add("repair: a field value that is a damaged array of strings", (n) => `<tool_call><function=f><a>[${repeat('"a')(n)}</a>`);
add("repair: a DSML parameter that is a damaged object", (n) => `<|DSML|invoke name=a><|DSML|parameter name=p>{${repeat("'a")(n)}</|DSML|parameter></|DSML|invoke>`);
add("repair: nested openings cut", inCall((n) => repeat('{"a":')(n)));
add("repair: backslashes and quotes", inCall((n) => `"${repeat('\\"')(n)}`));
add("repair: comments and quotes", inCall((n) => `{${repeat('/*"')(n)}`));

// 2. For every marker: repeated with no closing, inside each kind of body, repeated with a closing that
//    never matches, and alternated with every other marker.
const BODIES: [string, string][] = [
    ["alone", ""],
    ["in a tool_call", "<tool_call>"],
    ["in a function call", "<tool_call><function=f>"],
    ["in a DSML invoke", "<|DSML|invoke name=a>"],
];
for (const name of MARKER_NAMES) {
    const marker = MARKERS[name];
    for (const [where, head] of BODIES) add(`marker ${name} repeated, ${where}`, (n) => head + make(n, marker));
    add(`marker ${name} with a closing that never matches`, (n) => `<tool_call><function=f>${make(n, (i) => marker(i) + "</x>")}`);
    add(`marker ${name} with a closing of its own that never pairs`, (n) => `<|DSML|invoke name=a>${make(n, (i) => marker(i) + "</|DSML|parameter")}`);
    add(`marker ${name} alternated with every other marker`, (n) =>
        `<tool_call>${make(n, (i) => marker(i) + MARKERS[MARKER_NAMES[i % MARKER_NAMES.length]](i))}`,
    );
}

// 3. Every pair of markers, alternated (small: the whole matrix is run against the two readers only).
export const pairs: Family[] = [];
for (const a of MARKER_NAMES) {
    for (const b of MARKER_NAMES) {
        pairs.push({ name: `pair ${a} + ${b}`, text: (n) => make(n, (i) => MARKERS[a](i) + MARKERS[b](i)) });
    }
}

// 4. Names and attribute values just under and just over every bound the reader has.
for (const length of [1, 199, 200, 201, 1000, 1001, 5000]) {
    const name = "x".repeat(length);
    add(`DSML invoke name of ${length}, never closed`, repeat(`<|DSML|invoke name=${name}>`));
    add(`DSML invoke name of ${length}, closed`, repeat(`<|DSML|invoke name=${name}></|DSML|invoke>`));
    add(`DSML parameter name of ${length}, never closed`, (n) => `<|DSML|invoke name=a>${repeat(`<|DSML|parameter name=${name}>v`)(n)}</|DSML|invoke>`);
    add(`DSML parameter name of ${length}, closed`, (n) => `<|DSML|invoke name=a>${repeat(`<|DSML|parameter name=${name}>v</|DSML|parameter>`)(n)}</|DSML|invoke>`);
    add(`function name of ${length}, never closed`, (n) => `<tool_call>${repeat(`<function=${name}`)(n)}`);
    add(`function name of ${length}, in quotes`, (n) => `<tool_call>${repeat(`<function name="${name}`)(n)}`);
    add(`function name of ${length}, complete`, (n) => `<tool_call>${repeat(`<function=${name}><a>1</a>`)(n)}`);
    add(`field name of ${length}, never closed`, (n) => `<tool_call><function=f>${repeat(`<a${name}>`)(n)}`);
    add(`field name of ${length}, closed`, (n) => `<tool_call><function=f>${repeat(`<a${name}>1</a${name}>`)(n)}`);
    add(`tool_call attributes of ${length}`, repeat(`<tool_call ${"a".repeat(length)}`));
    add(`tool_call attributes of ${length}, closed`, repeat(`<tool_call ${"a".repeat(length)}>{"name":"n"}`));
    add(`DSML parameter attributes of ${length}`, (n) => `<|DSML|invoke name=a>${repeat(`<|DSML|parameter name=p ${"a".repeat(length)}`)(n)}</|DSML|invoke>`);
    add(`DSML parameter attributes of ${length}, closed`, (n) => `<|DSML|invoke name=a>${repeat(`<|DSML|parameter name=p ${"a".repeat(length)}>v</|DSML|parameter>`)(n)}</|DSML|invoke>`);
    add(`key value of ${length}`, (n) => `<tool_call>${repeat(`name: ${name} `)(n)}`);
}

// 5. The same families wrapped as a model writes around them.
export const WRAPPERS: [string, (text: string, n: number) => string][] = [
    ["plain", (text) => text],
    ["in a code fence", (text) => "```json\n" + text + "\n```"],
    ["after prose", (text, n) => "A plain sentence of the answer, without any markup. ".repeat(Math.ceil(n / 52)) + text],
    ["with CRLF line ends", (text) => text.replace(/\n/g, "\r\n").replace(/>/g, ">\r\n")],
];

// Every public entry point of the module that receives model text.
export const ENTRY_POINTS: [string, (text: string) => void][] = [
    ["parseTextToolCalls", (text) => parseTextToolCalls(text, 0)],
    ["parseDsmlToolCalls", (text) => parseDsmlToolCalls(text, 0)],
    ["extractJsonCandidate", (text) => extractJsonCandidate(text)],
    ["normalizeQwenToolMapSyntax", (text) => normalizeQwenToolMapSyntax(text)],
    ["parseToolScalar", (text) => parseToolScalar(text)],
    ["parseToolInput", (text) => parseToolInput(text)],
    ["TextToolMarkupFilter, whole", (text) => { const f = new TextToolMarkupFilter(); f.feed(text); f.flush(); }],
    ["TextToolMarkupFilter, chunks of 512", (text) => { const f = new TextToolMarkupFilter(); for (let i = 0; i < text.length; i += 512) f.feed(text.slice(i, i + 512)); f.flush(); }],
    ["ThinkTagFilter, whole", (text) => { const f = new ThinkTagFilter(); f.feed(text); f.flush(); }],
    ["ThinkTagFilter, chunks of 512", (text) => { const f = new ThinkTagFilter(); for (let i = 0; i < text.length; i += 512) f.feed(text.slice(i, i + 512)); f.flush(); }],
];
export const TEXT_READERS = ENTRY_POINTS.filter(([name]) => name.startsWith("parse") && name !== "parseToolScalar" && name !== "parseToolInput");

export const SIZES = [1, 2, 4, 8];
const FLOOR_MS = 5;
const GIVE_UP_MS = 2_500;
const MAX_RATIO = 20;

const timeOf = (run: () => void, rounds: number): number => {
    let best = Infinity;
    for (let attempt = 0; attempt < rounds; attempt++) {
        const started = performance.now();
        try {
            run();
        } catch {
            // Text that looks like a call and holds none is refused; only the work matters here.
        }
        best = Math.min(best, performance.now() - started);
        if (best > 1_000) break;
    }
    return best;
};

/** One entry point on one family at sizes n..8n: the failure it shows, or "" when it grows with the text. */
function verdict(entry: string, run: (text: string) => void, text: (size: number) => string, n: number, rounds: number): string {
    const texts = SIZES.map((k) => text(n * k));
    const small = text(Math.floor(n / 8));
    // A reader that already takes this long on the smallest text is far from linear: stop there.
    const early = timeOf(() => run(small), rounds);
    if (early > 400) return `${entry}: ${small.length} chars ${early.toFixed(1)} ms`;
    const measure = (previous?: number[]): number[] => {
        const times: number[] = [];
        for (const [at, sample] of texts.entries()) {
            const ms = Math.min(timeOf(() => run(sample), rounds), previous?.[at] ?? Infinity);
            times.push(ms);
            if (ms > GIVE_UP_MS) break;
        }
        return times;
    };
    const grows = (times: number[]): boolean => {
        const last = times.length - 1;
        const factor = SIZES[last] / SIZES[0];
        return times[last] > GIVE_UP_MS || times[last] / Math.max(times[0], FLOOR_MS) > MAX_RATIO * (factor / 8);
    };
    // A host that is busy can slow one size by itself: the verdict is given on the best of two rounds.
    let times = measure();
    if (grows(times)) times = measure(times);
    if (!grows(times)) return "";
    return `${entry}: ${times.map((t, i) => `${texts[i].length} chars ${t.toFixed(1)} ms`).join(", ")}`;
}

/**
 * The slowest growth of any entry point on one family; "" when none grows faster than the text. A
 * first verdict that fails is not final: a busy host can slow the largest sample of a small text, so
 * it is checked again on a text four times larger, whose smallest sample is far above the floor, and
 * on the best of five runs of each size. A reader that is not linear fails both; the check is on the
 * measurement, not on the reader.
 */
export function growth(entries: [string, (text: string) => void][], text: (size: number) => string, n: number): string {
    const failures: string[] = [];
    for (const [entry, run] of entries) {
        const first = verdict(entry, run, text, n, 3);
        if (!first) continue;
        const confirmed = verdict(entry, run, text, n * 4, 5);
        if (confirmed) failures.push(`${confirmed} (first look: ${first})`);
    }
    return failures.join("\n");
}
