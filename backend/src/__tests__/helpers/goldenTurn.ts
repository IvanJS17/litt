/**
 * Shared by the golden turn recordings (`chatTurn.golden…`,
 * `projectChatTurn.golden…`): normalises ids/timestamps and compares one
 * turn's response body and side-effect timeline with the fixtures committed
 * under `src/__tests__/integration/__golden__/`.
 *
 * Re-record after an intentional wire change with `UPDATE_GOLDEN=1`.
 */
import { expect } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TimelineEntry = { k: string; v: unknown };

const GOLDEN_DIR = join(
    __dirname,
    "..",
    "integration",
    "__golden__",
);
const UUID =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/** Replaces ids and timestamps by placeholders numbered by first appearance. */
function normalizer() {
    const seen = new Map<string, string>();
    return (value: string) =>
        value
            .replace(UUID, (id) => {
                const key = id.toLowerCase();
                if (!seen.has(key)) seen.set(key, `<uuid-${seen.size + 1}>`);
                return seen.get(key)!;
            })
            .replace(ISO, "<timestamp>");
}

export function expectGoldenTurn(args: {
    prefix: string;
    name: string;
    res: { status: number; text: string; headers: Record<string, unknown> };
    timeline: TimelineEntry[];
}) {
    const { prefix, name, res, timeline } = args;
    const norm = normalizer();
    // The body goes first so its ids are numbered in the order the client
    // sees them; the timeline reuses the same numbering.
    const sse = norm(res.text);
    const written = timeline
        .filter((entry) => entry.k === "sse")
        .map((entry) => entry.v as string)
        .join("");
    // What the route wrote to the socket is what the client received.
    if (String(res.headers["content-type"]).includes("text/event-stream")) {
        expect(norm(written)).toBe(sse);
    }
    const payload = {
        status: res.status,
        headers: Object.fromEntries(
            ["content-type", "cache-control", "connection", "x-accel-buffering"]
                .filter((header) => res.headers[header] !== undefined)
                .map((header) => [header, res.headers[header]]),
        ),
        timeline: timeline.map((entry) =>
            entry.k === "sse"
                ? { k: "sse", v: norm(entry.v as string) }
                : JSON.parse(norm(JSON.stringify(entry))),
        ),
    };
    const sseFile = join(GOLDEN_DIR, `${prefix}.${name}.sse`);
    const timelineFile = join(GOLDEN_DIR, `${prefix}.${name}.timeline.json`);
    const timelineText = `${JSON.stringify(payload, null, 2)}\n`;
    if (process.env.UPDATE_GOLDEN === "1") {
        mkdirSync(GOLDEN_DIR, { recursive: true });
        writeFileSync(sseFile, sse);
        writeFileSync(timelineFile, timelineText);
        return;
    }
    expect(existsSync(sseFile), `missing fixture ${sseFile}`).toBe(true);
    expect(sse).toBe(readFileSync(sseFile, "utf8"));
    expect(timelineText).toBe(readFileSync(timelineFile, "utf8"));
}
