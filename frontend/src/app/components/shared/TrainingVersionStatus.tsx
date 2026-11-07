"use client";

import { useState } from "react";
import { approveTrainingVersion } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { TextButtonUI } from "@/shared/ui/TextButtonUI";
import { TrainingHeldNoteUI } from "@mike/ui";

export const APPROVE_TRAINING_VERSION_LABEL = "Aprobar esta versión";

/**
 * LiTT training (docs/training.md): the mark of a pasante's draft and, for
 * whoever the server says may approve it, the button that approves the
 * version as it is now. Renders nothing for a version that may leave.
 */
export function TrainingVersionStatus({
    documentId,
    versionId,
    held,
    canApprove,
    onApproved,
    className,
}: {
    documentId: string;
    versionId: string | null;
    held: boolean;
    canApprove: boolean;
    onApproved: () => void;
    className?: string;
}) {
    const [approving, setApproving] = useState(false);
    if (!held) return null;

    // The button is disabled while approving, so one click sends one request.
    const approve = async (id: string) => {
        setApproving(true);
        try {
            await approveTrainingVersion(documentId, id);
            onApproved();
        } catch (error) {
            notifyError(error, {
                action: "approve this version",
                supportNote: `Document ${documentId}, version ${id}`,
            });
        } finally {
            setApproving(false);
        }
    };

    return (
        <div className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 ${className ?? ""}`}>
            <TrainingHeldNoteUI />
            {canApprove && versionId && (
                <TextButtonUI
                    size="xs"
                    aria-label={APPROVE_TRAINING_VERSION_LABEL}
                    loading={approving}
                    onClick={() => void approve(versionId)}
                    className="text-foreground"
                >
                    {APPROVE_TRAINING_VERSION_LABEL}
                </TextButtonUI>
            )}
        </div>
    );
}
