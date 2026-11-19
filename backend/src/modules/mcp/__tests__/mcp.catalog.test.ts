import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "../mcp.catalog";

describe("MCP catalog", () => {
    it("has unique names within Claude's 64-character limit", () => {
        const names = MCP_TOOLS.map((t) => t.name);
        expect(new Set(names).size).toBe(names.length);
        for (const name of names) expect(name.length).toBeLessThanOrEqual(64);
    });

    it("declares the two tools that only add content as additive writes on the write lane, audited strictly", () => {
        for (const name of ["create_matter", "create_note_document"]) {
            const tool = MCP_TOOLS.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool).toMatchObject({ scope: "litt.write", lane: "write", readOnly: false, destructive: false, audit: "strict" });
        }
    });

    it("keeps every tool that writes on the write lane with a non-read scope", () => {
        for (const tool of MCP_TOOLS.filter((t) => !t.readOnly)) {
            expect(tool.lane, tool.name).toBe("write");
            expect(tool.scope, tool.name).not.toBe("litt.read");
        }
    });

    it("declares the four Donna tools as read-only reads, with both languages in the description", () => {
        for (const name of ["list_retainer_requests", "get_client_profile", "get_deadline_radar", "get_retainer_report"]) {
            const tool = MCP_TOOLS.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool).toMatchObject({ scope: "litt.read", lane: "read", readOnly: true });
            expect(tool!.destructive ?? false).toBe(false);
            expect(tool!.description).toContain(" | ");
        }
        // The profile hands cited passages to the client's AI: its audit is strict.
        expect(MCP_TOOLS.find((t) => t.name === "get_client_profile")).toMatchObject({ audit: "strict" });
    });
});
