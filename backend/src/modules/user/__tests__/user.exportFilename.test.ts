import { describe, expect, it } from "vitest";
import { userExportFilename } from "../user.dataExport";

// LiTT: download names carry the product brand; storage keys and signing
// contexts keep their internal identifiers.
describe("userExportFilename", () => {
    it.each(["account", "chats", "tabular-reviews"] as const)(
        "names the %s export with the LiTT brand",
        (kind) => {
            const name = userExportFilename(kind, "0123456789abcdef");
            expect(name).toMatch(
                new RegExp(`^litt-${kind}-export-01234567-[0-9TZ-]+\\.json$`),
            );
        },
    );
});
