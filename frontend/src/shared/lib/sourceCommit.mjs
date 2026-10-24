// AGPL-3.0 §13: anyone who uses LiTT over a network must be able to get the
// Corresponding Source of the exact version they are using. Each build bakes in
// the full commit SHA it was built from, and the UI links to that tree.
//
// Plain ESM JavaScript, not TypeScript: the build configs (frontend
// next.config.ts and word-addin/webpack.config.js) import it as well as the
// web app and the Word add-in. Types live in sourceCommit.d.mts.

export const SOURCE_REPOSITORY_URL = "https://github.com/IvanJS17/litt";

const FULL_COMMIT = /^[0-9a-f]{40}$/;

/** The source tree of `commit`, or null when it is not a full commit SHA. */
export function sourceCodeUrl(commit) {
    return typeof commit === "string" && FULL_COMMIT.test(commit)
        ? `${SOURCE_REPOSITORY_URL}/tree/${commit}`
        : null;
}

/**
 * The commit a build embeds. An explicit `GIT_SHA` must be a full SHA. A
 * production build without one fails: a hosted build must never ship without
 * its source link. Development falls back to the checkout's HEAD, and to no
 * commit (no link) outside a Git checkout.
 */
export function resolveSourceCommit({ explicit, production, readGitHead }) {
    const value = explicit?.trim();
    if (value) {
        if (!FULL_COMMIT.test(value)) {
            throw new Error(
                "GIT_SHA must be the full 40-character lowercase commit SHA.",
            );
        }
        return value;
    }
    if (production) {
        throw new Error(
            "A production build needs GIT_SHA, the full SHA of the published " +
                "commit it is built from (for example GIT_SHA=$(git rev-parse HEAD)).",
        );
    }
    try {
        const head = readGitHead().trim();
        return FULL_COMMIT.test(head) ? head : "";
    } catch {
        return "";
    }
}
