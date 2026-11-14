// The guard of the settings map (docs/settings-map.md, docs/UPSTREAM_POLICY.md,
// «Settings from upstream»). It fails when:
//
//   - a page exists under `settings/**` or `organizations/[id]/settings/**`
//     that the map does not list (a tab, a detail page of a tab, a redirect or
//     the phone home): upstream added a section, and it has no home, group,
//     name or help text yet;
//   - a tab has no home, no group of its home, no page, a duplicate id, or a
//     title or help text missing from either catalog;
//   - the map names a page that does not exist, or a redirect to nowhere.
//
// To make it pass for new upstream settings, add the tab to the map (home,
// group, name, help text, who is offered it): never loosen this test.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import enUS from "../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../packages/i18n/messages/es-MX.json";
import { SETTINGS_SEARCH_ENTRIES } from "./settingsSearch";
import {
    SETTINGS_GROUPS,
    SETTINGS_PHONE_HOME_PATH,
    SETTINGS_REDIRECTS,
    SETTINGS_TABS,
    settingsGroupsFor,
    settingsNonTabPaths,
    tabForPath,
    visibleSettingsTabs,
    type SettingsHome,
} from "./settingsMap";

const APP = join(__dirname, "..");
const PAGES = join(APP, "(pages)");
const ROOTS = [join(PAGES, "settings"), join(PAGES, "organizations", "[id]", "settings")];

/** Every `page.tsx` under the settings roots, as the URL pattern it serves. */
function settingsPagePatterns(): { file: string; pattern: string }[] {
    const found: { file: string; pattern: string }[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (name === "page.tsx") found.push({ file: path, pattern: patternOf(path) });
        }
    };
    ROOTS.forEach(walk);
    return found;
}

/** `(pages)/organizations/[id]/settings/(sections)/audit/page.tsx` → `/organizations/:p/settings/audit`. */
function patternOf(file: string): string {
    const segments = relative(PAGES, file)
        .split(sep)
        .slice(0, -1)
        .filter((segment) => !/^\(.*\)$/.test(segment))
        .map((segment) => (/^\[.+\]$/.test(segment) ? ":p" : segment));
    return `/${segments.join("/")}`;
}

/** A map path with every parameter name made the same, to compare with a file's. */
const normalise = (path: string) => path.replace(/:\w+/g, ":p");

function get(catalog: unknown, key: string): unknown {
    return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalog);
}

const mapped = new Set([
    ...SETTINGS_TABS.flatMap((tab) => [tab.path, ...(tab.subpaths ?? [])]),
    ...settingsNonTabPaths(),
].map(normalise));

describe("the settings map covers every settings page", () => {
    const pages = settingsPagePatterns();

    it("finds the pages it guards", () => {
        expect(pages.length).toBeGreaterThan(20);
    });

    it.each(pages.map((page) => [page.pattern, page.file] as const))(
        "%s is in the map",
        (pattern, file) => {
            expect(
                mapped.has(pattern),
                `${relative(APP, file)} serves ${pattern}, which the map (lib/settingsMap.ts) does not list. ` +
                    "Give it a home (personal or firm), a group, a name and a help text, or make it a redirect.",
            ).toBe(true);
        },
    );

    it("lists no page that does not exist", () => {
        const served = new Set(pages.map((page) => page.pattern));
        const missing = [...mapped].filter((pattern) => !served.has(pattern));
        expect(missing).toEqual([]);
    });
});

