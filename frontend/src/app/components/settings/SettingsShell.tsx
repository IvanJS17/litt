"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { settingsTabButtonClassName } from "@/app/(pages)/settings/settingsStyles";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { SettingsTag, SettingsTagRow } from "@/app/components/settings/SettingsText";
import type { SettingsSignalIconName } from "@/app/lib/settingsMap";
import { cn } from "@/app/lib/utils";
import { TOUCH_TARGET_CLASS } from "@mike/ui";

export interface SettingsShellTab {
    id: string;
    label: string;
    href: string;
    /** What the section is for, what it changes and who it applies to. */
    help?: string;
    /** Who the section applies to, as labels under the help text. */
    audience?: { icon: SettingsSignalIconName; label: string }[];
    badge?: ReactNode;
}

/** Tabs by id, in groups. A tab named in no group is listed last, ungrouped. */
export interface SettingsShellGroup {
    id: string;
    label: string;
    tabIds: string[];
}

/** On a phone, the settings home is a grouped list instead of a strip of tabs. */
export interface SettingsMobileHome {
    /** The route that shows the list. It renders no page of its own. */
    href: string;
    /** The label of the way back from a section ("Settings"). */
    backLabel: string;
}

/**
 * The frame every settings area shares: a serif title, the sections down the
 * side (across the top when the page is narrow) and the open section beside
 * them. A person's settings and an organization's use the same one, so the
 * two read as the same kind of place.
 *
 * The sections sit down the side when the page is at least 820 px wide (a
 * pixel width on purpose: at 125 % text a rem width would turn a laptop into
 * a strip of twenty tabs), and across the top below that.
 *
 * `rootHref` is the area's first section, whose path is a prefix of every
 * other's: it is the open one only on an exact match.
 */
