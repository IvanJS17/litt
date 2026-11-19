import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

    it("classifies the layer 2b tools: the two states are reads, the three that send or create are litt.write on the write lane with a strict audit, none destructive, none in mode B", () => {
        const expected: Record<string, { scope: string; lane: string; readOnly: boolean; audit: string }> = {
            get_scan_reading_state: { scope: "litt.read", lane: "read", readOnly: true, audit: "call" },
            get_case_file_split_state: { scope: "litt.read", lane: "read", readOnly: true, audit: "call" },
            // They send pages or text to LandingAI with the person's key (read_scanned_document, propose_case_file_split) or create documents.
            read_scanned_document: { scope: "litt.write", lane: "write", readOnly: false, audit: "strict" },
            propose_case_file_split: { scope: "litt.write", lane: "write", readOnly: false, audit: "strict" },
            create_split_documents: { scope: "litt.write", lane: "write", readOnly: false, audit: "strict" },
        };
        for (const [name, want] of Object.entries(expected)) {
            const tool = MCP_TOOLS.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool, name).toMatchObject(want);
            expect(tool!.destructive ?? false, name).toBe(false);
            expect(tool!.mode ?? "A", name).toBe("A");
        }
        // The two that send ask for the cost to be confirmed.
        for (const name of ["read_scanned_document", "propose_case_file_split"])
            expect(Object.keys(MCP_TOOLS.find((t) => t.name === name)!.inputSchema.shape), name).toContain("acknowledge_cost");
    });

    it("gives every tool a heavy-work class: a new tool cannot be added without one (design §9.4)", () => {
        // `sync`: the work is the call. `background`: it goes on after the call (mcp.heavy.ts).
        const heavy: Record<string, "sync" | "background"> = {
            run_playbook_review: "background",
            run_tabular_review: "background",
            start_chat: "background",
            send_chat_message: "background",
            start_project_chat: "background",
            send_project_chat_message: "background",
            send_tabular_chat_message: "background",
            run_workflow: "background",
            run_quick_action: "background",
            read_scanned_document: "background",
            compare_documents: "sync",
            convert_document: "sync",
            propose_case_file_split: "sync",
            create_split_documents: "sync",
        };
        // Every other tool that writes is light on purpose: it stores rows or a file, sets a grid up, or stops work.
        const lightWrites = new Set([
            "create_matter",
            "create_note_document",
            "request_document_upload",
            "complete_document_upload", // extraction runs on the extraction worker (concurrency 3)
            "submit_playbook_review", // stores the findings the client's own AI wrote
            "create_tabular_review", // only sets the grid up; run_tabular_review is the heavy step
            "stop_chat_turn",
            "stop_tabular_chat_turn",
            "stop_tabular_run",
        ]);
        const actual: Record<string, "sync" | "background"> = {};
        for (const tool of MCP_TOOLS) {
            if (tool.heavy) actual[tool.name] = tool.heavy;
            else if (!tool.readOnly) expect(lightWrites.has(tool.name), `${tool.name} writes: classify it heavy or add it as a light write`).toBe(true);
            // A read never takes a slot.
            if (tool.readOnly) expect(tool.heavy, tool.name).toBeUndefined();
        }
        expect(actual).toEqual(heavy);
        for (const name of lightWrites) expect(MCP_TOOLS.some((t) => t.name === name), name).toBe(true);
    });

    it("offers 57 tools: 50 up to layer 2b and the seven of layer 2c", () => {
        expect(MCP_TOOLS).toHaveLength(57);
    });

    it("classifies the layer 2c tools: chats on litt.chat, the firm profile a strict read, all mode A, none destructive", () => {
        const expected: Record<string, { scope: string; lane: string; readOnly: boolean; audit: string }> = {
            // The matter's conversation and the review's: they spend the person's model budget and write a thread.
            start_project_chat: { scope: "litt.chat", lane: "write", readOnly: false, audit: "strict" },
            send_project_chat_message: { scope: "litt.chat", lane: "write", readOnly: false, audit: "strict" },
            send_tabular_chat_message: { scope: "litt.chat", lane: "write", readOnly: false, audit: "strict" },
            stop_tabular_chat_turn: { scope: "litt.chat", lane: "write", readOnly: false, audit: "strict" },
            get_tabular_chat_turn: { scope: "litt.chat", lane: "read", readOnly: true, audit: "call" },
            list_tabular_chats: { scope: "litt.chat", lane: "read", readOnly: true, audit: "call" },
            // The firm's own text goes to the client's AI.
            get_firm_profile: { scope: "litt.read", lane: "read", readOnly: true, audit: "strict" },
        };
        for (const [name, want] of Object.entries(expected)) {
            const tool = MCP_TOOLS.find((t) => t.name === name);
            expect(tool, name).toBeDefined();
            expect(tool, name).toMatchObject(want);
            expect(tool!.destructive ?? false, name).toBe(false);
            // LiTT's own assistant answers (mode A): an apprentice's turn goes through "Tu turno primero".
            expect(tool!.mode ?? "A", name).toBe("A");
        }
        // Each tool that starts or continues a turn takes the apprentice's own approach.
        for (const name of ["start_project_chat", "send_project_chat_message", "send_tabular_chat_message"])
            expect(Object.keys(MCP_TOOLS.find((t) => t.name === name)!.inputSchema.shape), name).toEqual(expect.arrayContaining(["attempt", "confidence"]));
    });

    it("reads every prompt and resource through a tool of the catalog (no second authorization path)", async () => {
        const { toolFor } = await import("../mcp.context.js");
        const names = new Set(MCP_TOOLS);
        for (const tool of Object.values(toolFor)) expect(names.has(tool), tool.name).toBe(true);
        expect(Object.values(toolFor).map((t) => t.name).sort()).toEqual(["get_client_profile", "get_firm_profile", "get_playbook", "get_workflow"]);
        // Every one is a read that takes document or firm text out, so its audit is strict.
        for (const tool of Object.values(toolFor)) expect(tool, tool.name).toMatchObject({ readOnly: true, audit: "strict", scope: "litt.read" });
    });

    it("keeps prompts and resources off the code that reads or lists tables, and out of every other authorization path", async () => {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        for (const file of ["mcp.context.ts", "mcp.prompts.ts", "mcp.resources.ts"]) {
            const source = readFileSync(join(__dirname, "..", file), "utf8");
            expect(source, file).not.toMatch(/\.from\(\s*["'`]/);
            expect(source, file).not.toMatch(/createServerSupabase|checkProjectAccess|ensureDocAccess|principal\.workspaces\.some/);
        }
    });

    it("keeps the layer 2a, 2b and 2c tools off the routes that ask for two-step verification (design §6.3)", async () => {
        // The routes these tools sit on carry no requireMfaIfEnrolled; if one ever does, the tool must go.
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const modules = join(__dirname, "..", "..");
        for (const file of ["documents/documents.routes.ts", "workflows/workflows.routes.ts", "quick-actions/quickActions.routes.ts", "chat/chat.routes.ts", "tabular/tabular.routes.ts", "project-chat/projectChat.routes.ts"])
            expect(readFileSync(join(modules, file), "utf8"), file).not.toContain("requireMfaIfEnrolled");
        // The firm profile's READ route (the one get_firm_profile and its resource stand on) carries none; only its PUT does.
        const orgs = readFileSync(join(modules, "orgs/orgs.routes.ts"), "utf8");
        const read = orgs.slice(orgs.indexOf('orgsRouter.get("/:orgId/profile"'), orgs.indexOf('orgsRouter.put(\n    "/:orgId/profile"'));
        expect(read.length).toBeGreaterThan(50);
        expect(read).not.toContain("requireMfaIfEnrolled");
        expect(orgs.slice(orgs.indexOf('orgsRouter.put(\n    "/:orgId/profile"'), orgs.indexOf('orgsRouter.put(\n    "/:orgId/profile"') + 200)).toContain("requireMfaIfEnrolled");
    });

    it("makes every background tool register its hold: a tool that forgets would free its slot when the call ends (design §9.4)", () => {
        // Structural: where each background tool's work registers `call.heavy?.hold(...)`. Tools that
        // delegate (run_workflow, run_quick_action) name the files that hold on their behalf.
        const holdsIn: Record<string, string[]> = {
            start_chat: ["mcp.tools.chat.ts"],
            send_chat_message: ["mcp.tools.chat.ts"],
            start_project_chat: ["mcp.tools.projectChats.ts"],
            send_project_chat_message: ["mcp.tools.projectChats.ts"],
            send_tabular_chat_message: ["mcp.tools.tabularChats.ts"],
            run_tabular_review: ["mcp.tools.tabular.ts"],
            run_playbook_review: ["mcp.tools.playbooks.ts"],
            read_scanned_document: ["mcp.tools.scans.ts"],
            run_workflow: ["mcp.tools.chat.ts", "mcp.tools.tabular.ts"],
            run_quick_action: ["mcp.tools.chat.ts", "mcp.tools.tabular.ts"],
        };
        const background = MCP_TOOLS.filter((t) => t.heavy === "background").map((t) => t.name);
        // A new background tool must be listed here (and so must hold), not just classified.
        expect([...background].sort()).toEqual(Object.keys(holdsIn).sort());
        const dir = join(__dirname, "..");
        for (const [tool, files] of Object.entries(holdsIn))
            for (const file of files)
                expect(readFileSync(join(dir, file), "utf8"), `${tool}: ${file} must call call.heavy?.hold(...)`).toMatch(/\bheavy\??\.hold\(/);
    });
});
