"use client";

import { useTranslations } from "next-intl";
import { TabPillButtonUI } from "@mike/ui";

/** The one panel a phone shows of the project workspace. */
export type ProjectWorkspaceView = "chat" | "explorer" | "document";

const VIEWS: ProjectWorkspaceView[] = ["chat", "explorer", "document"];

/**
 * Picks which workspace panel a narrow screen shows. The panels sit side by
 * side from the `md` breakpoint up, so this control is only for phones; the
 * caller places it in the mobile header.
 */
export function ProjectWorkspaceViewSwitcher({
    view,
    onChange,
}: {
    view: ProjectWorkspaceView;
    onChange: (view: ProjectWorkspaceView) => void;
}) {
    const t = useTranslations();
    const labels: Record<ProjectWorkspaceView, string> = {
        chat: t("projects.workspace.view.chat"),
        explorer: t("projects.workspace.view.explorer"),
        document: t("projects.workspace.view.document"),
    };

    return (
        <div
            role="group"
            aria-label={t("projects.workspace.view.label")}
            data-slot="workspace-view-switcher"
            className="flex min-w-0 flex-wrap items-center justify-end gap-1.5"
        >
            {VIEWS.map((option) => (
                <TabPillButtonUI
                    key={option}
                    active={view === option}
                    onClick={() => onChange(option)}
                >
                    {labels[option]}
                </TabPillButtonUI>
            ))}
        </div>
    );
}
