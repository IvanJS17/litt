"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    getPupilPasses,
    grantUrgencyPass,
    listProjects,
    revokeUrgencyPass,
    type TrainingUrgencyPass,
    type TrainingUrgencyReason,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import {
    CardsSkeleton,
    LoadFailed,
    NoteField,
    PassState,
    passInForce,
    useSupervisionData,
} from "./supervisionShared";

// Panel del mentor → Pase de urgencia: grant a time-limited pass on one of
// the organization's matters, list the passes, revoke one (confirmed). The
// server checks that both the mentor and the pupil can open the matter.

/** From 30 minutes to the 72-hour ceiling; 8 hours is the default. */
const DURATIONS = [30, 60, 120, 240, 480, 1440, 2880, 4320];
const DEFAULT_DURATION = 480;
const REASONS: TrainingUrgencyReason[] = ["plazo", "audiencia", "cliente_urgente", "otro"];

export function PassesTab({ orgId, pupilId }: { orgId: string; pupilId: string }) {
    const t = useTranslations("training");
    const tc = useTranslations("common");
    const load = useCallback(async () => {
        const [passes, projects] = await Promise.all([
            getPupilPasses(orgId, pupilId),
            listProjects(),
        ]);
        return {
            passes: passes.passes,
            projects: projects
                .filter((project) => project.org_id === orgId)
                .map((project) => ({ id: project.id, name: project.name })),
        };
    }, [orgId, pupilId]);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("passes.actions.load"),
        operation: "training.manage",
    });
    const [busy, setBusy] = useState(false);
    const [revoking, setRevoking] = useState<TrainingUrgencyPass | null>(null);
    const cancelRevoke = useCallback(() => setRevoking(null), []);

    const run = async (action: string, change: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await change();
            return true;
        } catch (error) {
            notifyError(error, {
                action,
                operation: "training.manage",
                codeMessages: {
                    training_pass_duplicate: t("passes.codes.duplicate"),
                    training_pass_limit_reached: t("passes.codes.limit"),
                    training_pass_pupil_no_access: t("passes.codes.pupilNoAccess"),
                    training_pass_invalid: t("passes.codes.invalid"),
                },
            });
            return false;
        } finally {
            setBusy(false);
            reload();
        }
    };

    if (failed && !data) return <LoadFailed onRetry={reload} />;
    if (!data) return <CardsSkeleton />;

    const projectName = (projectId: string) =>
        data.projects.find((project) => project.id === projectId)?.name ?? t("passes.unknownProject");

    return (
        <div className="space-y-4">
            <p className="text-sm text-gray-500">{t("passes.intro")}</p>
            <GrantPass
                id={`pass-new-${pupilId}`}
                projects={data.projects}
                disabled={busy}
                onGrant={(body) =>
                    run(t("passes.actions.grant"), () => grantUrgencyPass(orgId, pupilId, body))
                }
            />
            {data.passes.length === 0 && <p className="text-sm text-gray-500">{t("passes.empty")}</p>}
            {data.passes.length > 0 && (
                <GlassCardUI>
                    <ul className="divide-y divide-gray-100">
                        {data.passes.map((pass) => (
                            <li key={pass.id} className="flex min-w-0 flex-wrap items-start justify-between gap-3 p-4">
                                <div className="min-w-0 space-y-0.5">
                                    <p className="break-words text-sm font-medium text-gray-900">
                                        {projectName(pass.project_id)}
                                    </p>
                                    <p className="text-sm text-gray-700">
                                        <PassState pass={pass} />
                                    </p>
                                    <p className="text-sm text-gray-500">
                                        {t(`passes.reason.${pass.reason_code}`)}
                                    </p>
                                    {pass.reason_note && (
                                        <p className="whitespace-pre-wrap break-words text-sm text-gray-500">
                                            {pass.reason_note}
                                        </p>
                                    )}
                                </div>
                                {passInForce(pass) && (
                                    <PillButtonUI
                                        type="button"
                                        tone="white"
                                        size="sm"
                                        disabled={busy}
                                        aria-label={t("passes.revokeName", { project: projectName(pass.project_id) })}
                                        onClick={() => setRevoking(pass)}
                                    >
                                        {t("passes.revoke")}
                                    </PillButtonUI>
                                )}
                            </li>
                        ))}
                    </ul>
                </GlassCardUI>
            )}
            <ConfirmPopup
                open={revoking !== null}
                title={t("passes.confirmTitle")}
                message={revoking ? t("passes.confirmMessage", { project: projectName(revoking.project_id) }) : null}
                confirmLabel={t("passes.revoke")}
                cancelLabel={tc("cancel")}
                confirmVariant="danger"
                confirmDisabled={busy}
                onCancel={cancelRevoke}
                onConfirm={() => {
                    const pass = revoking;
                    setRevoking(null);
                    if (pass)
                        void run(t("passes.actions.revoke"), () => revokeUrgencyPass(orgId, pupilId, pass.id));
                }}
            />
        </div>
    );
}

