"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    acceptPromotion,
    getPupilPromotion,
    type TrainingPromotionProposal,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    CardsSkeleton,
    LoadFailed,
    usePracticeLabel,
    useStageLabel,
    useSupervisionData,
} from "./supervisionShared";

// Panel del mentor → Promoción: LiTT proposes from this pupil's own evidence,
// counted against what is required of them, never against anyone else; the
// mentor accepts (confirmed) and the server recomputes before applying.

export function PromotionTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.promotion");
    const tc = useTranslations("common");
    const stageLabel = useStageLabel();
    const practiceLabel = usePracticeLabel();
    const load = useCallback(() => getPupilPromotion(orgId, pupilId), [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    const [busy, setBusy] = useState(false);
    const [accepting, setAccepting] = useState<TrainingPromotionProposal | null>(null);
    const cancel = useCallback(() => setAccepting(null), []);

    const accept = async (proposal: TrainingPromotionProposal) => {
        setBusy(true);
        try {
            await acceptPromotion(orgId, pupilId, { practice: proposal.practice, to: proposal.to });
        } catch (error) {
            notifyError(error, {
                action: t("actions.accept"),
                operation: "training.manage",
                codeMessages: { training_promotion_not_proposed: t("codes.notProposed") },
            });
        } finally {
            setBusy(false);
            reload();
        }
    };

    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data) return <CardsSkeleton rows={1} />;

    const move = (proposal: TrainingPromotionProposal) => ({
        practice: practiceLabel(proposal.practice),
        from: stageLabel(proposal.from),
        to: stageLabel(proposal.to),
    });

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("intro")}</p>
            {data.proposals.length === 0 && <p className="text-sm text-gray-500">{t("empty")}</p>}
            {data.proposals.map((proposal) => (
                <GlassCardUI key={proposal.practice ?? "__all__"}>
                    <article className="min-w-0 space-y-3 p-4">
                        <h3 className="break-words text-sm font-medium text-gray-900">
                            {t("move", move(proposal))}
                        </h3>
                        <ul className="space-y-0.5 text-sm text-gray-700">
                            <li>
                                {t("defenses", {
                                    count: proposal.approved_defenses.length,
                                    required: proposal.required.approved_defenses,
                                })}
                            </li>
                            <li>
                                {t("works", {
                                    count: proposal.reviewed_works.length,
                                    required: proposal.required.reviewed_works,
                                })}
                            </li>
                            <li>{t("versions", { count: proposal.approved_versions.length })}</li>
                        </ul>
                        {proposal.blocked_by && (
                            <p className="text-sm text-gray-700">{t(`blocked.${proposal.blocked_by}`)}</p>
                        )}
                        <p className="text-sm text-gray-500">{proposal.proposed ? t("proposed") : t("notYet")}</p>
                        {proposal.proposed && (
                            <PillButtonUI
                                type="button"
                                tone="black"
                                size="sm"
                                disabled={busy}
                                onClick={() => setAccepting(proposal)}
                            >
                                {t("accept")}
                            </PillButtonUI>
                        )}
                    </article>
                </GlassCardUI>
            ))}
            <ConfirmPopup
                open={accepting !== null}
                title={t("confirmTitle")}
                message={accepting ? t("confirmMessage", move(accepting)) : null}
                confirmLabel={t("accept")}
                cancelLabel={tc("cancel")}
                confirmDisabled={busy}
                onCancel={cancel}
                onConfirm={() => {
                    const proposal = accepting;
                    setAccepting(null);
                    if (proposal) void accept(proposal);
                }}
            />
        </div>
    );
}
