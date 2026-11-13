"use client";

import { useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";
import {
    PERSONAL_WORKSPACE,
    useWorkspace,
    type WorkspaceChoice,
} from "@/app/contexts/WorkspaceContext";
import { cn } from "@/app/lib/utils";

/** "Firm: Socium" / "My personal workspace": a workspace named in words. */
export function workspaceChoiceLabel(
    t: NsTranslate<"shared">,
    choice: WorkspaceChoice,
): string {
    return choice.id === PERSONAL_WORKSPACE
        ? t("shared.appSidebar.personalWorkspace")
        : t("shared.appSidebar.firmWorkspace", { name: choice.name });
}

/**
 * Always says which workspace is open, so nobody mistakes the firm's work for
 * their own or the other way round. A firm is drawn with the strong ink
 * outline, Personal with the quiet one; the words carry the meaning, the
 * outline only helps the eye. Shows nothing outside a workspace, or while the
 * name of a remembered firm is still loading (naming the wrong one is worse).
 */
export function WorkspaceBadge({ className }: { className?: string }) {
    const t = useTranslations();
    const { workspaceId, activeOrganization, personalWorkspaceDisabled } =
        useWorkspace();
    if (workspaceId === null) return null;
    // A firm-managed account has no personal workspace to name, not even
    // for the moment before its firm has loaded.
    if (personalWorkspaceDisabled && workspaceId === PERSONAL_WORKSPACE) {
        return null;
    }
    const firm = workspaceId !== PERSONAL_WORKSPACE;
    if (firm && !activeOrganization) return null;
    return (
        <p
            data-slot="workspace-badge"
            data-workspace={firm ? "firm" : "personal"}
            className={cn(
                "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs",
                firm
                    ? "border-gray-900 font-semibold text-gray-900"
                    : "border-gray-300 font-medium text-gray-600",
                className,
            )}
        >
            <span className="truncate">
                {workspaceChoiceLabel(t, {
                    id: workspaceId,
                    name: activeOrganization?.name ?? "",
                })}
            </span>
        </p>
    );
}
