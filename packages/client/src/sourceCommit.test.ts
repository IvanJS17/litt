import { describe, expect, it } from "vitest";
import { resolveSourceCommit, sourceCodeUrl } from "./sourceCommit.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";

describe("sourceCodeUrl", () => {
    it("links the exact commit's tree in the LiTT repository", () => {
        expect(sourceCodeUrl(SHA)).toBe(
            `https://github.com/IvanJS17/litt/tree/${SHA}`,
        );
    });

    it.each([undefined, null, "", "0123456", SHA.toUpperCase(), `${SHA}\n`])(
        "returns null for %j",
        (value) => {
            expect(sourceCodeUrl(value)).toBeNull();
        },
    );
});

describe("resolveSourceCommit", () => {
    const noGit = () => {
        throw new Error("not a git checkout");
    };

    it("uses the injected SHA, in production and in development", () => {
        for (const production of [true, false]) {
            expect(
                resolveSourceCommit({
                    explicit: ` ${SHA} `,
                    production,
                    readGitHead: () => OTHER,
                }),
            ).toBe(SHA);
        }
    });

    it("fails a production build without a SHA, even inside a checkout", () => {
        for (const explicit of [undefined, "", "  "]) {
            expect(() =>
                resolveSourceCommit({
                    explicit,
                    production: true,
                    readGitHead: () => OTHER,
                }),
            ).toThrow(/production build needs GIT_SHA/);
        }
    });

    it("rejects a short or malformed SHA", () => {
        expect(() =>
            resolveSourceCommit({
                explicit: SHA.slice(0, 7),
                production: false,
                readGitHead: () => OTHER,
            }),
        ).toThrow(/full 40-character/);
    });

    it("falls back to HEAD in development, and to no commit without Git", () => {
        expect(
            resolveSourceCommit({
                explicit: undefined,
                production: false,
                readGitHead: () => `${OTHER}\n`,
            }),
        ).toBe(OTHER);
        expect(
            resolveSourceCommit({
                explicit: undefined,
                production: false,
                readGitHead: noGit,
            }),
        ).toBe("");
    });
});
