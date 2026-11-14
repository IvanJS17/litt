/**
 * The map of Settings: the one place that says which tabs exist, which
 * "home" each belongs to, how they are grouped, where they live and who is
 * offered them. The settings frame, the phone list, the search and the firm's
 * frame all read from here; `settingsMap.test.ts` fails when a page under
 * `settings/**` is not in it. Read `docs/settings-map.md` before changing it.
 *
 * Two homes, and each thing lives in exactly one:
 *
 * - `personal`: "Ajustes", what is mine (account, how I work, my keys, my
 *   training, my firms, platform administration for platform admins).
 * - `firm`: "Ajustes del despacho", what the firm decides (its profile,
 *   members, keys, scan reading, training, audit, privacy and data).
 *
 * Titles and help texts are catalog keys (`settings.map.*`), written to the
 * rules in `docs/i18n.md` ("Writing the text of Settings").
 */

import type { SettingsKey } from "@/i18n/Translate";

export type SettingsHome = "personal" | "firm";

/** Who is offered a tab. The server still decides every change. */
export type SettingsAudience =
    /** Everyone who is signed in. */
    | "everyone"
    /** Hidden when the active firm lets members neither export nor delete. */
    | "memberDataActions"
    /** Platform administrators. */
    | "platformAdmin"
    /** Any member of the firm. */
    | "firmMember"
    /** The firm's owners and administrators. */
    | "firmAdmin"
    /** The firm's owners. */
    | "firmOwner";

/** The icons of the Settings signals (see `SettingsText.tsx`). */
export type SettingsSignalIconName =
    | "lock"
    | "firm"
    | "user"
    | "shield"
    | "alert"
    | "receipt"
    | "info"
    | "send"
    | "clock";

/** A label of who a tab applies to, drawn under the tab's help text. */
export interface SettingsAudienceKey {
    icon: SettingsSignalIconName;
    key: SettingsKey;
}

export type SettingsGroupId =
    | "account"
    | "work"
    | "keys"
    | "training"
    | "firms"
    | "platform"
    | "firmGeneral"
    | "firmKeys"
    | "firmControl";

export interface SettingsGroupDef {
    id: SettingsGroupId;
    home: SettingsHome;
    titleKey: SettingsKey;
}

export interface SettingsTabDef {
    id: string;
    home: SettingsHome;
    group: SettingsGroupId;
    /** Route pattern. A firm's tabs use `:orgId`. */
    path: string;
    /** Pages that belong to the tab and are not tabs themselves (detail pages). */
    subpaths?: readonly string[];
    audience: SettingsAudience;
    /** The name of the tab, sentence case. */
    titleKey: SettingsKey;
    /** One or two short lines: what it is for, what it changes, who it applies to. */
    helpKey: SettingsKey;
    /**
     * Who the tab applies to, as labels. The help text says what the tab is
     * for and what it changes; who sees it and who changes it is here.
     */
    audienceKeys?: readonly SettingsAudienceKey[];
}

/** Groups in the order they are listed, personal home first. */
export const SETTINGS_GROUPS: readonly SettingsGroupDef[] = [
    { id: "account", home: "personal", titleKey: "settings.map.group.account" },
    { id: "work", home: "personal", titleKey: "settings.map.group.work" },
    { id: "keys", home: "personal", titleKey: "settings.map.group.keys" },
    { id: "training", home: "personal", titleKey: "settings.map.group.training" },
    { id: "firms", home: "personal", titleKey: "settings.map.group.firms" },
    { id: "platform", home: "personal", titleKey: "settings.map.group.platform" },
    { id: "firmGeneral", home: "firm", titleKey: "settings.map.group.firmGeneral" },
    { id: "firmKeys", home: "firm", titleKey: "settings.map.group.firmKeys" },
    { id: "firmControl", home: "firm", titleKey: "settings.map.group.firmControl" },
];

const FIRM_ROOT = "/organizations/:orgId/settings";

