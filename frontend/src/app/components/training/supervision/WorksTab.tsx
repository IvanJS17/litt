"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    approveTrainingVersion,
    generateWorkReview,
    getPupilWorks,
    markWorkReviewed,
    type TrainingPupilWork,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { ReviewLines, type ApproveVersion } from "./SupervisionDetails";
import {
    CardsSkeleton,
    CredentialSelect,
    LoadFailed,
    useCredentialChoice,
    useSupervisionData,
} from "./supervisionShared";

// Panel del mentor → Trabajos: the two-minute review of each piece of work.

export function WorksTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.works");
    const tc = useTranslations("common");
    const load = useCallback(() => getPupilWorks(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    const choice = useCredentialChoice(data?.generation);
    const [busy, setBusy] = useState<string | null>(null);
    // A held draft the mentor is about to approve, and those approved here.
    const [approving, setApproving] = useState<{ documentId: string; versionId: string } | null>(null);
    const [approveBusy, setApproveBusy] = useState(false);
    const [approved, setApproved] = useState<ReadonlySet<string>>(new Set());
    const cancelApprove = useCallback(() => setApproving(null), []);

    const codeMessages = {
        training_review_in_progress: t("codes.inProgress"),
        chat_route_credential_unavailable: t("codes.credentialUnavailable"),
        training_review_key_required: t("codes.keyRequired"),
    };

    const run = async (work: TrainingPupilWork, action: string, change: () => Promise<unknown>) => {
        setBusy(work.chat_id);
        try {
            await change();
        } catch (error) {
            notifyError(error, { action, operation: "training.manage", codeMessages });
        } finally {
            setBusy(null);
            reload();
        }
    };

    // The existing approval route decides who may approve (the author's
    // current mentor, never the author); a refusal reaches notifyError.
    const approveVersion = async () => {
        const target = approving;
        if (!target) return;
        setApproveBusy(true);
        try {
            await approveTrainingVersion(target.documentId, target.versionId);
            setApproved((current) => new Set(current).add(target.versionId));
            reload();
        } catch (error) {
            notifyError(error, {
                action: t("actions.approve"),
                supportNote: `Document ${target.documentId}, version ${target.versionId}`,
            });
        } finally {
            setApproveBusy(false);
            setApproving(null);
        }
    };
    const approve: ApproveVersion = {
        onApprove: (item) => setApproving({ documentId: item.document_id, versionId: item.ref }),
        approved,
        disabled: busy !== null || approveBusy,
    };

    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data) return <CardsSkeleton />;

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("intro")}</p>
            {!data.generation.available && (
                <p className="text-sm text-gray-700">{t("keyRequired")}</p>
            )}
            <CredentialSelect id={`works-key-${pupilId}`} choice={choice} disabled={busy !== null} />
            {data.works.length === 0 && <p className="text-sm text-gray-500">{t("empty")}</p>}
            {data.works.map((work) => {
                const ref = { surface: work.surface, chatId: work.chat_id };
                const review = work.review;
                const working = busy === work.chat_id;
                return (
                    <GlassCardUI key={`${work.surface}:${work.chat_id}`}>
                        <article className="min-w-0 space-y-3 p-4">
                            <header className="min-w-0 space-y-0.5">
                                <h3 className="break-words text-sm font-medium text-gray-900">
                                    {work.title?.trim() || t("untitled")}
                                </h3>
                                <WorkMeta work={work} />
                            </header>
                            {review ? <ReviewLines review={review} approve={approve} /> : (
                                <p className="text-sm text-gray-500">{t("noReview")}</p>
                            )}
                            {work.has_new_work && review && (
                                <p className="text-sm text-gray-700">{t("newWork")}</p>
                            )}
                            {!!review?.signals?.held_versions && (
                                <p className="text-sm text-gray-700">
                                    {t("heldDrafts", { count: review.signals.held_versions })}
                                </p>
                            )}
                            <div className="flex min-w-0 flex-wrap gap-2">
                                {data.generation.available && review?.status !== "pending" && (
                                    <PillButtonUI
                                        type="button"
                                        tone={review ? "white" : "black"}
                                        size="sm"
                                        disabled={busy !== null || !choice.ready}
                                        loading={working}
                                        onClick={() =>
                                            void run(work, t("actions.generate"), () =>
                                                generateWorkReview(orgId, pupilId, ref, choice.value),
                                            )
                                        }
                                    >
                                        {review ? t("regenerate") : t("generate")}
                                    </PillButtonUI>
                                )}
                                {review?.status === "ready" && !review.reviewed_at && (
                                    <PillButtonUI
                                        type="button"
                                        tone="black"
                                        size="sm"
                                        disabled={busy !== null}
                                        onClick={() =>
                                            void run(work, t("actions.markReviewed"), () =>
                                                markWorkReviewed(orgId, pupilId, ref),
                                            )
                                        }
                                    >
                                        {t("markReviewed")}
                                    </PillButtonUI>
                                )}
                            </div>
                        </article>
                    </GlassCardUI>
                );
            })}
            <ConfirmPopup
                open={approving !== null}
                title={t("approveTitle")}
                message={t("approveMessage")}
                confirmLabel={t("approve")}
                cancelLabel={tc("cancel")}
                confirmStatus={approveBusy ? "loading" : "idle"}
                onCancel={cancelApprove}
                onConfirm={() => void approveVersion()}
            />
            {data.works_without_access > 0 && (
                <p className="text-sm text-gray-500">
                    {t("withoutAccess", { count: data.works_without_access })}
                </p>
            )}
        </div>
    );
}

function WorkMeta({ work }: { work: TrainingPupilWork }) {
    const t = useTranslations("training");
    return (
        <p className="break-words text-sm text-gray-500">
            {t("works.meta", {
                surface: t(`surface.${work.surface}`),
                notes: work.notes,
                date: new Date(work.last_note_at),
            })}
        </p>
    );
}