function GrantPass({
    id,
    projects,
    disabled,
    onGrant,
}: {
    id: string;
    projects: { id: string; name: string }[];
    disabled: boolean;
    onGrant: (body: {
        project_id: string;
        duration_minutes: number;
        reason_code: TrainingUrgencyReason;
        reason_note: string | null;
    }) => Promise<boolean>;
}) {
    const t = useTranslations("training");
    const [project, setProject] = useState("");
    const [duration, setDuration] = useState(String(DEFAULT_DURATION));
    const [reason, setReason] = useState<TrainingUrgencyReason>("plazo");
    const [note, setNote] = useState("");

    const grant = async () => {
        const done = await onGrant({
            project_id: project,
            duration_minutes: Number(duration),
            reason_code: reason,
            reason_note: note.trim() || null,
        });
        if (done) {
            setProject("");
            setNote("");
        }
    };

    return (
        <GlassCardUI>
            <div className="min-w-0 space-y-3 p-4">
                <h3 className="text-sm font-medium text-gray-900">{t("passes.newTitle")}</h3>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ModalSelect
                        id={`${id}-project`}
                        aria-label={t("passes.project")}
                        value={project}
                        placeholder={projects.length ? t("passes.chooseProject") : t("passes.noProjects")}
                        options={projects.map((option) => ({ value: option.id, label: option.name }))}
                        onChange={setProject}
                        disabled={disabled || projects.length === 0}
                        wrapLabels
                        className="min-w-0 flex-1 basis-56"
                    />
                    <ModalSelect
                        id={`${id}-duration`}
                        aria-label={t("passes.duration")}
                        value={duration}
                        options={DURATIONS.map((minutes) => ({
                            value: String(minutes),
                            label:
                                minutes < 60
                                    ? t("passes.minutes", { minutes })
                                    : t("passes.hours", { hours: minutes / 60 }),
                        }))}
                        onChange={setDuration}
                        disabled={disabled}
                        className="min-w-0 basis-32"
                    />
                    <ModalSelect
                        id={`${id}-reason`}
                        aria-label={t("passes.reasonLabel")}
                        value={reason}
                        options={REASONS.map((value) => ({ value, label: t(`passes.reason.${value}`) }))}
                        onChange={(value) => setReason(value as TrainingUrgencyReason)}
                        disabled={disabled}
                        wrapLabels
                        className="min-w-0 basis-40"
                    />
                </div>
                <NoteField value={note} onChange={setNote} disabled={disabled} />
                <PillButtonUI
                    type="button"
                    tone="black"
                    size="sm"
                    disabled={disabled || !project}
                    onClick={() => void grant()}
                >
                    {t("passes.grant")}
                </PillButtonUI>
            </div>
        </GlassCardUI>
    );
}
