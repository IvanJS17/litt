"use client";

import { useCallback, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
    DocumentConversionResult,
    DocumentConversionType,
} from "@mike/contracts";
import {
    ConvertDocumentModal,
    type ConvertRequest,
} from "@/app/components/modals/ConvertDocumentModal";
import { showToast } from "@/app/components/ui/toast";

/**
 * Starts a conversion from a document menu and owns its notice dialog. The
 * caller renders `modal` once and passes `start` to the menus; when the new
 * document exists `onConverted` refreshes whatever lists it and may open it.
 */
export function useConvertDocument({
    onConverted,
}: {
    onConverted: (result: DocumentConversionResult) => void | Promise<void>;
}): {
    start: (
        doc: { id: string; filename: string },
        target: DocumentConversionType,
    ) => void;
    modal: ReactNode;
} {
    const t = useTranslations();
    const [request, setRequest] = useState<ConvertRequest | null>(null);
    const start = useCallback(
        (doc: { id: string; filename: string }, target: DocumentConversionType) =>
            setRequest({ documentId: doc.id, filename: doc.filename, target }),
        [],
    );
    const modal = (
        <ConvertDocumentModal
            request={request}
            onClose={() => setRequest(null)}
            onConverted={(result) => {
                setRequest(null);
                showToast({
                    tone: "success",
                    message: t("documents.convert.created", { filename: result.filename }),
                });
                void onConverted(result);
            }}
        />
    );
    return { start, modal };
}
