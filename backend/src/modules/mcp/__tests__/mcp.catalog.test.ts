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
    it("classifies the layer 2a tools: reads on litt.read, runs on litt.run, compare and convert on litt.write, none destructive, none in mode B", () => {
        const expected: Record<string, { scope: string; lane: string; readOnly: boolean; audit: string }> = {
            list_workflows: { scope: "litt.read", lane: "read", readOnly: true, audit: "call" },
            // The workflow's text goes to the client's AI: strict, like get_playbook.
            get_workflow: { scope: "litt.read", lane: "read", readOnly: true, audit: "strict" },
            list_quick_actions: { scope: "litt.read", lane: "read", readOnly: true, audit: "call" },
            preview_document_conversion: { scope: "litt.read", lane: "read", readOnly: true, audit: "call" },
            run_workflow: { scope: "litt.run", lane: "write", readOnly: false, audit: "strict" },
            run_quick_action: { scope: "litt.run", lane: "write", readOnly: false, audit: "strict" },
            compare_documents: { scope: "litt.write", lane: "write", readOnly: false, audit: "strict" },
            convert_document: { scope: "litt.write", lane: "write", readOnly: false, audit: "strict" },
        };
        for (const [name, want] of Object.entries(expected)) {
            const tool = MCP_TOOLS.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool, name).toMatchObject(want);
            expect(tool!.destructive ?? false, name).toBe(false);
            // Mode A (LiTT's own engine) or no model at all: an apprentice may call every one.
            expect(tool!.mode ?? "A", name).toBe("A");
        }
    });

    it("keeps the layer 2a tools off the routes that ask for two-step verification (design §6.3)", async () => {
        // The routes these tools sit on carry no requireMfaIfEnrolled; if one ever does, the tool must go.
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const modules = join(__dirname, "..", "..");
        for (const file of ["documents/documents.routes.ts", "workflows/workflows.routes.ts", "quick-actions/quickActions.routes.ts", "chat/chat.routes.ts", "tabular/tabular.routes.ts"])
            expect(readFileSync(join(modules, file), "utf8"), file).not.toContain("requireMfaIfEnrolled");
    });
});