export function SettingsShell({
    title,
    navLabel,
    tabs,
    rootHref,
    groups,
    search,
    banner,
    mobileHome,
    children,
}: {
    title: ReactNode;
    /** The navigation's accessible name. */
    navLabel: string;
    tabs: SettingsShellTab[];
    rootHref: string;
    /**
     * The sections in groups: headings down the side on a desktop, the
     * sections of the phone's list. The groups come from the settings map
     * (`lib/settingsMap.ts`).
     */
    groups?: SettingsShellGroup[];
    /** A search box drawn at the right end of the title row, when the area has one. */
    search?: ReactNode;
    /**
     * Under 768 px: the area opens on a grouped list (like the iPhone's
     * Settings), a tap opens a section with a "← back" button, and the strip
     * of tabs is not drawn. From 768 px up nothing changes.
     */
    mobileHome?: SettingsMobileHome;
    /** One line above the sections, e.g. where the other home is. */
    banner?: ReactNode;
    children: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const onPhoneHome = mobileHome ? pathname === mobileHome.href : false;
    const listed = new Set(groups?.flatMap((group) => group.tabIds));
    // Every tab is in a group; one named in none is listed last, ungrouped.
    const grouped = [
        ...(groups ?? []).map((group) => ({
            ...group,
            tabs: group.tabIds.flatMap((id) => tabs.find((tab) => tab.id === id) ?? []),
        })),
        {
            id: "other",
            label: "",
            tabIds: [] as string[],
            tabs: tabs.filter((tab) => !listed.has(tab.id)),
        },
    ].filter((group) => group.tabs.length > 0);
    // The help belongs to the section's own page, not to its detail pages.
    const activeTab = tabs.find((tab) => pathname === tab.href);

    // The open section is in view on arriving and on changing section: the
    // bar scrolls to it (and the page, if the bar itself is below the fold).
    // Not on every render, so a person who scrolled the bar is left alone.
    const barRef = useRef<HTMLElement>(null);
    useEffect(() => {
        barRef.current
            ?.querySelector('[aria-current="page"]')
            ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [pathname]);

    return (
        // `[container-type:size]` makes this the box the bar's `cqh` height is
        // measured against: the scroll area, not the window (the app frame
        // takes some of the window).
        <div className="flex h-full flex-col overflow-y-auto [container-type:size]">
            {mobileHome && !onPhoneHome ? (
                <div className="mx-auto w-full max-w-5xl shrink-0 px-3 pt-2 md:hidden">
                    <Link
                        href={mobileHome.href}
                        className={cn(
                            "inline-flex items-center gap-0.5 rounded-lg pl-1 pr-3 text-sm font-medium text-gray-700 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                            TOUCH_TARGET_CLASS,
                        )}
                    >
                        <ChevronLeft aria-hidden="true" className="h-5 w-5" />
                        {mobileHome.backLabel}
                    </Link>
                </div>
            ) : null}
            <header
                className={cn(
                    "mx-auto flex min-h-16 w-full max-w-5xl shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-3 px-6 pb-2 md:h-24 md:flex-nowrap md:pb-4",
                    // A section on a phone leads with its back button; the
                    // title and search belong to the list.
                    mobileHome && !onPhoneHome && "max-md:hidden",
                )}
            >
                <h1 className="min-w-0 text-3xl font-serif font-medium [overflow-wrap:anywhere]">
                    {title}
                </h1>
                {/* The search sits at the right end of the heading's row, so the
                    sections and the open page keep their places. */}
                {search ? (
                    // Full width under the title on a phone; at the right end from md up.
                    <div className="relative z-20 w-full min-w-0 md:max-w-[18rem]">
                        {search}
                    </div>
                ) : null}
            </header>

            <main className="@container/settings mx-auto w-full max-w-5xl flex-1 px-6 pb-10 pt-4 md:pt-6">
                {banner ? (
                    <div
                        data-slot="settings-banner"
                        className={cn(
                            "mb-4 text-sm text-gray-600",
                            // A section on a phone leads with its back button.
                            mobileHome && !onPhoneHome && "max-md:hidden",
                        )}
                    >
                        {banner}
                    </div>
                ) : null}
                <div className="grid grid-cols-1 gap-y-6 @min-[820px]/settings:grid-cols-[224px_minmax(0,1fr)] @min-[820px]/settings:gap-x-10">
                    {mobileHome && onPhoneHome ? (
                        <nav
                            aria-label={navLabel}
                            data-slot="settings-phone-list"
                            className="flex flex-col gap-6 md:hidden"
                        >
                            {grouped.map((group) => (
                                <section key={group.id}>
                                    {group.label ? (
                                        <h2 className="px-1 pb-2 font-serif text-[1.1875rem] font-medium leading-tight text-gray-900">
                                            {group.label}
                                        </h2>
                                    ) : null}
                                    <ul className="overflow-hidden rounded-2xl bg-surface-sheet">
                                        {group.tabs.map((tab, index) => (
                                            <li
                                                key={tab.id}
                                                className={
                                                    index > 0
                                                        ? "border-t border-gray-200/70"
                                                        : undefined
                                                }
                                            >
                                                <Link
                                                    href={tab.href}
                                                    className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-gray-900 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                                                >
                                                    <span className="min-w-0">
                                                        {tab.label}
                                                        {tab.badge ? <> {tab.badge}</> : null}
                                                    </span>
                                                    <ChevronRight
                                                        aria-hidden="true"
                                                        className="h-4 w-4 shrink-0 text-gray-400"
                                                    />
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ))}
                        </nav>
                    ) : null}
                    {/* From 820 px the bar stays in view while the open section
                        scrolls: sticky at the top of the scroll area, no taller
                        than it, scrolling by itself when the list does not fit
                        (125 % text, a low laptop). The title row, the search
                        and the line above the bar go up with the content: only
                        the bar needs to be at hand. */}
                    <nav
                        ref={barRef}
                        aria-label={navLabel}
                        data-slot="settings-bar"
                        className={cn(
                            "z-10 -ml-3 min-w-0 self-start",
                            "@min-[820px]/settings:sticky @min-[820px]/settings:top-3 @min-[820px]/settings:-mr-1 @min-[820px]/settings:-ml-4 @min-[820px]/settings:-mt-1 @min-[820px]/settings:max-h-[calc(100cqh-1.5rem)] @min-[820px]/settings:overflow-y-auto @min-[820px]/settings:overscroll-contain @min-[820px]/settings:p-1",
                            mobileHome && "max-md:hidden",
                        )}
                    >
                        <div className="-m-1 min-w-0 p-1">
                            <div className="-m-1 min-w-0 overflow-x-auto overflow-y-hidden p-1">
                                {/* Groups are headings down the side; in the strip
                                    across the top of a narrow page they vanish and
                                    the tabs run on. */}
                                <ul className="mb-0 flex gap-1 @min-[820px]/settings:flex-col @min-[820px]/settings:gap-5">
                                    {grouped.map((group) => (
                                        <li
                                            key={group.id}
                                            className="contents @min-[820px]/settings:block"
                                        >
                                            {group.label ? (
                                                <h2
                                                    id={`settings-group-${group.id}`}
                                                    className="hidden px-3 pb-1.5 font-serif text-[1.0625rem] font-medium leading-tight text-gray-900 @min-[820px]/settings:block"
                                                >
                                                    {group.label}
                                                </h2>
                                            ) : null}
                                            <ul
                                                aria-labelledby={
                                                    group.label ? `settings-group-${group.id}` : undefined
                                                }
                                                className="flex gap-1 @min-[820px]/settings:flex-col"
                                            >
                                                {group.tabs.map((tab) => {
                                                    const active =
                                                        pathname === tab.href ||
                                                        (tab.href !== rootHref &&
                                                            pathname.startsWith(tab.href));
                                                    return (
                                                        <li key={tab.id}>
                                                            <button
                                                                type="button"
                                                                aria-current={active ? "page" : undefined}
                                                                onClick={() => router.push(tab.href)}
                                                                className={settingsTabButtonClassName(active)}
                                                            >
                                                                {tab.label}
                                                                {tab.badge ? <> {tab.badge}</> : null}
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </nav>

                    <div
                        className={cn(
                            "min-w-0 outline-none",
                            mobileHome && onPhoneHome && "max-md:hidden",
                        )}
                    >
                        {activeTab?.help ? (
                            <div className="mb-6 flex max-w-prose flex-col gap-2">
                                <p data-slot="settings-tab-help" className="text-sm text-gray-600">
                                    {activeTab.help}
                                </p>
                                {activeTab.audience?.length ? (
                                    <SettingsTagRow>
                                        {activeTab.audience.map((tag) => (
                                            <SettingsTag key={tag.label} kind="audience" icon={tag.icon}>
                                                {tag.label}
                                            </SettingsTag>
                                        ))}
                                    </SettingsTagRow>
                                ) : null}
                            </div>
                        ) : null}
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}

/** One grey line per section a person usually sees, in its final column. */
const SKELETON_TAB_WIDTHS = [
    "w-16", "w-28", "w-14", "w-24", "w-20", "w-32", "w-24", "w-20", "w-16", "w-28", "w-24", "w-20", "w-28",
];
const SKELETON_CONTENT_WIDTHS = ["w-1/2", "w-full", "w-5/6", "w-2/3", "w-full", "w-3/4"];

/**
 * What the settings areas show while the session loads: the same frame as
 * `SettingsShell` (title row, section column, content column) drawn in grey
 * lines the size of the real text, so the page fills in rather than replacing
 * a spinner. The sidebar around it is the app layout's. Change it with
 * `SettingsShell`.
 */
export function SettingsShellSkeleton({
    insideStatus = false,
}: {
    /** Drawn inside a loading region that already announces itself. */
    insideStatus?: boolean;
}) {
    const t = useTranslations();
    return (
        <div
            {...(insideStatus
                ? {}
                : { role: "status", "aria-label": t("shared.appShellSkeleton.loading") })}
            data-slot="settings-shell-skeleton"
            className="flex h-full flex-col overflow-y-auto"
        >
            <header className="mx-auto flex min-h-16 w-full max-w-5xl shrink-0 items-end px-6 pb-2 md:h-24 md:pb-4">
                <SkeletonLine className="h-8 w-40" />
            </header>
            <div className="@container/settings mx-auto w-full max-w-5xl flex-1 px-6 pb-10 pt-4 md:pt-6">
                <div className="grid grid-cols-1 gap-y-6 @min-[820px]/settings:grid-cols-[224px_minmax(0,1fr)] @min-[820px]/settings:gap-x-10">
                    {/* On a phone the real page is a grouped list (SettingsShell
                        `mobileHome`), not a strip of tabs: draw that. */}
                    <div className="flex flex-col gap-6 md:hidden">
                        {[4, 3, 2].map((rows, group) => (
                            <ul key={group} className="overflow-hidden rounded-2xl bg-surface-sheet">
                                {Array.from({ length: rows }, (_, index) => (
                                    <li
                                        key={index}
                                        className={cn(
                                            "flex min-h-11 items-center px-4 py-2.5",
                                            index > 0 && "border-t border-gray-200/70",
                                        )}
                                    >
                                        <SkeletonLine className={SKELETON_TAB_WIDTHS[(group * 4 + index) % SKELETON_TAB_WIDTHS.length]} />
                                    </li>
                                ))}
                            </ul>
                        ))}
                    </div>
                    <ul className="flex gap-3 overflow-hidden max-md:hidden @min-[820px]/settings:flex-col @min-[820px]/settings:gap-0">
                        {SKELETON_TAB_WIDTHS.map((width, index) => (
                            <li key={index} className="flex h-9 shrink-0 items-center px-3">
                                <SkeletonLine className={width} />
                            </li>
                        ))}
                    </ul>
                    <div className="space-y-4 max-md:hidden">
                        {SKELETON_CONTENT_WIDTHS.map((width, index) => (
                            <SkeletonLine key={index} className={width} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