describe("every tab has a home, a group, a name and a help text", () => {
    const groupIds = new Set(SETTINGS_GROUPS.map((group) => group.id));

    it.each(SETTINGS_TABS.map((tab) => [`${tab.home}/${tab.id}`, tab] as const))(
        "%s",
        (_name, tab) => {
            expect(["personal", "firm"]).toContain(tab.home);
            expect(groupIds.has(tab.group)).toBe(true);
            expect(SETTINGS_GROUPS.find((group) => group.id === tab.group)?.home).toBe(tab.home);
            for (const [label, catalog] of [
                ["en-US", enUS],
                ["es-MX", esMX],
            ] as const) {
                for (const key of [tab.titleKey, tab.helpKey]) {
                    const text = get(catalog, key);
                    expect(typeof text === "string" && text.trim().length > 0, `${label} ${key}`).toBe(true);
                }
            }
        },
    );

    it("has each id once per home", () => {
        const ids = SETTINGS_TABS.map((tab) => `${tab.home}/${tab.id}`);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("has each path once", () => {
        const paths = SETTINGS_TABS.map((tab) => normalise(tab.path));
        expect(new Set(paths).size).toBe(paths.length);
    });

    it("keeps every group non-empty and named in both catalogs", () => {
        for (const group of SETTINGS_GROUPS) {
            expect(SETTINGS_TABS.some((tab) => tab.group === group.id), group.id).toBe(true);
            expect(typeof get(enUS, group.titleKey)).toBe("string");
            expect(typeof get(esMX, group.titleKey)).toBe("string");
        }
    });

    it("keeps each help text to a short line or two (160 characters)", () => {
        for (const tab of SETTINGS_TABS) {
            for (const [label, catalog] of [
                ["en-US", enUS],
                ["es-MX", esMX],
            ] as const) {
                const text = get(catalog, tab.helpKey) as string;
                expect(text.length, `${label} ${tab.helpKey}: ${text.length}`).toBeLessThanOrEqual(160);
            }
        }
    });
});

describe("redirects", () => {
    it.each(SETTINGS_REDIRECTS.map((redirect) => [redirect.from, redirect] as const))(
        "%s has a page that forwards, to somewhere in the map",
        (_from, redirect) => {
            const page = settingsPagePatterns().find((candidate) => candidate.pattern === normalise(redirect.from));
            expect(page, `no page serves ${redirect.from}`).toBeDefined();
            expect(redirect.to).not.toBe(redirect.from);
            expect(mapped.has(normalise(redirect.to)), `${redirect.to} is not in the map`).toBe(true);
        },
    );

    it("never redirects from an address that is also a tab", () => {
        const tabPaths = new Set(SETTINGS_TABS.map((tab) => normalise(tab.path)));
        for (const redirect of SETTINGS_REDIRECTS) expect(tabPaths.has(normalise(redirect.from))).toBe(false);
    });

    it("keeps the old Features address pointing at the Assistant", () => {
        const features = SETTINGS_REDIRECTS.find((redirect) => redirect.from === "/settings/features");
        expect(features?.to).toBe("/settings/assistant");
        const page = readFileSync(join(PAGES, "settings", "features", "page.tsx"), "utf8");
        expect(page).toContain('redirect("/settings/assistant")');
    });
});

describe("what reads the map", () => {
    it("keeps the phone home where the shell expects it", () => {
        expect(SETTINGS_PHONE_HOME_PATH).toBe("/settings/menu");
        expect(existsSync(join(PAGES, "settings", "menu", "page.tsx"))).toBe(true);
    });

    it("lists the personal groups for the phone and the desktop alike", () => {
        expect(settingsGroupsFor("personal").map((group) => group.id)).toEqual([
            "account",
            "work",
            "keys",
            "training",
            "firms",
            "platform",
        ]);
    });

    it("searches only tabs that are in the personal map", () => {
        const personal = new Set(SETTINGS_TABS.filter((tab) => tab.home === "personal").map((tab) => tab.id));
        for (const entry of SETTINGS_SEARCH_ENTRIES)
            expect(personal.has(entry.tabId), `${entry.id} → ${entry.tabId}`).toBe(true);
    });

    it("finds the tab of a detail page", () => {
        expect(tabForPath("personal", "/settings/training/mentor")?.id).toBe("training");
        expect(tabForPath("personal", "/settings/training/reading/r1")?.id).toBe("training");
        expect(tabForPath("firm", "/organizations/o1/settings/providers")?.id).toBe("providers");
        expect(tabForPath("firm", "/organizations/o1/settings")?.id).toBe("general");
        expect(tabForPath("personal", "/settings/nope")).toBeNull();
    });

    it("offers each role what the decisions say", () => {
        const ids = (home: SettingsHome, firmRole: "owner" | "admin" | "member" | null, extra = {}) =>
            visibleSettingsTabs(home, { platformAdmin: false, memberDataActions: true, firmRole, ...extra }).map(
                (tab) => tab.id,
            );
        expect(ids("firm", "member")).toEqual(["general", "members", "training"]);
        expect(ids("firm", "admin")).toEqual([
            "general",
            "members",
            "providers",
            "scan-reading",
            "training",
            "audit",
        ]);
        expect(ids("firm", "owner")).toContain("privacy-data");
        expect(ids("personal", null)).not.toContain("beta-stats");
        expect(ids("personal", null, { platformAdmin: true })).toEqual(
            expect.arrayContaining(["beta-invitations", "beta-stats"]),
        );
        expect(ids("personal", null, { memberDataActions: false })).not.toContain("privacy-data");
    });
});
