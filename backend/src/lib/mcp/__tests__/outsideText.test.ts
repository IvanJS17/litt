// Names, hostnames and urls that come from outside are trimmed and cleaned in
// time proportional to their length, and give what the former expressions gave.

import { describe, expect, it } from "vitest";

import { expectLinearCost } from "../../../__tests__/helpers/linearCost";
import { trimChars } from "../../modelJsonFence";
import { base64Url, openaiToolName, TOOL_NAME_PART_INPUT_MAX_CHARS } from "../client";
import { canonicalHostname, type ConnectorRow } from "../types";

const connector = (name: string): ConnectorRow => ({ id: "12345678-aaaa-bbbb-cccc-dddddddddddd", name }) as ConnectorRow;

// The former implementation, kept as the literal reference.
function oldSanitize(value: string, fallback: string, maxLength: number) {
    const sanitized = value
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
    return (sanitized || fallback).slice(0, maxLength);
}
const oldOpenaiToolName = (name: string, tool: string) =>
    `mcp_${oldSanitize(name, "connector", 18)}_${oldSanitize(tool, "tool", 30)}_12345678`;

const SEPARATED = [
    "",
    "_",
    "____",
    "-",
    "---",
    " . ",
    "a",
    "Search",
    "search_documents",
    "Search Documents",
    "get-file.contents",
    "__lead",
    "trail__",
    "__both__",
    "a__b___c",
    "a--b..c  d",
    "_-_-_",
    "-a-",
    "ÁÉÍ",
    "日本語",
    "tool/with/slashes",
    "UPPER_and_lower",
    "emoji 😀 name",
    "x".repeat(29) + "_" + "y".repeat(10),
    "x".repeat(40),
    "_".repeat(300) + "ok",
    "ok" + "_".repeat(300),
    "ok" + "!".repeat(300) + "fine",
    "a".repeat(TOOL_NAME_PART_INPUT_MAX_CHARS),
    "!".repeat(TOOL_NAME_PART_INPUT_MAX_CHARS - 1) + "a",
];

describe("the name of a remote tool turned into a safe name", () => {
    it("is what the former expressions gave for every input up to the cut", () => {
        for (const name of SEPARATED) {
            for (const tool of SEPARATED) {
                expect(openaiToolName(connector(name), tool), JSON.stringify([name, tool])).toBe(oldOpenaiToolName(name, tool));
            }
        }
    });
    it("cuts a long value before it is cleaned", () => {
        // Past the cut the rest is not read: only separators in the part that is kept count.
        const longSeparators = "_".repeat(TOOL_NAME_PART_INPUT_MAX_CHARS) + "tail";
        expect(openaiToolName(connector("c"), longSeparators)).toBe("mcp_c_tool_12345678");
        expect(openaiToolName(connector("c"), "!".repeat(TOOL_NAME_PART_INPUT_MAX_CHARS) + "tail")).toBe("mcp_c_tool_12345678");
        expect(openaiToolName(connector("c"), "tool_" + "z".repeat(5_000))).toBe(`mcp_c_tool_${"z".repeat(25)}_12345678`);
    });
    it("takes time proportional to the length of the value", () => {
        for (const make of [
            (n: number) => "_".repeat(n) + "a",
            (n: number) => "a" + "_".repeat(n) + "a",
            (n: number) => "_".repeat(n) + "a_",
            (n: number) => "a" + "_".repeat(n) + "!",
            (n: number) => "_a".repeat(n) + "!",
            (n: number) => "!".repeat(n),
        ]) {
            expectLinearCost((n) => openaiToolName(connector("c"), make(n)), { small: 1_000, large: 32_000 });
        }
    }, 30_000);
});

describe("a hostname without its root dots", () => {
    const old = (hostname: string) => hostname.toLowerCase().replace(/\.+$/, "");
    const HOSTS = ["", ".", "...", "localhost", "localhost.", "LocalHost..", "a.b.c", "a..b", "a.b.", ".a", "..a..", "metadata.google.internal.", "例え.jp."];
    it("is what the former expression gave", () => {
        for (const hostname of HOSTS) expect(canonicalHostname({ hostname } as URL), hostname).toBe(old(hostname));
    });
    it("takes time proportional to its length", () => {
        expectLinearCost((n) => canonicalHostname({ hostname: ".a".repeat(n) + "." } as URL), { small: 1_000, large: 32_000 });
        expectLinearCost((n) => canonicalHostname({ hostname: ".".repeat(n) + "a" } as URL), { small: 1_000, large: 32_000 });
    }, 30_000);
});

describe("trimming trailing characters of a url or an encoded value", () => {
    const TEXTS = ["", "/", "///", "a", "a/", "a//", "/a", "/a/", "https://x.test/", "https://x.test//", "https://x.test/path", "https://x.test/a/b///", "//a//b//", "=", "==", "a=", "a==", "=a=", "a=b==", "a b/ "];
    it("matches the former expressions for slashes and padding", () => {
        for (const text of TEXTS) {
            expect(trimChars(text, "", "/"), text).toBe(text.replace(/\/+$/, ""));
            expect(trimChars(text, "", "="), text).toBe(text.replace(/=+$/g, ""));
            expect(trimChars(text, "", "."), text).toBe(text.replace(/\.+$/, ""));
        }
    });
    it("gives the unpadded url-safe form of base64", () => {
        const oldBase64Url = (buffer: Buffer) => buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
        for (const bytes of [[], [0], [251], [255, 255], [250, 251, 252], [0, 1, 2, 3], [63, 62, 61, 60, 59]]) {
            expect(base64Url(Buffer.from(bytes))).toBe(oldBase64Url(Buffer.from(bytes)));
        }
        const random = Buffer.from(Array.from({ length: 33 }, (_, i) => (i * 37 + 11) % 256));
        expect(base64Url(random)).toBe(oldBase64Url(random));
    });
    it("takes time proportional to the length of the text", () => {
        expectLinearCost((n) => trimChars("/".repeat(n) + "a", "", "/", Infinity), { small: 1_000, large: 32_000 });
        expectLinearCost((n) => trimChars("a" + "/".repeat(n) + "b", "", "/", Infinity), { small: 1_000, large: 32_000 });
    }, 30_000);
});
