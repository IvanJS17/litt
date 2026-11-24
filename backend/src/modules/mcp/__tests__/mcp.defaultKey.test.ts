import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A tool that hands a credential reference to a service must get the default
// from the one helper (mcp.defaultKey.ts), so a new tool cannot forget the rule.
const dir = join(__dirname, "..");
// Passes the app's reference on to `runTurn` (mcp.tools.chat.ts), which asks the helper.
const VIA_SHARED_TURN = new Set(["mcp.tools.workflows.ts"]);

describe("work a connected app starts takes its default key from one helper", () => {
    const toolFiles = readdirSync(dir).filter((f) => /^mcp\.tools\.\w+\.ts$/.test(f));

    it.each(toolFiles)("%s", (file) => {
        const source = readFileSync(join(dir, file), "utf8");
        const passesReference = /credential_?ref/i.test(source);
        if (!passesReference) return;
        if (VIA_SHARED_TURN.has(file)) {
            expect(source).toContain("runTurn(");
            expect(source).not.toMatch(/queuePlaybookReview|startChatTurn|pinChatRoute/);
            return;
        }
        expect(source).toMatch(/import \{[^}]*defaultKeyFor[^}]*\} from "\.\/mcp\.defaultKey"/);
        expect(source).toContain("defaultKeyFor(");
    });

    it("the helper is the only place that reads the list of usable keys", () => {
        const offenders = readdirSync(dir).filter(
            (f) => f.endsWith(".ts") && f !== "mcp.defaultKey.ts" && /listChatCredentialOptions|pinChatRoute/.test(readFileSync(join(dir, f), "utf8")),
        );
        expect(offenders).toEqual([]);
    });
});
