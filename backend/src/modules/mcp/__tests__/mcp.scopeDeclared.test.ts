import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../mcp.catalog";
import { MCP_SCOPES } from "../mcp.config";
import { KEY_CLASS_TABLE } from "../../../__tests__/helpers/mcpKeyClasses";

// Every tool of the connected-apps server declares the permission it needs and
// the rate lane it spends, and the shared toolkit (`mcp.tools.ts`) is the only
// place that checks the permission and registers a tool. These tests read the
// catalog and the tool files, so a tool added later is judged without anyone
// adding it to a list here.

const dir = join(__dirname, "..");
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const toolFiles = readdirSync(dir).filter((f) => /^mcp\.(tools\.\w+|catalog)\.ts$/.test(f));

describe("every connected-apps tool declares its permission and lane", () => {
    it("names a known scope, a lane, and whether it only reads", () => {
        for (const tool of MCP_TOOLS) {
            expect(MCP_SCOPES as readonly string[], `${tool.name}: declare a scope from MCP_SCOPES`).toContain(tool.scope);
            expect(["read", "write"], `${tool.name}: declare lane "read" or "write"`).toContain(tool.lane);
            expect(typeof tool.readOnly, `${tool.name}: declare readOnly`).toBe("boolean");
            expect(["call", "strict"], `${tool.name}: declare its audit`).toContain(tool.audit);
        }
    });

    it("keeps a tool that spends a key on the write lane, not read-only, with a permission above reading", () => {
        for (const tool of MCP_TOOLS) {
            const keyClass = KEY_CLASS_TABLE.get(tool.name);
            if (keyClass === undefined || keyClass === "no-litt-key") continue;
            expect(tool.lane, `${tool.name} spends a key: put it on the write lane`).toBe("write");
            expect(tool.readOnly, `${tool.name} spends a key: it is not read-only`).toBe(false);
            expect(tool.scope, `${tool.name} spends a key: it needs more than litt.read`).not.toBe("litt.read");
        }
    });

    it("keeps a tool that only reads off the write lane's permissions", () => {
        for (const tool of MCP_TOOLS.filter((t) => t.readOnly)) {
            expect(tool.lane, `${tool.name} only reads: use the read lane`).toBe("read");
            expect(tool.scope, `${tool.name} only reads: it needs no write or run permission`).not.toMatch(/^litt\.(write|run)$/);
        }
    });
});

describe("the toolkit alone checks the permission and registers tools", () => {
    it("registers a tool only in mcp.tools.ts", () => {
        const offenders = readdirSync(dir)
            .filter((f) => f.endsWith(".ts") && f !== "mcp.tools.ts")
            .filter((f) => /\.registerTool\(/.test(strip(readFileSync(join(dir, f), "utf8"))));
        expect(offenders, "declare the tool with defineMcpTool and list it in mcp.catalog.ts; do not register it by hand").toEqual([]);
    });

    it("does not decide a tool's permission inside a tool file", () => {
        // Allowed: only to REPORT the connection's permissions, or to ask for one more permission
        // than the tool declares for a delegated run (mcp.tools.workflows.ts needScope).
        const ALLOWED = new Map([
            ["mcp.catalog.ts", "whoami lists the permissions the connection holds"],
            ["mcp.tools.chat.ts", "reports the capabilities of the connection in a result"],
            ["mcp.tools.workflows.ts", "a workflow that runs a chat or review also needs that permission, on top of the declared one"],
        ]);
        const offenders = toolFiles
            .filter((f) => !ALLOWED.has(f))
            .filter((f) => /\bscopes\b\s*\.\s*(includes|some|has|every)\s*\(/.test(strip(readFileSync(join(dir, f), "utf8"))));
        expect(offenders, "declare the permission with `scope` on the tool; the toolkit checks it").toEqual([]);
    });
});
