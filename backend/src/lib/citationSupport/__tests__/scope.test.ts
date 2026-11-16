import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The check covers the citations the chat engine verifies (web chat, project
// chat and the Word add-in) and, through their own adapters, the tabular review
// (its cells and its chat) and the source quotes of playbook drafts. Each path
// reaches lib/citationSupport only through its own adapter, so the set of files
// that can send text to the service stays this short and is pinned here.
const SRC = resolve(__dirname, "../../..");
const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(relative(SRC, full).split(sep).join("/"));
    }
    return out;
};

describe("where the citation check can be reached from", () => {
    it("only the chat routes, the chat engine, the tabular and playbook adapters and the setting import it", () => {
        const importers = walk(SRC)
            .filter((file) => !file.startsWith("lib/citationSupport/"))
            .filter((file) => /citationSupport/.test(readFileSync(join(SRC, file), "utf8")))
            .sort();
        expect(importers).toEqual([
            "lib/chatFeatureGates.ts",
            "modules/chat/chat.messages.ts",
            "modules/chat/chat.routes.ts",
            "modules/chat/engine/streaming.ts",
            "modules/playbooks/playbooks.citationSupport.ts",
            "modules/playbooks/playbooks.draft.ts",
            "modules/playbooks/playbooks.state.ts",
            "modules/project-chat/projectChat.routes.ts",
            "modules/tabular/tabular.cells.ts",
            "modules/tabular/tabular.chats.ts",
            "modules/tabular/tabular.citationSupport.ts",
            "modules/tabular/tabular.extractRow.ts",
            "modules/tabular/tabular.extraction.ts",
            "modules/tabular/tabular.generateStream.ts",
            "modules/tabular/tabular.reviews.ts",
            "modules/tabular/tabular.routes.ts",
            "modules/user/user.citationCheck.ts",
            "modules/word-chat/wordChat.routes.ts",
            "modules/word-chat/wordChat.service.ts",
        ]);
    });

    it("only the two adapters send; the read side only imports the review readers", () => {
        const direct = walk(SRC)
            .filter((file) => /tabular|playbook/.test(file))
            .filter((file) => /from "\.\.\/\.\.\/lib\/citationSupport"/.test(readFileSync(join(SRC, file), "utf8")))
            .sort();
        expect(direct).toEqual([
            "modules/playbooks/playbooks.citationSupport.ts",
            // Read side (the «Revisar esta cita» hint): readReviewRefs / readDraftReviewRefs only.
            "modules/playbooks/playbooks.state.ts",
            "modules/tabular/tabular.chats.ts",
            "modules/tabular/tabular.citationSupport.ts",
            "modules/tabular/tabular.reviews.ts",
        ]);
        for (const file of direct.filter((f) => !/citationSupport\.ts$/.test(f))) {
            const imported = readFileSync(join(SRC, file), "utf8").match(/import \{([^}]*)\} from "\.\.\/\.\.\/lib\/citationSupport"/)?.[1] ?? "";
            expect(imported).not.toMatch(/Runner|Turn|runCitationSupportChecks|askCitationSupport/);
        }
    });

    it("the tabular and playbook paths never pass the chat engine's hook", () => {
        for (const file of walk(SRC).filter((f) => /tabular|playbook/.test(f))) {
            expect(readFileSync(join(SRC, file), "utf8")).not.toContain("onCitationSupportInputs");
        }
    });

    it("subagents are never checked: the engine's hook is skipped for them", () => {
        expect(readFileSync(join(SRC, "modules/chat/engine/streaming.ts"), "utf8")).toMatch(
            /onCitationSupportInputs && !isSubagent/,
        );
    });
});
