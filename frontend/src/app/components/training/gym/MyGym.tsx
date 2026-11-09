"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { PillButtonUI } from "@mike/ui";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { FormTextInput } from "@/app/components/ui/form-field";
import {
    askGymHint,
    getMyGymAttempt,
    listMyGymAttempts,
    saveGymFindings,
    startGymAttempt,
    submitGymAttempt,
    type TrainingGymAttempt,
    type TrainingGymErrorKind,
    type TrainingGymFinding,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { CardsSkeleton, LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { GymNotice, GymResult, useGymKindOptions } from "./gymShared";

// Ajustes → Formación → Mi formación → «Gimnasio» (docs/training.md, Layer 4):
// the pupil's attempts at fictitious practice cases. The clock is the
// server's: the browser only shows `deadline_at` against the offset to
// `server_now`, and when it reaches zero it reads the attempt again so the
// server closes it. Until it is submitted the pupil gets no errors at all.

const clock = (ms: number) => {
    const seconds = Math.ceil(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Milliseconds left by the server's clock; null when the attempt is not running. */
function useRemainingMs(attempt: TrainingGymAttempt) {
    const { status, server_now: serverNow, deadline_at: deadlineAt } = attempt;
    const running = status === "in_progress" && deadlineAt !== null;
    const compute = useCallback(
        (offset: number) => Math.max(0, Date.parse(deadlineAt ?? "") - (Date.now() + offset)),
        [deadlineAt],
    );
    const [remaining, setRemaining] = useState<number | null>(() =>
        running ? compute(Date.parse(serverNow) - Date.now()) : null,
    );
    useEffect(() => {
        if (!running) return;
        const offset = Date.parse(serverNow) - Date.now();
        const timer = setInterval(() => setRemaining(compute(offset)), 1000);
        return () => clearInterval(timer);
    }, [running, serverNow, compute]);
    return running ? remaining : null;
}

export function MyGym({ orgId }: { orgId: string }) {
    const t = useTranslations("training.gym");
    const load = useCallback(() => listMyGymAttempts(orgId), [orgId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("pupil.actions.load"),
        operation: "training.read",
    });
    const [open, setOpen] = useState<TrainingGymAttempt | null>(null);
    const [busy, setBusy] = useState(false);
    const titleId = `my-gym-${orgId}`;

    const openAttempt = async (attempt: TrainingGymAttempt) => {
        setBusy(true);
        try {
            setOpen(
                attempt.status === "assigned" ? await startGymAttempt(attempt.id) : await getMyGymAttempt(attempt.id),
            );
        } catch (error) {
            notifyError(error, { action: t("pupil.actions.open"), operation: "training.read" });
            reload();
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={titleId}>
            <div className="space-y-0.5">
                <h3 id={titleId} className="text-sm font-medium text-gray-900">
                    {t("pupil.title")}
                </h3>
                <p className="text-sm text-gray-500">{t("pupil.intro")}</p>
                <GymNotice />
            </div>
            {open ? (
                <GymRun
                    key={open.id}
                    initial={open}
                    onBack={() => {
                        setOpen(null);
                        reload();
                    }}
                />
            ) : failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <CardsSkeleton rows={1} />
            ) : data.length === 0 ? (
                <p className="text-sm text-gray-500">{t("pupil.empty")}</p>
            ) : (
                <ul className="min-w-0 space-y-3">
                    {data.map((attempt) => {
                        const action =
                            attempt.status === "assigned"
                                ? t("pupil.start")
                                : attempt.status === "in_progress"
                                  ? t("pupil.continue")
                                  : t("pupil.viewResult");
                        return (
                            <li key={attempt.id} className="flex min-w-0 flex-wrap items-center gap-3">
                                <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="break-words text-sm text-gray-900">{attempt.title}</p>
                                    <p className="text-sm text-gray-500">
                                        {t(`status.${attempt.status}`)} · {t("minutes", { count: attempt.time_limit_minutes })}
                                    </p>
                                </div>
                                <PillButtonUI
                                    type="button"
                                    tone="black"
                                    size="sm"
                                    disabled={busy}
                                    aria-label={t("pupil.startName", { action, title: attempt.title })}
                                    onClick={() => void openAttempt(attempt)}
                                >
                                    {action}
                                </PillButtonUI>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function GymRun({ initial, onBack }: { initial: TrainingGymAttempt; onBack: () => void }) {
    const t = useTranslations("training.gym");
    const tc = useTranslations("common");
    const kindOptions = useGymKindOptions();
    const [attempt, setAttempt] = useState(initial);
    const [findings, setFindings] = useState(initial.findings);
    const [busy, setBusy] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const remaining = useRemainingMs(attempt);
    const submitted = attempt.status === "submitted";

    const adopt = useCallback((next: TrainingGymAttempt) => {
        setAttempt(next);
        if (next.status === "submitted") setFindings(next.findings);
    }, []);

    // The server closes an expired attempt on any read: ask it, decide nothing here.
    const reread = useCallback(async () => {
        try {
            adopt(await getMyGymAttempt(initial.id));
        } catch (error) {
            notifyError(error, { action: t("pupil.actions.open"), operation: "training.read" });
        }
    }, [adopt, initial.id, t]);

    useEffect(() => {
        if (remaining === 0) void reread();
    }, [remaining, reread]);

    const run = async (action: string, call: () => Promise<TrainingGymAttempt>) => {
        setBusy(true);
        try {
            adopt(await call());
        } catch (error) {
            notifyError(error, {
                action,
                operation: "training.read",
                codeMessages: { training_gym_closed: t("codes.closed"), training_gym_no_hint: t("codes.noHint") },
            });
            void reread();
        } finally {
            setBusy(false);
        }
    };

    const change = (next: TrainingGymFinding[]) => {
        setFindings(next);
        void run(t("pupil.actions.save"), () => saveGymFindings(attempt.id, next));
    };
    const finding = (paragraph: number) => findings.find((item) => item.paragraph === paragraph);
    const edit = (paragraph: number, patch: Partial<TrainingGymFinding>) =>
        findings.map((item) => (item.paragraph === paragraph ? { ...item, ...patch } : item));

    return (
        <div className="min-w-0 space-y-4">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t("pupil.back")}
            </button>
            <h4 className="break-words text-sm font-medium text-gray-900">{attempt.title}</h4>
            {submitted ? (
                <>
                    {initial.status === "in_progress" && <p className="text-sm text-gray-500">{t("pupil.expired")}</p>}
                    <GymResult attempt={attempt} />
                </>
            ) : (
                <>
                    {remaining !== null && (
                        <p role="timer" className="text-sm text-gray-900">
                            {t("pupil.timeLeft", { time: clock(remaining) })}
                        </p>
                    )}
                    <ol className="min-w-0 space-y-3" aria-label={t("pupil.paragraphs")}>
                        {attempt.paragraphs.map((text, index) => {
                            const number = index + 1;
                            const mark = finding(number);
                            return (
                                <li key={number} className="min-w-0 space-y-2 rounded-xl border border-gray-100 p-3">
                                    <p className="break-words text-sm text-gray-700">
                                        <span className="font-medium text-gray-900">{number}.</span> {text}
                                    </p>
                                    <PillButtonUI
                                        type="button"
                                        tone="white"
                                        size="sm"
                                        disabled={busy}
                                        aria-pressed={!!mark}
                                        aria-label={
                                            mark
                                                ? t("pupil.unmarkName", { number })
                                                : t("pupil.markName", { number })
                                        }
                                        onClick={() =>
                                            change(
                                                mark
                                                    ? findings.filter((item) => item.paragraph !== number)
                                                    : [...findings, { paragraph: number, kind: "other", note: "" }],
                                            )
                                        }
                                    >
                                        {mark ? t("pupil.unmark") : t("pupil.mark")}
                                    </PillButtonUI>
                                    {mark && (
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                            <ModalSelect
                                                id={`gym-kind-${attempt.id}-${number}`}
                                                aria-label={t("pupil.kind")}
                                                value={mark.kind}
                                                options={kindOptions}
                                                onChange={(kind) =>
                                                    change(edit(number, { kind: kind as TrainingGymErrorKind }))
                                                }
                                                disabled={busy}
                                                wrapLabels
                                                className="min-w-0 sm:w-56"
                                            />
                                            <FormTextInput
                                                aria-label={t("pupil.noteName", { number })}
                                                placeholder={t("pupil.note")}
                                                maxLength={500}
                                                value={mark.note}
                                                onChange={(event) =>
                                                    setFindings(edit(number, { note: event.target.value }))
                                                }
                                                onBlur={() => change(findings)}
                                                className="min-w-0 flex-1"
                                            />
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ol>
                    {attempt.hints.length > 0 && (
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">{t("pupil.hints")}</p>
                            <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700">
                                {attempt.hints.map((hint, index) => (
                                    <li key={index} className="break-words">
                                        {hint}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <PillButtonUI
                            type="button"
                            tone="white"
                            size="sm"
                            disabled={busy}
                            onClick={() => void run(t("pupil.actions.hint"), () => askGymHint(attempt.id))}
                        >
                            {t("pupil.hint")}
                        </PillButtonUI>
                        <PillButtonUI
                            type="button"
                            tone="black"
                            size="sm"
                            disabled={busy}
                            onClick={() => setConfirming(true)}
                        >
                            {t("pupil.submit")}
                        </PillButtonUI>
                    </div>
                </>
            )}
            <ConfirmPopup
                open={confirming}
                title={t("pupil.confirmTitle")}
                message={t("pupil.confirmMessage")}
                confirmLabel={t("pupil.submit")}
                cancelLabel={tc("cancel")}
                confirmDisabled={busy}
                onCancel={() => setConfirming(false)}
                onConfirm={() => {
                    setConfirming(false);
                    void run(t("pupil.actions.submit"), () => submitGymAttempt(attempt.id));
                }}
            />
        </div>
    );
}
