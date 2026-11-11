import { afterEach, describe, expect, it, vi } from "vitest";
import type { AssistantEvent } from "@/app/components/shared/types";
import {
    downloadResponseMarkdown,
    markdownFilename,
    responseMarkdown,
} from "./assistantMarkdownExport";
import * as download from "./downloadDocument";

describe("responseMarkdown", () => {
    it("joins the text blocks of the answer, unchanged and in order", () => {
        const events = [
            { type: "content", text: "# Resumen\n\n| a | b |\n|---|---|" },
            { type: "reasoning", text: "no" },
            { type: "content", text: "   " },
            { type: "content", text: "Fin [1]" },
        ] as unknown as AssistantEvent[];
        expect(responseMarkdown(events)).toBe(
            "# Resumen\n\n| a | b |\n|---|---|\n\nFin [1]",
        );
    });

    it("is empty when there is nothing to export", () => {
        expect(responseMarkdown(undefined)).toBe("");
        expect(responseMarkdown([])).toBe("");
    });
});

describe("markdownFilename", () => {
    it("builds a safe ASCII name from the first line", () => {
        expect(markdownFilename("# Cláusula de Indemnización (2026)\ntexto", "x")).toBe(
            "clausula-de-indemnizacion-2026.md",
        );
    });

    it("never carries path or reserved characters", () => {
        const name = markdownFilename("../../etc/passwd: <b>*?\"|", "respuesta");
        expect(name).toBe("etc-passwd-b.md");
        expect(name).toMatch(/^[a-z0-9-]+\.md$/);
    });

    it("cuts long names and falls back when nothing usable is left", () => {
        expect(markdownFilename("a".repeat(200), "x")).toBe(`${"a".repeat(60)}.md`);
        expect(markdownFilename("日本語 ###", "respuesta")).toBe("respuesta.md");
        expect(markdownFilename("", "respuesta")).toBe("respuesta.md");
    });
});

describe("downloadResponseMarkdown", () => {
    afterEach(() => vi.restoreAllMocks());

    it("downloads the Markdown bytes as text/markdown", async () => {
        const spy = vi.spyOn(download, "downloadBlob").mockImplementation(() => {});
        downloadResponseMarkdown("# Hola\n", "respuesta");
        const [blob, name] = spy.mock.calls[0];
        expect(name).toBe("hola.md");
        expect(blob.type).toBe("text/markdown;charset=utf-8");
        expect(await blob.text()).toBe("# Hola\n");
    });
});
