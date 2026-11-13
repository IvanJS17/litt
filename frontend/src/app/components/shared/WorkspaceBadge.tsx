"use client";

import { useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";
import {
    PERSONAL_WORKSPACE,
    useWorkspace,
    type WorkspaceChoice,
} from "@/app/contexts/WorkspaceContext";
import { Building2, User } from "lucide-react";
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
 * their own or the other way round. Plain text with an icon, not a pill: the
 * words carry the meaning. A firm's name is drawn in ink after a quiet
 * "Firm:", wraps when it is long instead of being cut, and is left out
 * (`showName={false}`) where the screen already shows it, like under the
 * sidebar's heading. Shows nothing outside a workspace, or while the name of
 * a remembered firm is still loading (naming the wrong one is worse).
 */
export function WorkspaceBadge({
    className,
    showName = true,
}: {
    className?: string;
    showName?: boolean;
}) {
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
    const Icon = firm ? Building2 : User;
    return (
        <p
            data-slot="workspace-badge"
            data-workspace={firm ? "firm" : "personal"}
            className={cn(
                "flex max-w-full items-start gap-1.5 text-xs text-gray-500",
                className,
            )}
        >
            <Icon aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">
                {!firm ? (
                    t("shared.appSidebar.personalWorkspace")
                ) : showName ? (
                    <>
                        {t("shared.workspaceBadge.firmLabel")}{" "}
                        <span className="text-gray-900">
                            {activeOrganization?.name}
                        </span>
                    </>
                ) : (
                    t("shared.workspaceBadge.firm")
                )}
            </span>
        </p>
    );
}
