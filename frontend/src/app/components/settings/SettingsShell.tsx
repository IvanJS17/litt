"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { settingsTabButtonClassName } from "@/app/(pages)/settings/settingsStyles";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";

export interface SettingsShellTab {
    id: string;
    label: string;
    href: string;
    badge?: ReactNode;
}

/**
 * The frame every settings area shares: a serif title, the sections down the
 * side (across the top when the page is narrow) and the open section beside
 * them. A person's settings and an organization's use the same one, so the
 * two read as the same kind of place.
 *
 * `rootHref` is the area's first section, whose path is a prefix of every
 * other's: it is the open one only on an exact match.
 */
export function SettingsShell({
    title,
    navLabel,
    tabs,
    rootHref,
    search,
    children,
}: {
    title: ReactNode;
    /** The navigation's accessible name. */
    navLabel: string;
    tabs: SettingsShellTab[];
    rootHref: string;
    /** A search box drawn at the right end of the title row, when the area has one. */
    search?: ReactNode;
    children: ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();

    return (
        <div className="flex h-full flex-col overflow-y-auto">
            <header className="mx-auto flex min-h-16 w-full max-w-5xl shrink-0 flex-wrap items-end justify-between gap-x-4 gap-y-3 px-6 pb-2 md:h-24 md:flex-nowrap md:pb-4">
                <h1 className="shrink-0 text-3xl font-medium font-eb-garamond">
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
                <div className="grid grid-cols-1 gap-y-6 @min-[52rem]/settings:grid-cols-[224px_minmax(0,1fr)] @min-[52rem]/settings:gap-x-10">
                    <nav
                        aria-label={navLabel}
                        className="z-10 -ml-3 min-w-0 self-start @min-[52rem]/settings:sticky @min-[52rem]/settings:top-4"
                    >
                        <div className="-m-1 min-w-0 p-1">
                            <div className="-m-1 min-w-0 overflow-x-auto overflow-y-hidden p-1">
                                <ul className="mb-0 flex gap-1 @min-[52rem]/settings:flex-col">
                                    {tabs.map((tab) => {
                                        const active =
                                            pathname === tab.href ||
                                            (tab.href !== rootHref &&
                                                pathname.startsWith(tab.href));
                                        return (
                                            <li key={tab.id}>
                                                <button
                                                    type="button"
                                                    aria-current={
                                                        active
                                                            ? "page"
                                                            : undefined
                                                    }
                                                    onClick={() =>
                                                        router.push(tab.href)
                                                    }
                                                    className={settingsTabButtonClassName(
                                                        active,
                                                    )}
                                                >
                                                    {tab.label}
                                                    {tab.badge ? <> {tab.badge}</> : null}
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </div>
                        </div>
                    </nav>

                    <div className="min-w-0 outline-none">{children}</div>
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
export function SettingsShellSkeleton() {
    const t = useTranslations();
    return (
        <div
            role="status"
            aria-label={t("shared.appShellSkeleton.loading")}
            data-slot="settings-shell-skeleton"
            className="flex h-full flex-col overflow-y-auto"
        >
            <header className="mx-auto flex min-h-16 w-full max-w-5xl shrink-0 items-end px-6 pb-2 md:h-24 md:pb-4">
                <SkeletonLine className="h-8 w-40" />
            </header>
            <div className="@container/settings mx-auto w-full max-w-5xl flex-1 px-6 pb-10 pt-4 md:pt-6">
                <div className="grid grid-cols-1 gap-y-6 @min-[52rem]/settings:grid-cols-[224px_minmax(0,1fr)] @min-[52rem]/settings:gap-x-10">
                    <ul className="flex gap-3 overflow-hidden @min-[52rem]/settings:flex-col @min-[52rem]/settings:gap-0">
                        {SKELETON_TAB_WIDTHS.map((width, index) => (
                            <li key={index} className="flex h-9 shrink-0 items-center px-3">
                                <SkeletonLine className={width} />
                            </li>
                        ))}
                    </ul>
                    <div className="space-y-4">
                        {SKELETON_CONTENT_WIDTHS.map((width, index) => (
                            <SkeletonLine key={index} className={width} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
