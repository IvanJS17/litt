"use client";

import { useTranslations } from "next-intl";
import { TextButtonUI } from "@mike/ui";
import type {
    TrainingDefense,
    TrainingReviewItem,
    TrainingWorkReview,
} from "@/app/lib/mikeApi";

// What the mentor and the pupil both see of a review and of a defense: the
// same component on both sides, so neither sees more than the other.

/** What the mentor's panel adds to a held-draft line: approving it in place. */
export interface ApproveVersion {
    /** Opens the confirmation for this line's document and version. */
    onApprove: (item: TrainingReviewItem & { document_id: string; ref: string }) => void;
    /** Versions approved from this panel since the review was generated. */
    approved: ReadonlySet<string>;
    disabled: boolean;
}

function ReviewRow({
    label,
    items,
    approve,
}: {
    label: string;
    items: TrainingReviewItem[] | null;
    approve?: ApproveVersion;
}) {
    const t = useTranslations("training.review");
    return (
        <div className="min-w-0 space-y-1">
            <dt className="text-sm font-medium text-gray-900">{label}</dt>
            <dd className="min-w-0">
                {items && items.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                        {items.map((item, index) => (
                            <li key={`${item.ref ?? ""}-${index}`} className="break-words">
                                {item.text}
                                {item.source === "inferred" && (
                                    <span className="text-gray-500"> ({t("inferred")})</span>
                                )}
                                {approve && item.source === "version" && item.document_id && item.ref && (
                                    <ApproveLine
                                        item={{ ...item, document_id: item.document_id, ref: item.ref }}
                                        approve={approve}
                                    />
                                )}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-gray-500">{t("none")}</p>
                )}
            </dd>
        </div>
    );
}

function ApproveLine({
    item,
    approve,
}: {
    item: TrainingReviewItem & { document_id: string; ref: string };
    approve: ApproveVersion;
}) {
    const t = useTranslations("training.review");
    if (approve.approved.has(item.ref))
        return <span className="text-gray-500"> · {t("approved")}</span>;
    return (
        <>
            {" "}
            <TextButtonUI
                size="xs"
                aria-label={t("approveName", { text: item.text })}
                disabled={approve.disabled}
                onClick={() => approve.onApprove(item)}
                className="text-foreground"
            >
                {t("approve")}
            </TextButtonUI>
        </>
    );
}

/**
 * A review's four rows, or its generation state. With `approve` (the
 * mentor's panel only) a held draft's line can be approved in place.
 */
export function ReviewLines({
    review,
    approve,
}: {
    review: TrainingWorkReview;
    approve?: ApproveVersion;
}) {
    const t = useTranslations("training.review");
    if (review.status === "pending") return <p className="text-sm text-gray-500">{t("pending")}</p>;
    if (review.status === "failed") return <p className="text-sm text-gray-500">{t("failed")}</p>;
    return (
        <div className="space-y-3">
            <dl className="grid min-w-0 gap-3">
                <ReviewRow label={t("proposed")} items={review.proposed} />
                <ReviewRow label={t("aiCorrected")} items={review.ai_corrected} />
                <ReviewRow label={t("doubts")} items={review.doubts} />
                <ReviewRow label={t("unverified")} items={review.unverified} approve={approve} />
            </dl>
            <div className="space-y-0.5 text-sm text-gray-500">
                {review.generated_at && (
                    <p className="break-words">
                        {t("generatedWith", {
                            model: review.model ?? "",
                            date: new Date(review.generated_at),
                        })}
                    </p>
                )}
                <p>
                    {review.reviewed_at
                        ? t("reviewedOn", { date: new Date(review.reviewed_at) })
                        : t("notReviewed")}
                </p>
            </div>
        </div>
    );
}

/** A defense's questions (when there are) and its outcome (once recorded). */
export function DefenseDetails({ defense }: { defense: TrainingDefense }) {
    const t = useTranslations("training.defenses");
    return (
        <div className="space-y-3">
            {defense.outcome && defense.held_at && (
                <p className="break-words text-sm font-medium text-gray-900">
                    {t("result", {
                        outcome: t(`outcome.${defense.outcome}`),
                        date: new Date(defense.held_at),
                        reason: defense.outcome_reason ? t(`reason.${defense.outcome_reason}`) : "",
                    })}
                </p>
            )}
            {defense.outcome_note && (
                <p className="whitespace-pre-wrap break-words text-sm text-gray-700">
                    {defense.outcome_note}
                </p>
            )}
            {defense.questions && defense.questions.length > 0 && (
                <ol className="space-y-3">
                    {defense.questions.map((question, index) => (
                        <li key={index} className="min-w-0 space-y-1">
                            <p className="text-sm text-gray-500">
                                {t("question", { number: index + 1 })}
                                {question.kind === "cambio_de_hechos" && <> · {t("changeOfFacts")}</>}
                            </p>
                            <p className="break-words text-sm text-gray-900">{question.text}</p>
                            <p className="break-words text-sm text-gray-500">
                                {t("listenFor", { text: question.listen_for })}
                            </p>
                        </li>
                    ))}
                </ol>
            )}
        </div>
    );
}
