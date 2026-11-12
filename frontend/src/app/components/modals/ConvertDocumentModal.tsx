"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type {
    DocumentConversionPreview,
    DocumentConversionResult,
    DocumentConversionType,
} from "@mike/contracts";
import {
    CONVERT_LOSS_KEYS,
    CONVERT_TARGET_KEYS,
    detectedLines,
} from "@/app/lib/documentConversion";
import { convertDocument, previewDocumentConversion } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { Modal } from "./Modal";

export interface ConvertRequest {
    documentId: string;
    filename: string;
    target: DocumentConversionType;
}

interface Props {
    /** The conversion being offered; null keeps the dialog closed. */
    request: ConvertRequest | null;
    onClose: () => void;
    /** The new document exists. The dialog does not close itself: the owner decides. */
    onConverted: (result: DocumentConversionResult) => void;
}

/**
 * The notice before a conversion: what this document would lose, that the
 * original does not change, and the choice to go on. Nothing is created until
 * the person confirms.
 */
export function ConvertDocumentModal({ request, onClose, onConverted }: Props) {
    // Mounted only while a request is open, so each one starts from its own notice.
    return request ? (
        <ConvertDocumentDialog
            key={`${request.documentId}:${request.target}`}
            request={request}
            onClose={onClose}
            onConverted={onConverted}
        />
    ) : null;
}

function ConvertDocumentDialog({
    request,
    onClose,
    onConverted,
}: Props & { request: ConvertRequest }) {
    const t = useTranslations();
    const { documentId, filename, target } = request;
    const [preview, setPreview] = useState<DocumentConversionPreview | null>(null);
    const [converting, setConverting] = useState(false);
    const closed = useRef(false);

    useEffect(() => {
        closed.current = false;
        let current = true;
        // The dialog closes on failure, so there is nothing to retry in place:
        // opening the menu entry again loads the notice again.
        previewDocumentConversion(documentId, target).then(
            (notice) => {
                if (current) setPreview(notice);
            },
            (error) => {
                if (!current) return;
                notifyError(error, {
                    action: t("documents.convert.actionPreview"),
                });
                onClose();
            },
        );
        return () => {
            current = false;
            closed.current = true;
        };
        // The notice belongs to this document and target only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId, target]);

    async function convert() {
        if (!preview || preview.blocked || converting) return;
        setConverting(true);
        try {
            const result = await convertDocument(documentId, target);
            if (!closed.current) onConverted(result);
        } catch (error) {
            if (closed.current) return;
            setConverting(false);
            notifyError(error, {
                action: t("documents.convert.actionConvert"),
                onRetry: convert,
            });
        }
    }

    const lines = preview ? detectedLines(target, preview.detected) : [];
    return (
        <Modal
            open
            onClose={() => {
                if (!converting) onClose();
            }}
            size="sm"
            className="h-auto"
            breadcrumbs={[t("documents.convert.title")]}
            cancelAction={{
                label: t("modals.cancel"),
                onClick: onClose,
                disabled: converting,
            }}
            primaryAction={{
                label: converting
                    ? t("documents.convert.converting")
                    : t("documents.convert.convertAndCreate"),
                onClick: () => void convert(),
                disabled: !preview || !!preview.blocked || converting,
            }}
        >
            <div className="space-y-4 text-sm text-gray-700">
                <p className="[overflow-wrap:anywhere]">
                    {t("documents.convert.heading", {
                        filename,
                        target: t(CONVERT_TARGET_KEYS[target]),
                    })}
                </p>
                {!preview ? (
                    <p
                        role="status"
                        className="flex items-center gap-2 text-xs text-gray-500"
                    >
                        <Loader2
                            aria-hidden="true"
                            className="h-3.5 w-3.5 animate-spin"
                        />
                        {t("documents.convert.checking")}
                    </p>
                ) : (
                    <>
                        {preview.blocked === "pdf_without_text" && (
                            <p role="alert" className="text-red-700">
                                {t("documents.convert.blocked.pdf_without_text")}
                            </p>
                        )}
                        {!preview.blocked && !!preview.textless_page_count && (
                            <p role="alert" className="font-medium text-gray-900">
                                {t("documents.convert.textlessPages", {
                                    count: preview.textless_page_count,
                                })}
                            </p>
                        )}
                        {lines.length > 0 && (
                            <section>
                                <h3 className="mb-1 text-xs font-medium text-gray-900">
                                    {t("documents.convert.detectedTitle")}
                                </h3>
                                <ul className="list-disc space-y-1 pl-5 text-xs">
                                    {lines.map(({ key, count }) => (
                                        <li key={key}>{t(key, { count })}</li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        <section>
                            <h3 className="mb-1 text-xs font-medium text-gray-900">
                                {t("documents.convert.lossesTitle")}
                            </h3>
                            <ul className="list-disc space-y-1 pl-5 text-xs">
                                {preview.losses.map((loss) => (
                                    <li key={loss}>{t(CONVERT_LOSS_KEYS[loss])}</li>
                                ))}
                            </ul>
                        </section>
                        <p className="text-xs text-gray-500 [overflow-wrap:anywhere]">
                            {t("documents.convert.newName", {
                                filename: preview.new_filename,
                            })}
                        </p>
                        <p className="text-xs font-medium text-gray-900">
                            {t("documents.convert.originalUnchanged")}
                        </p>
                    </>
                )}
            </div>
        </Modal>
    );
}
