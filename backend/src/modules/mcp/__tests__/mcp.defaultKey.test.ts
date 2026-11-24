import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MCP_TOOLS } from "../mcp.catalog";
import { KEY_CLASS_ENTRIES, KEY_CLASS_TABLE, toolsOfClass } from "../../../__tests__/helpers/mcpKeyClasses";

// Work a connected app starts with LiTT's own model runs on a default key
// chosen in one place (mcp.defaultKey.ts). Two tests hold that together.
//
// The registry test guarantees that every tool the server registers has been
// placed in one class of the key table, that the table names no tool that is
// not registered, and that every tool offering a `credential_ref` is a
// default-key tool; the integration test of the same table runs each
// default-key tool on real key resolution. It does not read what a handler
// does, so a tool put in a wrong class is for a reviewer to notice: the table
// makes the choice visible instead of checking it.
// The source scan complements it: a tool file that mentions a credential
// reference (comments aside) must import and call the helper. It cannot see a
// helper or a variable that hides the reference; the registry test and the
// behaviour test cover that.

const registered = MCP_TOOLS.map((tool) => tool.name);

describe("every registered tool has a key class", () => {
    it("lists a class for each registered tool and no tool that is not registered", () => {
        expect(registered.filter((name) => !KEY_CLASS_TABLE.has(name)), "registered but not in the table").toEqual([]);
        expect([...KEY_CLASS_TABLE.keys()].filter((name) => !registered.includes(name)), "in the table but not registered").toEqual([]);
    });

    it("places each tool in exactly one class", () => {
        const names = KEY_CLASS_ENTRIES.map(([name]) => name);
        expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([]);
        expect(registered.filter((name, index) => registered.indexOf(name) !== index)).toEqual([]);
    });

    it("a tool that takes a credential_ref is a default-key tool", () => {
        const offering = MCP_TOOLS.filter((tool) => "credential_ref" in (tool.inputSchema as { shape: Record<string, unknown> }).shape).map((tool) => tool.name);
        expect(offering.length).toBeGreaterThan(0);
        for (const name of offering) expect(KEY_CLASS_TABLE.get(name), name).toBe("default-key");
    });
});

describe("a tool file that mentions a credential reference uses the helper", () => {
    const dir = join(__dirname, "..");
    const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // Passes the app's reference on to `runTurn` (mcp.tools.chat.ts), which asks the helper.
    const viaSharedTurn = new Set(["mcp.tools.workflows.ts"]);

    it.each(readdirSync(dir).filter((file) => /^mcp\.tools\.\w+\.ts$/.test(file)))("%s", (file) => {
        const source = strip(readFileSync(join(dir, file), "utf8"));
        if (!/credential_?ref/i.test(source)) return;
        if (viaSharedTurn.has(file)) {
            expect(source).toContain("runTurn(");
            expect(source).not.toMatch(/queuePlaybookReview|startChatTurn|pinChatRoute/);
            return;
        }
        expect(source).toMatch(/import \{[^}]*defaultKeyFor[^}]*\} from "\.\/mcp\.defaultKey"/);
        expect(source).toMatch(/await defaultKeyFor\(/);
    });

    it("the helper is the only place that reads the list of usable keys", () => {
        const offenders = readdirSync(dir).filter(
            (file) => file.endsWith(".ts") && file !== "mcp.defaultKey.ts" && /listChatCredentialOptions|pinChatRoute/.test(strip(readFileSync(join(dir, file), "utf8"))),
        );
        expect(offenders).toEqual([]);
    });
});

describe("tool texts say whose key is used", () => {
    const shape = (tool: (typeof MCP_TOOLS)[number]) => (tool.inputSchema as unknown as { shape: Record<string, { description?: string }> }).shape;

    it("no description says the work runs on the person's own AI key", () => {
        const offenders = MCP_TOOLS.filter((tool) => /person's (own )?AI key/i.test(tool.description)).map((tool) => tool.name);
        expect(offenders).toEqual([]);
    });

    it("the credential_ref text mentions the firm's keys and the default", () => {
        for (const tool of MCP_TOOLS) {
            const field = shape(tool).credential_ref;
            if (!field) continue;
            expect(field.description, tool.name).toMatch(/firm's/);
            expect(field.description, tool.name).toMatch(/default key/);
        }
    });

    it("every default-key tool that says which key it uses names the workspace's key", () => {
        for (const name of toolsOfClass("default-key")) {
            const tool = MCP_TOOLS.find((candidate) => candidate.name === name)!;
            expect(tool.description, name).toMatch(/workspace's key|firm's key/);
        }
    });
});
