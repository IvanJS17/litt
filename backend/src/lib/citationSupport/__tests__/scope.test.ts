import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

// The check covers the citations the chat engine verifies (web chat, project
// chat and the Word add-in). The tabular review builds its citations on
// another path and the playbooks produce none, so neither may reach
// lib/citationSupport.
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
    it("only the chat routes, the chat engine and the setting import it", () => {
        const importers = walk(SRC)
            .filter((file) => !file.startsWith("lib/citationSupport/"))
            .filter((file) => /citationSupport/.test(readFileSync(join(SRC, file), "utf8")))
            .sort();
        expect(importers).toEqual([
            "lib/chatFeatureGates.ts",
            "modules/chat/chat.routes.ts",
            "modules/chat/engine/streaming.ts",
            "modules/project-chat/projectChat.routes.ts",
            "modules/user/user.citationCheck.ts",
            "modules/word-chat/wordChat.routes.ts",
        ]);
        for (const file of importers) {
            expect(file).not.toMatch(/tabular|playbook/);
        }
    });

    it("the tabular and playbook paths never pass the engine's hook", () => {
        for (const file of walk(SRC).filter((f) => /tabular|playbook/.test(f))) {
            expect(readFileSync(join(SRC, file), "utf8")).not.toContain("onCitationSupportInputs");
        }
    });
});
