import { describe, expect, it } from "vitest";
import esMX from "../messages/es-MX.json";

// One name for each thing in the Spanish interface (GLOSSARY.md): the firm is
// a «despacho» and the keys are «Mis llaves» and «Llaves del despacho». The
// legal texts and the managed-account notice are not interface wording and
// keep theirs.
type Tree = { [key: string]: string | Tree };

const EXEMPT = ["managedAccount.", "legal."];
// Aliases for search only: people may still type the old words.
const SEARCH_KEYWORDS = /\.keywords$/;
const OLD_NAMES = /organizaci[oó]n|organizaciones|BYOK|llaves propias \(|tus propias llaves/i;

function leaves(tree: Tree, prefix = ""): [string, string][] {
    return Object.entries(tree).flatMap(([key, value]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
    });
}

describe("es-MX vocabulary", () => {
    it("says «despacho» and «Mis llaves», never «organización» or «BYOK»", () => {
        const offenders = leaves(esMX as Tree)
            .filter(([path]) => !EXEMPT.some((p) => path.startsWith(p)) && !SEARCH_KEYWORDS.test(path))
            .filter(([, text]) => OLD_NAMES.test(text))
            .map(([path, text]) => `${path}: ${text}`);
        expect(offenders).toEqual([]);
    });

    it("names the firm's keys «Llaves del despacho», keeping «Mis llaves» for the person's own", () => {
        const org = (esMX as Tree).organizations as Tree;
        for (const section of ["organizationSettingsShell", "organizationProvidersSettings"]) {
            expect((org[section] as Tree).bringYourOwnKeys).toBe("Llaves del despacho");
        }
    });
});
