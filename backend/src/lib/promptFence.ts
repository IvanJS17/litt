// Untrusted text handed to a model as data, never as instructions (LiTT
// training, docs/training.md). Each block is tagged with a per-call random
// nonce; the text cannot forge the closing tag because the nonce is redacted
// from it and every reserved tag it contains is escaped.

import { randomBytes } from "node:crypto";

/** A fresh nonce for one model call. */
export function promptNonce(): string {
    return randomBytes(8).toString("hex");
}

/**
 * `text` inside `<tag nonce="…">…</tag nonce="…">`. `reservedTags` are the
 * tags of every block in the same prompt: none of them can be opened or
 * closed from inside the text.
 */
export function fenced(
    text: string,
    tag: string,
    nonce: string,
    reservedTags: readonly string[] = [tag],
): string {
    const names = [...new Set([tag, ...reservedTags])]
        .map((name) => name.replace(/[^a-z0-9-]/gi, ""))
        .filter(Boolean);
    const safe = text
        .split(nonce)
        .join("[redacted-nonce]")
        .replace(new RegExp(`<(\\/?)(${names.join("|")})`, "gi"), "&lt;$1$2");
    return `<${tag} nonce="${nonce}">\n${safe}\n</${tag} nonce="${nonce}">`;
}
