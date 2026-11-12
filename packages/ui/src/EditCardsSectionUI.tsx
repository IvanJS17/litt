"use client";

import { Children, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "use-intl";

export interface EditCardsSectionUIProps {
    summary: string;
    actions?: ReactNode;
    actionsLabel?: string;
    children: ReactNode;
    className?: string;
    defaultOpen?: boolean;
}

/**
 * Platform-neutral grouped-edit surface. Summary calculation and bulk action
 * behavior belong to the host wrapper; this component owns only presentation
 * and the local expanded/collapsed state.
 */
export function EditCardsSectionUI({
    summary,
    actions,
    actionsLabel,
    children,
    className = "",
    defaultOpen = true,
}: EditCardsSectionUIProps) {
    const t = useTranslations();
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (Children.count(children) === 1) {
        return <>{children}</>;
    }

    return (
        <div className={className}>
            <div className="flex items-center gap-2 px-3 pt-3">
                <p className="min-w-0 flex-1 truncate font-serif text-sm text-gray-700">
                    {summary}
                </p>
                <button
                    type="button"
                    onClick={() => setIsOpen((value) => !value)}
                    aria-label={isOpen ? t("ui.editCardsSection.collapseEdits") : t("ui.editCardsSection.expandEdits")}
                    aria-expanded={isOpen}
                    className="shrink-0 text-gray-500 transition-colors hover:text-gray-700"
                >
                    <ChevronDown
                        aria-hidden="true"
                        className={`relative top-px h-3 w-3 transition-transform duration-200 ${isOpen ? "" : "-rotate-90"}`}
                    />
                </button>
            </div>

            {actions && (
                <div
                    className="flex flex-wrap items-center gap-2 px-3 pt-3"
                    role="group"
                    aria-label={actionsLabel ?? t("ui.editCardsSection.trackedChangeActions")}
                >
                    {actions}
                </div>
            )}

            {isOpen ? (
                <div className="flex flex-col gap-2 px-3 pb-3 pt-3">
                    {children}
                </div>
            ) : (
                <div className="pb-3" />
            )}
        </div>
    );
}