/** Tabs in the order they are listed, grouped. */
export const SETTINGS_TABS: readonly SettingsTabDef[] = [
    // ---- Ajustes · Mi cuenta
    {
        id: "account",
        home: "personal",
        group: "account",
        path: "/settings",
        audience: "everyone",
        titleKey: "settings.map.tab.account.title",
        helpKey: "settings.map.tab.account.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "security",
        home: "personal",
        group: "account",
        path: "/settings/security",
        audience: "everyone",
        titleKey: "settings.map.tab.security.title",
        helpKey: "settings.map.tab.security.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "privacy-data",
        home: "personal",
        group: "account",
        path: "/settings/privacy-data",
        audience: "memberDataActions",
        titleKey: "settings.map.tab.privacyData.title",
        helpKey: "settings.map.tab.privacyData.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "my-activity",
        home: "personal",
        group: "account",
        path: "/settings/my-activity",
        audience: "everyone",
        titleKey: "settings.map.tab.myActivity.title",
        helpKey: "settings.map.tab.myActivity.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    // ---- Ajustes · Mi forma de trabajar
    {
        id: "personalisation",
        home: "personal",
        group: "work",
        path: "/settings/personalisation",
        audience: "everyone",
        titleKey: "settings.map.tab.personalisation.title",
        helpKey: "settings.map.tab.personalisation.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "memory",
        home: "personal",
        group: "work",
        path: "/settings/memory",
        audience: "everyone",
        titleKey: "settings.map.tab.memory.title",
        helpKey: "settings.map.tab.memory.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "appearance",
        home: "personal",
        group: "work",
        path: "/settings/appearance",
        audience: "everyone",
        titleKey: "settings.map.tab.appearance.title",
        helpKey: "settings.map.tab.appearance.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "assistant",
        home: "personal",
        group: "work",
        path: "/settings/assistant",
        audience: "everyone",
        titleKey: "settings.map.tab.assistant.title",
        helpKey: "settings.map.tab.assistant.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "models",
        home: "personal",
        group: "work",
        path: "/settings/models",
        audience: "everyone",
        titleKey: "settings.map.tab.models.title",
        helpKey: "settings.map.tab.models.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    // ---- Ajustes · Mis llaves y servicios
    {
        id: "byok",
        home: "personal",
        group: "keys",
        path: "/settings/byok",
        audience: "everyone",
        titleKey: "settings.map.tab.byok.title",
        helpKey: "settings.map.tab.byok.help",
    },
    {
        id: "web-search",
        home: "personal",
        group: "keys",
        path: "/settings/web-search",
        audience: "everyone",
        titleKey: "settings.map.tab.webSearch.title",
        helpKey: "settings.map.tab.webSearch.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    {
        id: "scan-reading",
        home: "personal",
        group: "keys",
        path: "/settings/scan-reading",
        audience: "everyone",
        titleKey: "settings.map.tab.scanReading.title",
        helpKey: "settings.map.tab.scanReading.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.yourSpace" },
        ],
    },
    {
        id: "connectors",
        home: "personal",
        group: "keys",
        path: "/settings/connectors",
        audience: "everyone",
        titleKey: "settings.map.tab.connectors.title",
        helpKey: "settings.map.tab.connectors.help",
        audienceKeys: [
            { icon: "user", key: "settings.signals.onlyYou" },
        ],
    },
    // ---- Ajustes · Mi formación (a mentor's pupils and panel sit inside it)
    {
        id: "training",
        home: "personal",
        group: "training",
        path: "/settings/training",
        subpaths: [
            "/settings/training/mentor",
            "/settings/training/contrast",
            "/settings/training/reading/:readingId",
        ],
        audience: "everyone",
        titleKey: "settings.map.tab.training.title",
        helpKey: "settings.map.tab.training.help",
    },
    // ---- Ajustes · Mis despachos
    {
        id: "organizations",
        home: "personal",
        group: "firms",
        path: "/settings/organizations",
        audience: "everyone",
        titleKey: "settings.map.tab.organizations.title",
        helpKey: "settings.map.tab.organizations.help",
    },
    // ---- Ajustes · Administración de la plataforma
    {
        id: "beta-invitations",
        home: "personal",
        group: "platform",
        path: "/settings/beta-invitations",
        audience: "platformAdmin",
        titleKey: "settings.map.tab.betaInvitations.title",
        helpKey: "settings.map.tab.betaInvitations.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.platformAdmins" },
        ],
    },
    {
        id: "beta-stats",
        home: "personal",
        group: "platform",
        path: "/settings/beta-stats",
        audience: "platformAdmin",
        titleKey: "settings.map.tab.betaStats.title",
        helpKey: "settings.map.tab.betaStats.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.platformAdmins" },
        ],
    },
    // ---- Ajustes del despacho · <nombre>
    {
        id: "general",
        home: "firm",
        group: "firmGeneral",
        path: FIRM_ROOT,
        audience: "firmMember",
        titleKey: "settings.map.firmTab.general.title",
        helpKey: "settings.map.firmTab.general.help",
        audienceKeys: [
            { icon: "firm", key: "settings.signals.allMembersSee" },
            { icon: "lock", key: "settings.signals.adminsChange" },
        ],
    },
    {
        id: "members",
        home: "firm",
        group: "firmGeneral",
        path: `${FIRM_ROOT}/members`,
        audience: "firmMember",
        titleKey: "settings.map.firmTab.members.title",
        helpKey: "settings.map.firmTab.members.help",
        audienceKeys: [
            { icon: "firm", key: "settings.signals.allMembersSee" },
            { icon: "lock", key: "settings.signals.adminsChange" },
        ],
    },
    {
        id: "providers",
        home: "firm",
        group: "firmKeys",
        path: `${FIRM_ROOT}/providers`,
        audience: "firmAdmin",
        titleKey: "settings.map.firmTab.providers.title",
        helpKey: "settings.map.firmTab.providers.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.onlyOwnersAdmins" },
        ],
    },
    {
        id: "scan-reading",
        home: "firm",
        group: "firmKeys",
        path: `${FIRM_ROOT}/scan-reading`,
        audience: "firmAdmin",
        titleKey: "settings.map.firmTab.scanReading.title",
        helpKey: "settings.map.firmTab.scanReading.help",
        audienceKeys: [
            { icon: "firm", key: "settings.signals.firmWide" },
            { icon: "lock", key: "settings.signals.onlyOwnersAdmins" },
        ],
    },
    {
        id: "training",
        home: "firm",
        group: "firmControl",
        path: `${FIRM_ROOT}/training`,
        audience: "firmMember",
        titleKey: "settings.map.firmTab.training.title",
        helpKey: "settings.map.firmTab.training.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.mentorsOwnersAdmins" },
            { icon: "firm", key: "settings.signals.criteriaAllRead" },
        ],
    },
    {
        id: "audit",
        home: "firm",
        group: "firmControl",
        path: `${FIRM_ROOT}/audit`,
        audience: "firmAdmin",
        titleKey: "settings.map.firmTab.audit.title",
        helpKey: "settings.map.firmTab.audit.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.onlyOwnersAdmins" },
        ],
    },
    {
        id: "privacy-data",
        home: "firm",
        group: "firmControl",
        path: `${FIRM_ROOT}/privacy-data`,
        audience: "firmOwner",
        titleKey: "settings.map.firmTab.privacyData.title",
        helpKey: "settings.map.firmTab.privacyData.help",
        audienceKeys: [
            { icon: "lock", key: "settings.signals.onlyOwners" },
            { icon: "shield", key: "settings.signals.needsTwoFactor" },
        ],
    },
];

