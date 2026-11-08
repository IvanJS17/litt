"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { FormTextInput } from "@/app/components/ui/form-field";
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";
import {
    createDefense,
    generateDefenseQuestions,
    getPupilDefenses,
    getPupilWorks,
    recordDefenseOutcome,
    type TrainingDefense,
    type TrainingDefenseOutcome,
    type TrainingDefenseReason,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { DefenseDetails } from "./SupervisionDetails";
import {
    CardsSkeleton,
    CredentialSelect,
    LoadFailed,
    NoteField,
    useCredentialChoice,
    usePracticeLabel,
    useSupervisionData,
} from "./supervisionShared";

// Panel del mentor → Defensa oral: create a defense, generate its five
// questions, and record its outcome once (with a confirmation).

const FROM_WORK = "__work__";
const ALL_PRACTICES = "__all__";
const OTHER_PRACTICE = "__other__";
const NO_WORK = "__none__";
const REASONS: TrainingDefenseReason[] = [
    "razonamiento_solido",
    "razonamiento_incompleto",
    "cambio_de_hechos_no_resuelto",
    "sin_sustento",
    "otro",
];

export function DefensesTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.defenses");
    const load = useCallback(
        async () => {
            const [defenses, works] = await Promise.all([
                getPupilDefenses(orgId, pupilId),
                getPupilWorks(orgId, pupilId),
            ]);
            return { ...defenses, works: works.works };
        },
        [orgId, pupilId],
    );
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    const choice = useCredentialChoice(data?.generation);
    const [busy, setBusy] = useState(false);

    const codeMessages = {
        training_defense_already_recorded: t("codes.alreadyRecorded"),
    };
    const run = async (action: string, change: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await change();
            return true;
        } catch (error) {
            notifyError(error, { action, operation: "training.manage", codeMessages });
            return false;
        } finally {
            setBusy(false);
            reload();
        }
    };

    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data) return <CardsSkeleton />;

    const reviewed = data.works.filter((work) => work.review !== null);
    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("intro")}</p>
            <NewDefense
                id={`defense-new-${pupilId}`}
                works={reviewed.map((work) => ({
                    id: work.review!.id,
                    label: work.title?.trim() || work.chat_id,
                }))}
                disabled={busy}
                onCreate={(body) =>
                    run(t("actions.create"), () => createDefense(orgId, pupilId, body))
                }
            />
            <CredentialSelect id={`defense-key-${pupilId}`} choice={choice} disabled={busy} />
            {data.defenses.length === 0 && <p className="text-sm text-gray-500">{t("empty")}</p>}
            {data.defenses.map((defense) => (
                <DefenseCard
                    key={defense.id}
                    defense={defense}
                    busy={busy}
                    canGenerate={data.generation.available && choice.ready}
                    onGenerate={() =>
                        void run(t("actions.generate"), () =>
                            generateDefenseQuestions(orgId, pupilId, defense.id, choice.value),
                        )
                    }
                    onRecord={(outcome, reason, note) =>
                        run(t("actions.record"), () =>
                            recordDefenseOutcome(orgId, pupilId, defense.id, {
                                outcome,
                                reason,
                                note: note.trim() || null,
                            }),
                        )
                    }
                />
            ))}
        </div>
    );
}

function NewDefense({
    id,
    works,
    disabled,
    onCreate,
}: {
    id: string;
    works: { id: string; label: string }[];
    disabled: boolean;
    onCreate: (body: { practice?: string | null; work_review_id?: string | null }) => Promise<boolean>;
}) {
    const t = useTranslations("training");
    const practiceLabel = usePracticeLabel();
    const [work, setWork] = useState(NO_WORK);
    const [practice, setPractice] = useState(ALL_PRACTICES);
    const [custom, setCustom] = useState("");
    const linked = work !== NO_WORK;
    const effectivePractice = !linked && practice === FROM_WORK ? ALL_PRACTICES : practice;
    const chosen =
        effectivePractice === ALL_PRACTICES
            ? null
            : effectivePractice === OTHER_PRACTICE
              ? custom.trim()
              : effectivePractice;
    const ready = chosen !== "";

    const create = async () => {
        const body =
            effectivePractice === FROM_WORK
                ? { work_review_id: work }
                : { practice: chosen, ...(linked ? { work_review_id: work } : {}) };
        if (await onCreate(body)) {
            setWork(NO_WORK);
            setPractice(ALL_PRACTICES);
            setCustom("");
        }
    };

    return (
        <GlassCardUI>
            <div className="min-w-0 space-y-3 p-4">
                <h3 className="text-sm font-medium text-gray-900">{t("defenses.newTitle")}</h3>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ModalSelect
                        id={`${id}-work`}
                        aria-label={t("defenses.work")}
                        value={work}
                        options={[
                            { value: NO_WORK, label: t("defenses.noWork") },
                            ...works.map((option) => ({ value: option.id, label: option.label })),
                        ]}
                        onChange={(value) => {
                            setWork(value);
                            if (value !== NO_WORK) setPractice(FROM_WORK);
                            else if (practice === FROM_WORK) setPractice(ALL_PRACTICES);
                        }}
                        disabled={disabled}
                        wrapLabels
                        className="min-w-0 flex-1 basis-56"
                    />
                    <ModalSelect
                        id={`${id}-practice`}
                        aria-label={t("defenses.practice")}
                        value={effectivePractice}
                        options={[
                            ...(linked ? [{ value: FROM_WORK, label: t("defenses.practiceFromWork") }] : []),
                            { value: ALL_PRACTICES, label: practiceLabel(null) },
                            ...PRACTICE_OPTIONS.filter((option) => option !== "Other").map((option) => ({
                                value: option.trim().toLowerCase(),
                                label: option,
                            })),
                            { value: OTHER_PRACTICE, label: t("defenses.otherPractice") },
                        ]}
                        onChange={setPractice}
                        disabled={disabled}
                        wrapLabels
                        className="min-w-0 flex-1 basis-56"
                    />
                    {effectivePractice === OTHER_PRACTICE && (
                        <FormTextInput
                            aria-label={t("defenses.practiceName")}
                            value={custom}
                            maxLength={200}
                            onChange={(event) => setCustom(event.target.value)}
                            disabled={disabled}
                            className="min-w-0 flex-1 basis-56"
                        />
                    )}
                    <PillButtonUI
                        type="button"
                        tone="black"
                        size="sm"
                        disabled={disabled || !ready}
                        onClick={() => void create()}
                    >
                        {t("defenses.create")}
                    </PillButtonUI>
                </div>
            </div>
        </GlassCardUI>
    );
}

