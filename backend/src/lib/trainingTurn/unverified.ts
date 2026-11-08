// answer_unverified: whether the answer of a turn carried a citation the
// server could not verify. The surfaces keep citations in different shapes
// (document citations with `verified`, with per-quote `verification`,
// tabular annotations), so this reads all of them and never throws.

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unverified(value: Json, depth: number): boolean {
    if (depth > 6) return false;
    if (Array.isArray(value)) return value.some((item) => unverified(item, depth + 1));
    if (!isRecord(value)) return false;
    if (value.verified === false) return true;
    const verification = value.verification;
    if (isRecord(verification) && verification.verified === false) return true;
    return (
        unverified(value.quotes, depth + 1) ||
        unverified(value.document, depth + 1)
    );
}

export function hasUnverifiedCitation(citations: unknown): boolean {
    try {
        return unverified(citations, 0);
    } catch {
        return false;
    }
}