/**
 * Pages under Settings that are not tabs: they only forward to a tab or draw
 * the phone list. Every old address is listed here with where it now goes,
 * so a moved route stays a redirect and nothing else.
 */
export const SETTINGS_REDIRECTS: readonly {
    from: string;
    to: string;
}[] = [
    { from: "/settings/features", to: "/settings/assistant" },
    // To the active firm's page (the firm's training), or to "Mis despachos".
    { from: "/settings/firm-criteria", to: "/organizations/:orgId/settings/training" },
    { from: "/organizations/:orgId/settings/private-content", to: "/organizations/:orgId/settings/audit" },
];

/** The phone's grouped list. It draws no page of its own. */
export const SETTINGS_PHONE_HOME_PATH = "/settings/menu";

/** Pages that are not tabs: the phone home and the redirects. */
export function settingsNonTabPaths(): string[] {
    return [SETTINGS_PHONE_HOME_PATH, ...SETTINGS_REDIRECTS.map((redirect) => redirect.from)];
}

export interface SettingsAudienceContext {
    /** Platform administrators see the platform group. */
    platformAdmin: boolean;
    /** The active workspace lets this person export or delete their data. */
    memberDataActions: boolean;
    /** The role in the firm whose settings are open, when the home is `firm`. */
    firmRole: "owner" | "admin" | "member" | null;
}

