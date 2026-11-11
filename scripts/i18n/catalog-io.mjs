// How the message catalogs are read and written, shared by extract.mjs (the
// codemod) and translate.mjs so both leave the same bytes: keys sorted at
// every level, two-space JSON, one trailing newline.

// Repository-relative paths of the two catalogs.
export const CATALOGS = { en: "packages/i18n/messages/en-US.json", es: "packages/i18n/messages/es-MX.json" };

export const isTree = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function sortTree(tree) {
    return Object.fromEntries(
        Object.keys(tree)
            .sort()
            .map((k) => [k, isTree(tree[k]) ? sortTree(tree[k]) : tree[k]]),
    );
}

export const serializeCatalog = (tree) => `${JSON.stringify(sortTree(tree), null, 2)}\n`;

/** Dotted paths of every message (leaf) of a catalog tree. */
export function leaves(tree, prefix = "") {
    return Object.entries(tree).flatMap(([k, v]) => (isTree(v) ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

/** The message at a dotted path, or undefined. */
export function getLeaf(tree, path) {
    let node = tree;
    for (const part of path.split(".")) {
        if (!isTree(node) || !(part in node)) return undefined;
        node = node[part];
    }
    return isTree(node) ? undefined : node;
}

/** Sets the message at an existing dotted path. */
export function setLeaf(tree, path, value) {
    const parts = path.split(".");
    const last = parts.pop();
    let node = tree;
    for (const part of parts) node = node[part];
    node[last] = value;
}
