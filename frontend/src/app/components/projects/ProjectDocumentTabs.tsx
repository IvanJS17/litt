"use client";

import { useTranslations } from "next-intl";
import { isTrainingHeld, TRAINING_HELD_LABEL_KEY } from "@mike/ui";
import { SvgAssetIcon } from "@/app/components/ui/svg-asset-icon";
import caseLaw from "../../../../public/icons/legal-sources/case-law.svg";
import legislation from "../../../../public/icons/legal-sources/legislation.svg";
import { DocumentTabBar } from "@/app/components/shared/DocumentTabBar";
import type { Document, PanelDocument } from "@/app/components/shared/types";
import type { TabDropPosition } from "@/app/lib/reorderTabs";
import type { DocumentPermissions } from "@/app/hooks/useDocumentPermissions";
import { conversionTargetsFor } from "@/app/lib/documentConversion";
import type { DocumentConversionType } from "@mike/contracts";

interface Props {
    tabs: ReadonlyArray<{
        documentId: string;
        filename: string;
        sourceDocument?: PanelDocument;
    }>;
    documents: ReadonlyArray<Document>;
    activeTabId: string | null;
    onActivate: (documentId: string) => void;
    onAddToChat?: (document: Document) => void;
    onDownloadDoc?: (document: Document) => Promise<void>;
    onRenameDoc?: (documentId: string, filename: string) => Promise<void>;
    onDeleteDoc?: (documentId: string) => Promise<void>;
    /** Starts the conversion dialog; the tab offers only the formats valid for its type. */
    onConvertDoc?: (document: Document, target: DocumentConversionType) => void;
    documentPermissions?: (documentId: string) => DocumentPermissions;
    addToChatDisabled?: boolean;
    downloading?: boolean;
    onClose: (documentId: string) => void;
    onReorder: (
        draggedId: string,
        targetId: string,
        position: TabDropPosition,
    ) => void;
}

export function ProjectDocumentTabs({
    tabs,
    documents,
    activeTabId,
    onActivate,
    onAddToChat,
    onDownloadDoc,
    onRenameDoc,
    onDeleteDoc,
    onConvertDoc,
    documentPermissions,
    addToChatDisabled,
    downloading,
    onClose,
    onReorder,
}: Props) {
    const t = useTranslations();
    return (
        <DocumentTabBar
            label={t("projects.projectDocuments")}
            idPrefix="project-document"
            className="project-document-tabs"
            tabs={tabs.map((tab) => {
                const document = documents.find(
                    (document) => document.id === tab.documentId,
                );
                const sourceType = tab.sourceDocument?.type;
                const legalSource =
                    sourceType === "case" || sourceType === "legislation";
                return {
                    icon: legalSource ? (
                        <SvgAssetIcon
                            src={
                                sourceType === "case"
                                    ? caseLaw
                                    : legislation
                            }
                            aria-hidden="true"
                            width={14}
                            height={14}
                            className="h-3.5 w-3.5 shrink-0 object-contain"
                        />
                    ) : undefined,
                    id: tab.documentId,
                    title: tab.filename,
                    versionNumber:
                        tab.sourceDocument?.version_number ??
                        document?.active_version_number ??
                        document?.latest_version_number,
                    note: isTrainingHeld(document) ? t(TRAINING_HELD_LABEL_KEY) : undefined,
                    actions: {
                        onAddToChat:
                            document && onAddToChat
                                ? () => onAddToChat(document)
                                : undefined,
                        onDownload:
                            document && onDownloadDoc && !isTrainingHeld(document)
                                ? () => onDownloadDoc(document)
                                : undefined,
                        convert:
                            document &&
                            onConvertDoc &&
                            !legalSource &&
                            !isTrainingHeld(document) &&
                            conversionTargetsFor(document.file_type).length > 0
                                ? {
                                      targets: conversionTargetsFor(document.file_type),
                                      onConvert: (target) => onConvertDoc(document, target),
                                  }
                                : undefined,
                        onRename:
                            !legalSource && documentPermissions?.(tab.documentId).canEdit && onRenameDoc
                                ? (name: string) =>
                                      onRenameDoc(tab.documentId, name)
                                : undefined,
                        onDelete:
                            !legalSource && documentPermissions?.(tab.documentId).canDelete && onDeleteDoc
                                ? () => onDeleteDoc(tab.documentId)
                                : undefined,
                        addToChatDisabled,
                        downloading,
                    },
                };
            })}
            activeTabId={activeTabId}
            onActivate={onActivate}
            onClose={onClose}
            onReorder={onReorder}
        />
    );
}