function DefenseCard({
    defense,
    busy,
    canGenerate,
    onGenerate,
    onRecord,
}: {
    defense: TrainingDefense;
    busy: boolean;
    canGenerate: boolean;
    onGenerate: () => void;
    onRecord: (outcome: TrainingDefenseOutcome, reason: TrainingDefenseReason, note: string) => Promise<boolean>;
}) {
    const t = useTranslations("training");
    const practiceLabel = usePracticeLabel();
    const recorded = defense.outcome !== null;
    const status = defense.questions_status;
    return (
        <GlassCardUI>
            <article className="min-w-0 space-y-3 p-4">
                <header className="min-w-0 space-y-0.5">
                    <h3 className="break-words text-sm font-medium text-gray-900">
                        {practiceLabel(defense.practice)}
                    </h3>
                    <p className="text-sm text-gray-500">
                        {t("defenses.createdOn", { date: new Date(defense.created_at) })}
                    </p>
                </header>
                {!recorded && <p className="text-sm text-gray-500">{t("defenses.scheduled")}</p>}
                {status === "pending" && (
                    <p className="text-sm text-gray-500">{t("defenses.questionsPending")}</p>
                )}
                {status === "failed" && (
                    <p className="text-sm text-gray-500">{t("defenses.questionsFailed")}</p>
                )}
                <DefenseDetails defense={defense} />
                {!recorded && canGenerate && status !== "pending" && status !== "ready" && (
                    <PillButtonUI type="button" tone="white" size="sm" disabled={busy} onClick={onGenerate}>
                        {t("defenses.generateQuestions")}
                    </PillButtonUI>
                )}
                {!recorded && <OutcomeForm id={defense.id} busy={busy} onRecord={onRecord} />}
            </article>
        </GlassCardUI>
    );
}

function OutcomeForm({
    id,
    busy,
    onRecord,
}: {
    id: string;
    busy: boolean;
    onRecord: (outcome: TrainingDefenseOutcome, reason: TrainingDefenseReason, note: string) => Promise<boolean>;
}) {
    const t = useTranslations("training");
    const tc = useTranslations("common");
    const [outcome, setOutcome] = useState<TrainingDefenseOutcome | null>(null);
    const [reason, setReason] = useState<TrainingDefenseReason | "">("");
    const [note, setNote] = useState("");
    const [confirming, setConfirming] = useState(false);
    const ready = outcome !== null && reason !== "";
    const cancel = useCallback(() => setConfirming(false), []);

    return (
        <fieldset className="min-w-0 space-y-3 border-t border-gray-100 pt-3" disabled={busy}>
            <legend className="sr-only">{t("defenses.recordTitle")}</legend>
            <p className="text-sm font-medium text-gray-900" aria-hidden="true">
                {t("defenses.recordTitle")}
            </p>
            <div
                role="radiogroup"
                aria-label={t("defenses.outcomeLabel")}
                className="flex min-w-0 flex-wrap gap-x-4 gap-y-2"
            >
                {(["approved", "not_approved"] as const).map((value) => (
                    <label key={value} className="inline-flex items-center gap-2 text-sm text-gray-900">
                        <input
                            type="radio"
                            name={`outcome-${id}`}
                            value={value}
                            checked={outcome === value}
                            onChange={() => setOutcome(value)}
                            className="h-4 w-4 accent-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        />
                        {t(`defenses.outcome.${value}`)}
                    </label>
                ))}
            </div>
            <ModalSelect
                id={`reason-${id}`}
                aria-label={t("defenses.reasonLabel")}
                value={reason}
                placeholder={t("defenses.chooseReason")}
                options={REASONS.map((value) => ({ value, label: t(`defenses.reason.${value}`) }))}
                onChange={(value) => setReason(value as TrainingDefenseReason)}
                disabled={busy}
                wrapLabels
                className="min-w-0 sm:w-80"
            />
            <NoteField value={note} onChange={setNote} />
            <PillButtonUI
                type="button"
                tone="black"
                size="sm"
                disabled={busy || !ready}
                onClick={() => setConfirming(true)}
            >
                {t("defenses.record")}
            </PillButtonUI>
            <ConfirmPopup
                open={confirming && ready}
                title={t("defenses.confirmTitle")}
                message={
                    outcome && reason
                        ? t("defenses.confirmMessage", {
                              outcome: t(`defenses.outcome.${outcome}`),
                              reason: t(`defenses.reason.${reason}`),
                          })
                        : null
                }
                confirmLabel={t("defenses.record")}
                cancelLabel={tc("cancel")}
                confirmDisabled={busy}
                onCancel={cancel}
                onConfirm={() => {
                    setConfirming(false);
                    if (outcome && reason)
                        void onRecord(outcome, reason, note).then((done) => {
                            if (done) setNote("");
                        });
                }}
            />
        </fieldset>
    );
}
