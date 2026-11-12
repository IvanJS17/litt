"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { DocumentCompareResult } from "@mike/contracts";
import { isTrainingHeld } from "@mike/ui";
import {
    CompareDocumentModal,
    type CompareRequest,
} from "@/app/components/modals/CompareDocumentModal";
import { showToast } from "@/app/components/ui/toast";
import { compareCandidates } from "@/app/lib/documentCompare";

type ListedDocument = {
    id: string;
    filename: string;
    file_type?: string | null;
    training_held?: boolean;
};

/**
 * Starts "Compare with…" from a document menu and owns its dialog. `documents`
 * is the project's list the picker draws from; when the new document exists
 * `onCompared` refreshes whatever lists it and may open it.
 */
export function useCompareDocument({
    documents,
    onCompared,
}: {
    documents: ReadonlyArray<ListedDocument>;
    onCompared: (result: DocumentCompareResult) => void | Promise<void>;
}): {
    start: (doc: { id: string; filename: string }) => void;
    modal: ReactNode;
} {
    const t = useTranslations();
    const [request, setRequest] = useState<CompareRequest | null>(null);
    const start = useCallback(
        (doc: { id: string; filename: string }) =>
            setRequest({ documentId: doc.id, filename: doc.filename }),
        [],
    );
    const candidates = request
        ? compareCandidates(documents, request.documentId, isTrainingHeld)
        : [];
    const modal = (
        <CompareDocumentModal
            request={request}
            candidates={candidates}
            onClose={() => setRequest(null)}
            onCompared={(result) => {
                setRequest(null);
                showToast({
                    tone: "success",
                    message: t("documents.compare.created", { filename: result.filename }),
                });
                void onCompared(result);
            }}
        />
    );
    return { start, modal };
}
