import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

describe("notice stack lifts above the chat composer", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("keys on the language-independent composer marker, not a button name", () => {
        const rule = css.match(
            /body:has\(([^)]*)\)\s*\.notice-stack\s*\{[^}]*bottom:[^}]*\}/,
        );
        expect(rule).not.toBeNull();
        expect(rule![1]).toContain('[data-slot="chat-composer"]');
        expect(rule![0]).not.toMatch(/aria-label/);
    });

    it("matches a Spanish-labelled composer", () => {
        document.body.innerHTML = `
            <div data-slot="chat-composer">
                <button aria-label="Enviar mensaje"></button>
            </div>
            <div class="notice-stack"></div>`;
        expect(
            document.querySelector('body:has([data-slot="chat-composer"]) .notice-stack'),
        ).not.toBeNull();
    });
});
