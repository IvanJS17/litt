"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { TextChange } from "@/app/lib/textDiff";
import type { ChangeGroup } from "@/app/lib/versionCompare";

/**
 * The changes at a glance: in a .md grouped under the nearest `#` title, in
 * Word and PDF text by paragraph number. A click jumps the diff to the change.
 */
export function ChangeList({
    groups,
    byHeading,
    activeIndex,
    onSelect,
}: {
    groups: ChangeGroup[];
    byHeading: boolean;
    activeIndex: number | null;
    onSelect: (change: TextChange) => void;
}) {
    const t = useTranslations("versionCompare");
    return (
        <nav aria-label={t("changeList")} className="min-h-0 space-y-3 text-xs">
            {groups.map((group, groupIndex) => (
                <div key={`${group.heading ?? ""}:${groupIndex}`}>
                    {byHeading && (
                        <h3 className="mb-1 break-words font-medium text-gray-900">
                            {group.heading ?? t("sectionNone")}
                        </h3>
                    )}
                    <ul className="space-y-0.5">
                        {group.changes.map((change) => {
                            const summary = change.summary || t("blankChange");
                            return (
                                <li key={change.index}>
                                    <button
                                        type="button"
                                        onClick={() => onSelect(change)}
                                        aria-current={
                                            activeIndex === change.index ? "true" : undefined
                                        }
                                        aria-label={t("goToChange", {
                                            number: change.index + 1,
                                            summary,
                                        })}
                                        className={cn(
                                            "flex w-full min-w-0 flex-col rounded-md px-2 py-1 text-left text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                                            activeIndex === change.index &&
                                                "bg-gray-100 text-gray-900",
                                        )}
                                    >
                                        {!byHeading && (
                                            <span className="font-medium">
                                                {t("paragraph", { number: change.paragraph })}
                                            </span>
                                        )}
                                        <span className="break-words">{summary}</span>
                                        {change.numeric && (
                                            <span className="text-[11px] text-gray-500">
                                                {t("hasNumbers")}
                                            </span>
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </nav>
    );
}
