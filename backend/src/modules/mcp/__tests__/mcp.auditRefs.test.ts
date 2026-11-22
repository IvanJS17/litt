import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The entry written for a tool call may name only what the call was authorised
// to act on. These checks read the module's sources and fail when a file writes
// that entry, or the audit table, without the shared authorisation step.
const DIR = join(__dirname, "..");
const sources = readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => ({ file: f, text: readFileSync(join(DIR, f), "utf8") }));

// Files that may call the entry's writer. Each call must build its refs with
// `authoriseAuditRefs`. This list may only shrink.
const WRITES_CALL_ENTRY = ["mcp.tools.matters.ts", "mcp.tools.ts"];

describe("audit entries of tool calls", () => {
    it("are written only through the shared authorisation of their references", () => {
        const callers = sources.filter((s) => /\brecordMcpAuditEvent\(/.test(s.text) && s.file !== "mcp.calls.ts");
        expect(callers.map((s) => s.file).sort()).toEqual(WRITES_CALL_ENTRY);
        for (const { file, text } of callers) {
            const calls = [...text.matchAll(/\brecordMcpAuditEvent\(([\s\S]*?)\n\s*\}\);/g)].map((m) => m[1]);
            expect(calls.length, file).toBeGreaterThan(0);
            for (const call of calls) expect(call, file).toMatch(/refs: (?:await )?authoriseAuditRefs\(/);
        }
    });

    it("are not inserted anywhere else in the module", () => {
        const direct = sources
            .filter((s) => /\b(?:insertAuditEvent|recordAudit)\b/.test(s.text.replace(/^\s*(?:\/\/|\*).*$/gm, "")))
            .map((s) => s.file);
        expect(direct).toEqual(["mcp.calls.ts"]);
    });

    it("accept only checked references in the writer", () => {
        const calls = sources.find((s) => s.file === "mcp.calls.ts")!.text;
        expect(calls).toMatch(/refs\?: AuthorisedAuditRefs/);
        expect(calls).not.toMatch(/refs\?: McpAuditRefs/);
    });

    it("are marked as checked in one place only", () => {
        const casts = sources.filter((s) => /\bas (?:unknown as )?AuthorisedAuditRefs\b/.test(s.text)).map((s) => s.file);
        expect(casts).toEqual(["mcp.auditRefs.ts"]);
    });
});
