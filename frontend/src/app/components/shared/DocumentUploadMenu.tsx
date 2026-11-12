"use client";

import { Cloud, FolderUp, Upload } from "lucide-react";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownTrigger,
    HeaderButtonUI,
    TabPillButtonUI,
} from "@mike/ui";
import { useTranslations } from "next-intl";

interface DocumentUploadMenuProps {
    onSavedFiles?: (() => void) | null;
    onUploadFiles: (() => void) | null;
    onUploadFolder?: (() => void) | null;
    disabled?: boolean;
    toolbar?: boolean;
}

export function DocumentUploadMenu({
    onSavedFiles,
    onUploadFiles,
    onUploadFolder,
    disabled = false,
    toolbar = false,
}: DocumentUploadMenuProps) {
    const t = useTranslations();
    const TriggerButton = toolbar ? TabPillButtonUI : HeaderButtonUI;
    const triggerDisabled =
        disabled || (!onSavedFiles && !onUploadFiles && !onUploadFolder);

    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <TriggerButton
                    disabled={triggerDisabled}
                    title={t("shared.documentUploadMenu.upload")}
                    aria-label={t("shared.documentUploadMenu.upload")}
                    {...(toolbar ? { className: "pl-2" } : { iconOnly: true })}
                >
                    <Upload aria-hidden="true" className="h-3.5 w-3.5" />
                    {toolbar && t("shared.documentUploadMenu.upload")}
                </TriggerButton>
            </DropdownTrigger>
            <DropdownContent
                align="end"
                className="min-w-40 p-1"
            >
                {onSavedFiles !== undefined && (
                    <DropdownItem
                        disabled={disabled || !onSavedFiles}
                        onSelect={() => onSavedFiles?.()}
                        className="flex items-center px-3 py-2"
                    >
                        <Cloud className="mr-2 h-3.5 w-3.5" />
                        {t("shared.documentUploadMenu.savedDocuments")}
                    </DropdownItem>
                )}
                <DropdownItem
                    disabled={disabled || !onUploadFiles}
                    onSelect={() => onUploadFiles?.()}
                    className="flex items-center px-3 py-2"
                >
                    <Upload className="mr-2 h-3.5 w-3.5" />
                    {t("shared.documentUploadMenu.uploadDocuments")}
                </DropdownItem>
                {onUploadFolder !== undefined && (
                    <DropdownItem
                        disabled={disabled || !onUploadFolder}
                        onSelect={() => onUploadFolder?.()}
                        className="flex items-center px-3 py-2"
                    >
                        <FolderUp className="mr-2 h-3.5 w-3.5" />
                        {t("shared.documentUploadMenu.uploadFolder")}
                    </DropdownItem>
                )}
            </DropdownContent>
        </Dropdown>
    );
}
