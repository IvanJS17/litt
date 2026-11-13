import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { describe, expect, it, vi } from "vitest";
import { LegalDocument } from "./LegalDocument";
import { legalToc } from "./legalAnchors";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ back: vi.fn(), refresh: vi.fn() }),
}));

const SOURCES = ["terminos-y-condiciones.md", "aviso-de-privacidad.md"].map((file) => ({
    file,
    markdown: readFileSync(path.join(process.cwd(), "src/content/legal", file), "utf8"),
}));

const squash = (text: string) => text.replace(/\s+/g, "");

describe.each(SOURCES)("LegalDocument · $file", ({ markdown }) => {
    it("renders exactly the words of the source", () => {
        render(<LegalDocument markdown={markdown} />);
        const rendered = screen.getByTestId("legal-text").textContent ?? "";
        const source = toString(
            fromMarkdown(markdown, {
                extensions: [gfm()],
                mdastExtensions: [gfmFromMarkdown()],
            }),
        );
        expect(squash(rendered)).toBe(squash(source));
    });

    it("gives every numbered section an anchor and a contents entry", () => {
        render(<LegalDocument markdown={markdown} />);
        const toc = legalToc(markdown);
        expect(toc.length).toBeGreaterThan(5);
        for (const entry of toc) {
            const heading = document.getElementById(entry.id);
            expect(heading?.tagName).toBe("H2");
            expect(heading).toHaveTextContent(entry.title);
            expect(screen.getByRole("link", { name: entry.title })).toHaveAttribute(
                "href",
                `#${entry.id}`,
            );
        }
        const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("has a way back", () => {
        render(<LegalDocument markdown={markdown} />);
        expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    });
});

describe("Terms clause anchors", () => {
    it("puts clause 5.5 (the managed-account clause) at #5-5", () => {
        const markdown = SOURCES[0].markdown;
        render(<LegalDocument markdown={markdown} />);
        const clause = document.getElementById("5-5");
        expect(clause?.tagName).toBe("LI");
        expect(clause).toHaveTextContent("Espacio personal.");
        expect(clause).toHaveTextContent("Cuentas administradas por el despacho");
        expect(document.getElementById("5-6")).toHaveTextContent("Responsabilidad del despacho");
    });
});
