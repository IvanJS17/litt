"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    assignGymAttempt,
    createGymCase,
    deleteGymCase,
    listGymCases,
    listPupilGymAttempts,
    updateGymCase,
    type TrainingGymCase,
    type TrainingGymCaseBody,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { CardsSkeleton, LoadFailed, usePracticeLabel, useSupervisionData } from "../supervision/supervisionShared";
import { CaseForm } from "./CaseForm";
import { GymNotice, GymResult } from "./gymShared";

// Panel del mentor → Gimnasio (docs/training.md, Layer 4): the mentor's own
// fictitious cases (write, edit, delete, assign) and this pupil's attempts.

export function GymTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training.gym");
    const tc = useTranslations("common");
    const practiceLabel = usePracticeLabel();
    const loadCases = useCallback(() => listGymCases(orgId), [orgId]);
    const loadAttempts = useCallback(
        async () =>
            (await listPupilGymAttempts(orgId, pupilId)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
        [orgId, pupilId],
    );
    const failure = { action: t("mentor.actions.load"), operation: "training.manage" as const };
    const cases = useSupervisionData(loadCases, failure);
    const attempts = useSupervisionData(loadAttempts, failure);
    const [editing, setEditing] = useState<TrainingGymCase | "new" | null>(null);
    const [deleting, setDeleting] = useState<TrainingGymCase | null>(null);
    const [busy, setBusy] = useState(false);

    const run = async (action: string, change: () => Promise<unknown>, after: () => void) => {
        setBusy(true);
        try {
            await change();
            after();
        } catch (error) {
            notifyError(error, {
                action,
                operation: "training.manage",
                codeMessages: { training_gym_attempt_open: t("codes.open") },
            });
        } finally {
            setBusy(false);
        }
    };
    const save = (body: TrainingGymCaseBody) =>
        run(
            t("mentor.actions.save"),
            () => (editing && editing !== "new" ? updateGymCase(orgId, editing.id, body) : createGymCase(orgId, body)),
            () => {
                setEditing(null);
                cases.reload();
            },
        );
    const assign = (caseId: string) =>
        run(t("mentor.actions.assign"), () => assignGymAttempt(orgId, pupilId, caseId), attempts.reload);

    if ((cases.failed && !cases.data) || (attempts.failed && !attempts.data)) {
        return <LoadFailed onRetry={() => (cases.reload(), attempts.reload())} />;
    }
    if (!cases.data || !attempts.data) return <CardsSkeleton rows={2} />;

    const caseList = cases.data;
    // Attempts are newest first: the first one of a case is its latest.
    const latest = new Map<string, (typeof attempts.data)[number]>();
    for (const attempt of attempts.data) if (attempt.case_id && !latest.has(attempt.case_id)) latest.set(attempt.case_id, attempt);

    return (
        <div className="min-w-0 space-y-6">
            <section className="min-w-0 space-y-3" aria-labelledby="gym-cases">
                <h3 id="gym-cases" className="text-sm font-medium text-gray-900">
                    {t("mentor.casesTitle")}
                </h3>
                <p className="break-words text-sm text-gray-500">{t("mentor.casesIntro")}</p>
                <GymNotice />
                {editing ? (
                    <CaseForm
                        key={editing === "new" ? "new" : editing.id}
                        orgId={orgId}
                        existing={editing === "new" ? null : editing}
                        busy={busy}
                        onSave={(body) => void save(body)}
                        onCancel={() => setEditing(null)}
                    />
                ) : (
                    <PillButtonUI type="button" tone="black" size="sm" onClick={() => setEditing("new")}>
                        {t("mentor.newCase")}
                    </PillButtonUI>
                )}
                {cases.data.length === 0 && <p className="text-sm text-gray-500">{t("mentor.noCases")}</p>}
                <ul className="min-w-0 space-y-3">
                    {cases.data.map((item) => {
                        const last = latest.get(item.id);
                        const open = !!last && last.status !== "submitted";
                        return (
                            <li key={item.id} className="min-w-0 space-y-2 rounded-xl border border-gray-100 p-3">
                                <p className="break-words text-sm font-medium text-gray-900">{item.title}</p>
                                <p className="break-words text-sm text-gray-500">
                                    {t("mentor.caseLine", {
                                        practice: practiceLabel(item.practice),
                                        minutes: t("minutes", { count: item.time_limit_minutes }),
                                        errors: t("mentor.errorsCount", { count: item.errors.length }),
                                    })}
                                </p>
                                {open && <p className="text-sm text-gray-500">{t("mentor.assignedOpen")}</p>}
                                <div className="flex min-w-0 flex-wrap gap-2">
                                    <PillButtonUI
                                        type="button"
                                        tone="black"
                                        size="sm"
                                        disabled={busy || open}
                                        aria-label={t("mentor.assignName", { title: item.title })}
                                        onClick={() => void assign(item.id)}
                                    >
                                        {t("mentor.assign")}
                                    </PillButtonUI>
                                    <PillButtonUI
                                        type="button"
                                        tone="white"
                                        size="sm"
                                        aria-label={t("mentor.editName", { title: item.title })}
                                        onClick={() => setEditing(item)}
                                    >
                                        {t("mentor.edit")}
                                    </PillButtonUI>
                                    <PillButtonUI
                                        type="button"
                                        tone="white"
                                        size="sm"
                                        aria-label={t("mentor.deleteName", { title: item.title })}
                                        onClick={() => setDeleting(item)}
                                    >
                                        {t("mentor.delete")}
                                    </PillButtonUI>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </section>
            <section className="min-w-0 space-y-3" aria-labelledby="gym-attempts">
                <h3 id="gym-attempts" className="text-sm font-medium text-gray-900">
                    {t("mentor.attemptsTitle")}
                </h3>
                {attempts.data.length === 0 && <p className="text-sm text-gray-500">{t("mentor.noAttempts")}</p>}
                <ul className="min-w-0 space-y-3">
                    {attempts.data.map((attempt) => {
                        const another =
                            attempt.status === "submitted" &&
                            attempt.case_id !== null &&
                            latest.get(attempt.case_id)?.id === attempt.id &&
                            caseList.some((item) => item.id === attempt.case_id);
                        const status = t(`status.${attempt.status}`);
                        return (
                            <li key={attempt.id} className="min-w-0 space-y-2 rounded-xl border border-gray-100 p-3">
                                <p className="break-words text-sm font-medium text-gray-900">{attempt.title}</p>
                                <p className="break-words text-sm text-gray-700">
                                    {attempt.result && attempt.errors
                                        ? t("mentor.attemptLine", {
                                              status,
                                              found: attempt.result.found.length,
                                              total: attempt.errors.length,
                                              hints: attempt.hints_used,
                                          })
                                        : t("mentor.attemptLineOpen", { status, hints: attempt.hints_used })}
                                </p>
                                {attempt.result && (
                                    <details className="text-sm">
                                        <summary className="cursor-pointer rounded text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                                            {t("mentor.detail")}
                                        </summary>
                                        <div className="pt-2">
                                            <GymResult attempt={attempt} />
                                        </div>
                                    </details>
                                )}
                                {another && (
                                    <PillButtonUI
                                        type="button"
                                        tone="black"
                                        size="sm"
                                        disabled={busy}
                                        aria-label={t("mentor.anotherName", { title: attempt.title })}
                                        onClick={() => void assign(attempt.case_id!)}
                                    >
                                        {t("mentor.another")}
                                    </PillButtonUI>
                                )}
                            </li>
                        );
                    })}
                </ul>
            </section>
            <ConfirmPopup
                open={deleting !== null}
                title={t("mentor.deleteTitle")}
                message={t("mentor.deleteMessage")}
                confirmLabel={t("mentor.delete")}
                confirmVariant="danger"
                cancelLabel={tc("cancel")}
                confirmDisabled={busy}
                onCancel={() => setDeleting(null)}
                onConfirm={() => {
                    const target = deleting;
                    setDeleting(null);
                    if (target)
                        void run(t("mentor.actions.delete"), () => deleteGymCase(orgId, target.id), cases.reload);
                }}
            />
        </div>
    );
}
