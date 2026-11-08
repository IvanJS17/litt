"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { answerRetake, getMyCriterion, MikeApiError, startRetake, type TrainingMapTopic } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    CredentialSelect,
    LoadFailed,
    useCredentialChoice,
    useSupervisionData,
} from "../supervision/supervisionShared";
import {
    Block,
    CalibrationList,
    HintsLine,
    MapSkeleton,
    RetakeEntry,
    TopicList,
    useRetakeCodeMessages,
} from "./mapShared";

// Ajustes → Formación → Mi formación → «Mi criterio» (docs/training.md, «Own
// map, calibration and retake»): where the person's answers have matched the
// AI's, by topic, how often their own confidence matched, the hints they
// asked for, and the retakes. Only they and their current mentor read it.
// Counts of their own events: no score, percentage or comparison. A retake is
// made when they ask for it, on their own key.

/** The server's limits for the answer of a retake. */
const ANSWER_MIN_CHARS = 60;
const ANSWER_MAX_CHARS = 4000;

export function MyCriterion({ orgId }: { orgId: string }) {
    const t = useTranslations("training.criterion.map");
    const codeMessages = useRetakeCodeMessages();
    const load = useCallback(() => getMyCriterion(orgId), [orgId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.read",
    });
    const choice = useCredentialChoice(data?.generation);
    const [busy, setBusy] = useState(false);
    const [answer, setAnswer] = useState("");
    // Set when the key the question was made on is gone: only then does the
    // person pick another to judge the answer.
    const [pickKey, setPickKey] = useState(false);
    const titleId = `my-criterion-${orgId}`;

    const start = async (topic: TrainingMapTopic) => {
        setBusy(true);
        try {
            await startRetake(orgId, topic.key, choice.value);
        } catch (error) {
            notifyError(error, { action: t("actions.start"), operation: "training.read", codeMessages });
        } finally {
            setBusy(false);
            reload();
        }
    };

    const send = async (retakeId: string) => {
        setBusy(true);
        try {
            await answerRetake(retakeId, answer.trim(), pickKey ? choice.value : null);
            setAnswer("");
            setPickKey(false);
        } catch (error) {
            if (error instanceof MikeApiError && error.code === "chat_route_credential_unavailable") setPickKey(true);
            notifyError(error, { action: t("actions.answer"), operation: "training.read", codeMessages });
        } finally {
            setBusy(false);
            reload();
        }
    };

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={titleId}>
            <div className="space-y-0.5">
                <h3 id={titleId} className="text-sm font-medium text-gray-900">
                    {t("title")}
                </h3>
                <p className="text-sm text-gray-500">{t("intro")}</p>
            </div>
            {failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <MapSkeleton />
            ) : (
                <div className="min-w-0 space-y-5">
                    <Block title={t("topics.title")}>
                        <TopicList
                            topics={data.map.topics}
                            action={(topic) =>
                                topic.retake_due && data.generation.available && !data.open_retake_id ? (
                                    <div className="flex min-w-0 flex-wrap items-center gap-2 pt-1">
                                        <CredentialSelect
                                            id={`retake-key-${orgId}-${topic.key}`}
                                            choice={choice}
                                            disabled={busy}
                                        />
                                        <PillButtonUI
                                            type="button"
                                            tone="black"
                                            size="sm"
                                            loading={busy}
                                            disabled={busy || !choice.ready}
                                            aria-label={t("retakes.startName", { topic: topic.label })}
                                            onClick={() => void start(topic)}
                                        >
                                            {t("retakes.start")}
                                        </PillButtonUI>
                                    </div>
                                ) : null
                            }
                        />
                        {data.map.topics.some((topic) => topic.retake_due) && !data.generation.available && (
                            <p className="text-sm text-gray-500">{t("codes.keyRequired")}</p>
                        )}
                    </Block>
                    <Block title={t("calibration.title")}>
                        <p className="text-sm text-gray-500">{t("calibration.intro")}</p>
                        <CalibrationList calibration={data.calibration} />
                    </Block>
                    <Block title={t("hints.title")}>
                        <HintsLine requested={data.hints.requested} maxLevel={data.hints.max_level} mentor={false} />
                    </Block>
                    <Block title={t("retakes.title")}>
                        {data.retakes.length === 0 ? (
                            <p className="text-sm text-gray-500">{t("retakes.none")}</p>
                        ) : (
                            <ul className="min-w-0 space-y-3" aria-live="polite">
                                {data.retakes.map((retake) => (
                                    <RetakeEntry key={retake.id} retake={retake}>
                                        {retake.status === "pending" && (
                                            <div className="flex min-w-0 flex-wrap items-center gap-3">
                                                <p className="text-sm text-gray-500">{t("retakes.generating")}</p>
                                                <PillButtonUI type="button" tone="white" size="sm" onClick={reload}>
                                                    {t("retakes.refresh")}
                                                </PillButtonUI>
                                            </div>
                                        )}
                                        {retake.status === "open" && (
                                            <AnswerForm
                                                id={retake.id}
                                                value={answer}
                                                busy={busy}
                                                onChange={setAnswer}
                                                onSend={() => void send(retake.id)}
                                                keyPicker={
                                                    pickKey ? (
                                                        <CredentialSelect
                                                            id={`retake-answer-key-${retake.id}`}
                                                            choice={choice}
                                                            disabled={busy}
                                                        />
                                                    ) : null
                                                }
                                                canSend={!pickKey || choice.ready}
                                            />
                                        )}
                                    </RetakeEntry>
                                ))}
                            </ul>
                        )}
                    </Block>
                </div>
            )}
        </section>
    );
}

function AnswerForm({
    id,
    value,
    busy,
    onChange,
    onSend,
    keyPicker,
    canSend,
}: {
    id: string;
    value: string;
    busy: boolean;
    onChange: (value: string) => void;
    onSend: () => void;
    keyPicker: React.ReactNode;
    canSend: boolean;
}) {
    const t = useTranslations("training.criterion.map.retakes");
    const length = value.trim().length;
    const tooShort = length < ANSWER_MIN_CHARS;
    const helpId = `retake-answer-help-${id}`;
    return (
        <div className="min-w-0 space-y-2">
            <textarea
                aria-label={t("answerLabel")}
                aria-describedby={helpId}
                placeholder={t("answerLabel")}
                value={value}
                maxLength={ANSWER_MAX_CHARS}
                disabled={busy}
                onChange={(event) => onChange(event.target.value)}
                className="min-h-28 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
            />
            <p id={helpId} className="text-xs text-gray-500">
                {tooShort ? t("tooShort", { length, min: ANSWER_MIN_CHARS }) : t("count", { length, max: ANSWER_MAX_CHARS })}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                {keyPicker}
                <PillButtonUI
                    type="button"
                    tone="black"
                    size="sm"
                    loading={busy}
                    disabled={busy || tooShort || !canSend}
                    onClick={onSend}
                >
                    {t("send")}
                </PillButtonUI>
            </div>
            <p className="text-xs text-gray-500">{t("once")}</p>
        </div>
    );
}
