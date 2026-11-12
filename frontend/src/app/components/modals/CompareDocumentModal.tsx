"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { DocumentCompareResult } from "@mike/contracts";
import { compareDocuments } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { Modal } from "./Modal";

export interface CompareRequest {
    /** The original: the document whose menu was used. */
    documentId: string;
    filename: string;
}

export interface CompareCandidate {
    id: string;
    filename: string;
}

interface Props {
    /** The comparison being offered; null keeps the dialog closed. */
    request: CompareRequest | null;
    /** Other Word files of the same project, already filtered by the caller. */
    candidates: ReadonlyArray<CompareCandidate>;
    onClose: () => void;
    /** The new document exists. */
    onCompared: (result: DocumentCompareResult) => void;
}

/**
 * Pick the negotiated Word file to compare with, read what will happen, and
 * confirm. Nothing is created until the person confirms.
 */
export function CompareDocumentModal({ request, candidates, onClose, onCompared }: Props) {
    return request ? (
        <CompareDocumentDialog
            key={request.documentId}
            request={request}
            candidates={candidates}
            onClose={onClose}
            onCompared={onCompared}
        />
    ) : null;
}

function CompareDocumentDialog({
    request,
    candidates,
    onClose,
    onCompared,
}: Props & { request: CompareRequest }) {
    const t = useTranslations();
    const { documentId, filename } = request;
    const [selected, setSelected] = useState<string | null>(null);
    const [comparing, setComparing] = useState(false);
    const closed = useRef(false);

    useEffect(() => {
        closed.current = false;
        return () => {
            closed.current = true;
        };
    }, []);

    async function compare() {
        if (!selected || comparing) return;
        setComparing(true);
        try {
            const result = await compareDocuments(documentId, selected);
            if (!closed.current) onCompared(result);
        } catch (error) {
            if (closed.current) return;
            setComparing(false);
            notifyError(error, {
                action: t("documents.compare.actionCompare"),
                onRetry: compare,
            });
        }
    }

    return (
        <Modal
            open
            onClose={() => {
                if (!comparing) onClose();
            }}
            size="sm"
            className="h-auto"
            breadcrumbs={[t("documents.compare.title")]}
            cancelAction={{
                label: t("modals.cancel"),
                onClick: onClose,
                disabled: comparing,
            }}
            primaryAction={{
                label: comparing
                    ? t("documents.compare.comparing")
                    : t("documents.compare.compareAndCreate"),
                onClick: () => void compare(),
                disabled: !selected || comparing,
            }}
        >
            <div className="space-y-4 text-sm text-gray-700">
                <p className="[overflow-wrap:anywhere]">
                    {t("documents.compare.heading", { filename })}
                </p>
                {candidates.length === 0 ? (
                    <p role="status" className="text-xs text-gray-500">
                        {t("documents.compare.noCandidates")}
                    </p>
                ) : (
                    <fieldset disabled={comparing}>
                        <legend className="mb-1 text-xs font-medium text-gray-900">
                            {t("documents.compare.pickLegend")}
                        </legend>
                        <div
                            role="radiogroup"
                            aria-label={t("documents.compare.pickLegend")}
                            className="max-h-56 space-y-1 overflow-y-auto"
                        >
                            {candidates.map((candidate) => (
                                <label
                                    key={candidate.id}
                                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-xs hover:bg-gray-50"
                                >
                                    <input
                                        type="radio"
                                        name="compare-against"
                                        value={candidate.id}
                                        checked={selected === candidate.id}
                                        onChange={() => setSelected(candidate.id)}
                                    />
                                    <span className="[overflow-wrap:anywhere]">
                                        {candidate.filename}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}
                <ul className="list-disc space-y-1 pl-5 text-xs">
                    <li>{t("documents.compare.notice.newDocument")}</li>
                    <li>{t("documents.compare.notice.moves")}</li>
                </ul>
                <p className="text-xs font-medium text-gray-900">
                    {t("documents.compare.originalsUnchanged")}
                </p>
            </div>
        </Modal>
    );
}
