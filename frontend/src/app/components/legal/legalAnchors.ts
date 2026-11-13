import type { Element, Root, RootContent } from "hast";

/**
 * Anchors for the published legal texts, so a notice can point at one clause
 * ("see clause 5.5" → /terminos#5-5). The texts number their sections
 * ("## 5. Despachos…") and, inside each, their clauses (the items of the
 * numbered list that follows). Section N gets the id `N`; its k-th clause gets
 * `N-k`. Only ids are added: no word of the text is touched.
 */

const SECTION_HEADING = /^\s*(\d+)\.\s/;

function textOf(node: Root | RootContent): string {
    if (node.type === "text") return node.value;
    return "children" in node ? node.children.map(textOf).join("") : "";
}

/** The rehype plugin: sets `id` on each numbered h2 and each clause under it. */
export function rehypeLegalAnchors() {
    return (tree: Root) => {
        let section: string | null = null;
        const used = new Set<string>();
        for (const node of tree.children) {
            if (node.type !== "element") continue;
            if (node.tagName === "h2") {
                section = SECTION_HEADING.exec(textOf(node))?.[1] ?? null;
                if (section && !used.has(section)) {
                    used.add(section);
                    node.properties = { ...node.properties, id: section };
                }
            } else if (node.tagName === "ol" && section) {
                let clause = 0;
                for (const item of node.children) {
                    if (item.type !== "element" || item.tagName !== "li") continue;
                    clause += 1;
                    const id = `${section}-${clause}`;
                    if (used.has(id)) continue;
                    used.add(id);
                    (item as Element).properties = { ...item.properties, id };
                }
            }
        }
    };
}

export interface LegalTocEntry {
    id: string;
    title: string;
}

/** The numbered `##` sections of a legal text, for its table of contents. */
export function legalToc(markdown: string): LegalTocEntry[] {
    const entries: LegalTocEntry[] = [];
    for (const line of markdown.split("\n")) {
        const match = /^##\s+(\d+)\.\s+(.*\S)\s*$/.exec(line);
        if (match) entries.push({ id: match[1], title: `${match[1]}. ${match[2]}` });
    }
    return entries;
}
