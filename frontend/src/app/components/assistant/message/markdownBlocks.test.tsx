import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";
import { splitMarkdownBlocks } from "./markdownBlocks";

const parsed = vi.hoisted(() => vi.fn());
vi.mock("react-markdown", async (importOriginal) => {
    const original = await importOriginal<typeof import("react-markdown")>();
    return {
        ...original,
        default: (props: import("react-markdown").Options) => {
            parsed(props.children);
            return <original.default {...props} />;
        },
    };
});

const DOCUMENTS: Record<string, string> = {
    prose: "# Title\n\nFirst paragraph with **bold** and `code`.\n\nSecond paragraph.\n\n## Section\n\nThird.",
    tightList: "Intro:\n\n- one\n- two\n- three\n\nAfter the list.",
    looseList: "Steps:\n\n1. First\n\n2. Second\n\n3. Third\n\nDone.",
    nestedList: "- a\n\n  continued paragraph of a\n\n- b\n\nEnd",
    codeWithBlankLines: "Before\n\n```ts\nconst a = 1;\n\n\nconst b = 2;\n```\n\nAfter",
    tildeFence: "Before\n\n~~~\nx\n\ny\n~~~\n\nAfter",
    table: "Table:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter",
    quote: "> quoted\n\n> still quoted\n\nPlain",
    math: "Equation:\n\n$$\nx = 1\n\ny = 2\n$$\n\nAfter",
    citations: "Claim `§0§`.\n\nAnother `§1§`.",
    indentedCode: "Para\n\n    indented code\n\nPara 2",
    references: "See [a][1].\n\nMore.\n\n[1]: https://example.com",
    footnote: "Text[^1].\n\nMore.\n\n[^1]: note",
};

describe("splitMarkdownBlocks", () => {
    it.each(Object.entries(DOCUMENTS))("gives back %s exactly when the pieces are joined", (_name, text) => {
        expect(splitMarkdownBlocks(text).join("")).toBe(text);
    });

    it("splits ordinary prose at its blank lines", () => {
        expect(splitMarkdownBlocks(DOCUMENTS.prose).length).toBeGreaterThan(3);
    });

    it("never splits inside a code fence, a $$ block or a list", () => {
        for (const name of ["codeWithBlankLines", "tildeFence", "math"]) {
            const pieces = splitMarkdownBlocks(DOCUMENTS[name]);
            expect(pieces.some((piece) => /const a = 1;\n\n\nconst b|x\n\ny|x = 1\n\ny = 2/.test(piece)), name).toBe(true);
        }
        expect(splitMarkdownBlocks(DOCUMENTS.looseList).some((piece) => piece.includes("1. First") && piece.includes("2. Second") && piece.includes("3. Third"))).toBe(true);
        expect(splitMarkdownBlocks(DOCUMENTS.nestedList).some((piece) => piece.includes("- a") && piece.includes("- b"))).toBe(true);
    });

    it("leaves text with reference links or footnotes whole", () => {
        expect(splitMarkdownBlocks(DOCUMENTS.references)).toHaveLength(1);
        expect(splitMarkdownBlocks(DOCUMENTS.footnote)).toHaveLength(1);
    });
});

describe("MarkdownContent while streaming", () => {
    beforeEach(() => parsed.mockClear());

    const html = (text: string, streaming: boolean) => {
        const { container, unmount } = render(
            <MarkdownContent text={text} inlineCitationTargets={[]} streaming={streaming} />,
        );
        const markup = container.innerHTML;
        unmount();
        return markup;
    };

    it.each(Object.entries(DOCUMENTS))("draws %s the same block by block as whole", (_name, text) => {
        expect(html(text, true)).toBe(html(text, false));
    });

    it("draws every prefix of a long answer block by block as it would whole, and the final text is identical", () => {
        const text = Object.values(DOCUMENTS).join("\n\n");
        for (let end = 1; end <= text.length; end += 37) {
            const prefix = text.slice(0, end);
            expect(html(prefix, true), `at ${end}`).toBe(html(prefix, false));
        }
        expect(html(text, true)).toBe(html(text, false));
    });

    it("parses a closed block once while the open one grows", () => {
        const closed = "# Heading\n\nA finished paragraph.\n\n";
        const { rerender } = render(
            <MarkdownContent text={`${closed}Open`} inlineCitationTargets={[]} streaming />,
        );
        parsed.mockClear();
        for (const tail of ["Open par", "Open paragraph", "Open paragraph, more"]) {
            rerender(<MarkdownContent text={`${closed}${tail}`} inlineCitationTargets={[]} streaming />);
        }
        const reparsedClosed = parsed.mock.calls.filter(([text]) => String(text).includes("finished paragraph") || String(text).includes("Heading"));
        expect(reparsedClosed).toHaveLength(0);
        expect(parsed).toHaveBeenCalledTimes(3);
    });

    it("draws the whole text as one when it stops streaming", () => {
        const text = DOCUMENTS.prose;
        const { rerender } = render(<MarkdownContent text={text} inlineCitationTargets={[]} streaming />);
        parsed.mockClear();
        rerender(<MarkdownContent text={text} inlineCitationTargets={[]} streaming={false} />);
        expect(parsed).toHaveBeenCalledTimes(1);
        expect(parsed).toHaveBeenCalledWith(text);
    });
});
