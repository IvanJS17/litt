"use client";

import { useRef } from "react";
import {
    ClipboardCheck,
    Cloud,
    PlusIcon,
    Upload,
    Waypoints,
} from "lucide-react";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownTrigger,
    COMPOSER_GHOST_BUTTON_CLASS,
    COMPOSER_GHOST_WEB_ICON_CLASS,
    COMPOSER_GHOST_WEB_SIZE_CLASS,
    TOUCH_TARGET_CLASS,
} from "@mike/ui";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";

interface Props {
    onBrowseAll: () => void;
    onLocalFiles: () => void;
    /** Adds the workflow and playbook pickers to the menu. */
    onWorkflows?: () => void;
    onPlaybooks?: () => void;
}

/** The composer's + menu: documents, then workflows and playbooks. */
export function AddDocButton({
    onBrowseAll,
    onLocalFiles,
    onWorkflows,
    onPlaybooks,
}: Props) {
    const t = useTranslations();
    const openingDialog = useRef(false);
    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        TOUCH_TARGET_CLASS,
                        COMPOSER_GHOST_BUTTON_CLASS,
                        COMPOSER_GHOST_WEB_SIZE_CLASS,
                        COMPOSER_GHOST_WEB_ICON_CLASS,
                    )}
                    title={t("assistant.addDocButton.addToMessage")}
                    aria-label={t("assistant.addDocButton.addToMessage")}
                >
                    <PlusIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                </button>
            </DropdownTrigger>
            <DropdownContent
                side="top"
                align="start"
                sideOffset={8}
                collisionPadding={12}
                className="min-w-36"
                onCloseAutoFocus={(event) => {
                    // Let the newly opened picker own focus instead of returning
                    // it to the composer trigger as the menu unmounts.
                    if (openingDialog.current) event.preventDefault();
                    openingDialog.current = false;
                }}
            >
                <DropdownItem onSelect={onLocalFiles}>
                    <Upload aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
                    {t("assistant.addDocButton.uploadDocuments")}
                </DropdownItem>
                <DropdownItem onSelect={() => {
                    openingDialog.current = true;
                    onBrowseAll();
                }}>
                    <Cloud aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
                    {t("assistant.addDocButton.savedDocuments")}
                </DropdownItem>
                {(onWorkflows || onPlaybooks) && <DropdownSeparator />}
                {onWorkflows && (
                    <DropdownItem onSelect={() => {
                        openingDialog.current = true;
                        onWorkflows();
                    }}>
                        <Waypoints aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
                        {t("assistant.addDocButton.workflows")}
                    </DropdownItem>
                )}
                {onPlaybooks && (
                    <DropdownItem onSelect={() => {
                        openingDialog.current = true;
                        onPlaybooks();
                    }}>
                        <ClipboardCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-500" />
                        {t("assistant.addDocButton.playbooks")}
                    </DropdownItem>
                )}
            </DropdownContent>
        </Dropdown>
    );
}
