import type { AssistantEvent } from "@/app/components/shared/types";
import { downloadBlob } from "./downloadDocument";

/**
 * The Markdown the answer already is: its text blocks as the model wrote
 * them, in order. Nothing is converted.
 */
export function responseMarkdown(events: AssistantEvent[] | undefined): string {
    return (events ?? [])
        .flatMap((event) => (event.type === "content" ? [event.text] : []))
        .filter((text) => text.trim().length > 0)
        .join("\n\n");
}

const MAX_NAME_LENGTH = 60;

/**
 * A file name safe on every system: ASCII letters, digits and dashes drawn
 * from the first line of the answer, never a path or a reserved character.
 */
export function markdownFilename(markdown: string, fallback: string): string {
    const firstLine =
        markdown
            .split("\n")
            .map((line) => line.trim())
            .find(Boolean) ?? "";
    const slug = firstLine
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAX_NAME_LENGTH)
        .replace(/-+$/g, "");
    return `${slug || fallback}.md`;
}

export function downloadResponseMarkdown(markdown: string, fallbackName: string) {
    downloadBlob(
        new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        markdownFilename(markdown, fallbackName),
    );
}