export function isAudienceVisible(
    audience: SettingsAudience,
    context: SettingsAudienceContext,
): boolean {
    switch (audience) {
        case "everyone":
            return true;
        case "memberDataActions":
            return context.memberDataActions;
        case "platformAdmin":
            return context.platformAdmin;
        case "firmMember":
            return context.firmRole !== null;
        case "firmAdmin":
            return context.firmRole === "owner" || context.firmRole === "admin";
        case "firmOwner":
            return context.firmRole === "owner";
    }
}

export function settingsTabsFor(home: SettingsHome): SettingsTabDef[] {
    return SETTINGS_TABS.filter((tab) => tab.home === home);
}

export function visibleSettingsTabs(
    home: SettingsHome,
    context: SettingsAudienceContext,
): SettingsTabDef[] {
    return settingsTabsFor(home).filter((tab) => isAudienceVisible(tab.audience, context));
}

export function settingsGroupsFor(home: SettingsHome): SettingsGroupDef[] {
    return SETTINGS_GROUPS.filter((group) => group.home === home);
}

/** A tab's address, with a firm's id put in place of `:orgId`. */
export function settingsTabHref(tab: SettingsTabDef, orgId?: string): string {
    return orgId === undefined ? tab.path : tab.path.replace(":orgId", encodeURIComponent(orgId));
}

/** The address of a firm's settings tab ("general" is the root). */
export function firmSettingsHref(orgId: string, id = "general"): string {
    return settingsTabHref(firmTab(id), orgId);
}

/** The tab of the personal home with this id; throws for an id not in the map. */
export function personalTab(id: string): SettingsTabDef {
    const tab = SETTINGS_TABS.find((candidate) => candidate.home === "personal" && candidate.id === id);
    if (!tab) throw new Error(`Unknown personal settings tab: ${id}`);
    return tab;
}

export function firmTab(id: string): SettingsTabDef {
    const tab = SETTINGS_TABS.find((candidate) => candidate.home === "firm" && candidate.id === id);
    if (!tab) throw new Error(`Unknown firm settings tab: ${id}`);
    return tab;
}

/** The tab whose page `pathname` is, or one of its detail pages (null if none). */
export function tabForPath(
    home: SettingsHome,
    pathname: string,
): SettingsTabDef | null {
    const matches = (pattern: string) =>
        new RegExp(
            `^${pattern.replace(/:\w+/g, "[^/]+").replace(/\/$/, "")}/?$`,
        ).test(pathname);
    for (const tab of settingsTabsFor(home))
        if (matches(tab.path) || tab.subpaths?.some(matches)) return tab;
    return null;
}
