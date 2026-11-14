"use client";

import { clientTranslator } from "@mike/client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI } from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription, SettingsLabel } from "@/app/components/settings/SettingsText";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { FormTextInput } from "@/app/components/ui/form-field";
import { practiceAreaLabel } from "@/app/onboarding/options";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
    assignTrainingPupil,
    getMyPupils,
    getMyTraining,
    listOrgMembers,
    releaseTrainingPupil,
    removeTrainingStage,
    setTrainingStage,
    type OrgMember,
    type TrainingMembership,
    type TrainingMyPupils,
    type TrainingStage,
    type TrainingStageEntry,
} from "@/app/lib/mikeApi";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { useFirmPracticeAreas } from "./firmPracticeAreas";
import { MemberIdentity, membersById } from "./trainingShared";
import { usePracticeLabel, useStageLabel } from "./supervision/supervisionShared";
import { MentorSeesMe } from "./supervision/MentorSeesMe";
import { ReadingNotice } from "./reading/ReadingNotice";
import { MyGym } from "./gym/MyGym";
import { MyCriterion } from "./map/MyCriterion";

// Ajustes → Formación (docs/training.md):
//   Mi formación   the caller's mentor and stages, per organization; they see
//                  exactly what their mentor sees about them
//                  («Lo que mi mentor ve de mí», layer 2), and their own map,
//                  calibration and retakes («Mi criterio», layer 3)
//   Mis pupilos    for a mentor: take members as pupils, set their stage per
//                  practice area, and release them; the mentor panel
//                  (/settings/training/mentor) supervises each pupil
// The server decides every change; this page only offers what it allows.

const ALL_PRACTICES = "__all__";
const OTHER_PRACTICE = "__other__";

export function TrainingSettings() {
    const t = useTranslations("training.mentorPanel");
    const tr = useTranslations();
    const { organizations } = useWorkspace();
    const [memberships, setMemberships] = useState<TrainingMembership[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setMemberships(await getMyTraining());
            setLoadError(null);
        } catch (error) {
            setLoadError(userFacingApiError(error, "No se pudo cargar tu formación."));
        }
    }, []);

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- start the request on mount
        void load();
    }, [load]);

    const orgName = (orgId: string) =>
        organizations?.find((org) => org.id === orgId)?.name ?? "Organización";
    const asPupil = (memberships ?? []).filter((m) => m.mentor_user_id !== null);
    const asMentor = (memberships ?? []).filter((m) => m.is_mentor);

    if (loadError) return <p className="text-sm text-red-600">{loadError}</p>;
    if (memberships === null)
        return (
            <div className="space-y-3" aria-busy="true">
                <div className="h-6 w-40 animate-pulse rounded bg-gray-100" />
                <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
            </div>
        );

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <SettingsHeading id="mi-formacion">{tr("training.miFormacion")}</SettingsHeading>
                <SettingsDescription>{tr("training.personal.intro")}</SettingsDescription>
                {asPupil.length === 0 ? (
                    <SettingsDescription>
                        {tr("training.noTienesMentor")}
                    </SettingsDescription>
                ) : (
                    asPupil.map((membership) => (
                        <MyTraining
                            key={membership.org_id}
                            membership={membership}
                            orgName={orgName(membership.org_id)}
                        />
                    ))
                )}
            </section>
            {asMentor.length > 0 && (
                <section className="space-y-3">
                    <SettingsHeading id="mis-pupilos">{tr("training.misPupilos")}</SettingsHeading>
                    <SettingsDescription>{tr("training.personal.pupilsHelp")}</SettingsDescription>
                    <Link
                        href="/settings/training/mentor"
                        className="inline-flex rounded text-sm font-medium text-interactive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                        {t("open")}
                    </Link>
                    {asMentor.map((membership) => (
                        <MyPupils
                            key={membership.org_id}
                            orgId={membership.org_id}
                            orgName={orgName(membership.org_id)}
                        />
                    ))}
                </section>
            )}
        </div>
    );
}

function useOrgMembers(orgId: string) {
    const [members, setMembers] = useState<OrgMember[]>([]);
    useEffect(() => {
        let cancelled = false;
        listOrgMembers(orgId).then(
            (next) => {
                if (!cancelled) setMembers(next);
            },
            () => {},
        );
        return () => {
            cancelled = true;
        };
    }, [orgId]);
    return useMemo(() => membersById(members), [members]);
}

function StageList({
    stages,
    onRemove,
    busy = false,
}: {
    stages: TrainingStageEntry[];
    onRemove?: (practice: string | null) => void;
    busy?: boolean;
}) {
    const t = useTranslations();
    const practiceLabel = usePracticeLabel();
    const stageLabel = useStageLabel();
    if (stages.length === 0)
        return <p className="text-sm text-gray-500">{t("training.sinEtapaAsignada")}</p>;
    return (
        <ul className="space-y-1">
            {stages.map((entry) => (
                <li
                    key={entry.practice ?? ALL_PRACTICES}
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700"
                >
                    <span className="break-words">
                        {practiceLabel(entry.practice)}: {stageLabel(entry.stage)}
                    </span>
                    <span className="basis-full break-words text-gray-500">
                        {t(`training.stageHelp.${entry.stage}`)}
                    </span>
                    {onRemove && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onRemove(entry.practice)}
                            className="rounded text-sm text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                        >
                            {t("training.quitar")}
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

function MyTraining({ membership, orgName }: { membership: TrainingMembership; orgName: string }) {
    const members = useOrgMembers(membership.org_id);
    const t = useTranslations("training.criterion.contrast");
    const tr = useTranslations();
    return (
        <GlassCardUI>
            <SettingsRow layout="stacked">
                <SettingsLabel>{orgName}</SettingsLabel>
                <div className="space-y-1">
                    <p className="text-sm text-gray-500">{tr("training.mentor")}</p>
                    <MemberIdentity
                        member={members.get(membership.mentor_user_id!)}
                        userId={membership.mentor_user_id!}
                    />
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-gray-500">{tr("training.etapasPorMateria")}</p>
                    <StageList stages={membership.stages} />
                </div>
            </SettingsRow>
            {membership.stages.some((entry) => entry.stage === "junior") && (
                <SettingsRow layout="stacked">
                    <ReadingNotice orgId={membership.org_id} />
                </SettingsRow>
            )}
            {membership.stages.some((entry) => entry.stage === "junior") && (
                <SettingsRow layout="stacked">
                    <Link
                        href="/settings/training/contrast"
                        className="inline-flex rounded text-sm font-medium text-interactive underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                        {t("page.title")}
                    </Link>
                </SettingsRow>
            )}
            <SettingsRow layout="stacked">
                <MyCriterion orgId={membership.org_id} />
            </SettingsRow>
            <SettingsRow layout="stacked">
                <MyGym orgId={membership.org_id} />
            </SettingsRow>
            <SettingsRow layout="stacked">
                <MentorSeesMe orgId={membership.org_id} />
            </SettingsRow>
        </GlassCardUI>
    );
}

function MyPupils({ orgId, orgName }: { orgId: string; orgName: string }) {
    const t = useTranslations();
    const members = useOrgMembers(orgId);
    const practices = useFirmPracticeAreas(orgId);
    const [data, setData] = useState<TrainingMyPupils | null>(null);
    const [candidate, setCandidate] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await getMyPupils(orgId));
        } catch (error) {
            notifyError(error, { action: clientTranslator()("errors.action.loadYourPupils"), operation: "training.manage" });
        }
    }, [orgId]);

    useEffect(() => {
        void load();
    }, [load]);

    const run = async (action: string, change: () => Promise<void>) => {
        setBusy(true);
        try {
            await change();
            await load();
        } catch (error) {
            notifyError(error, {
                action,
                operation: "training.manage",
                codeMessages: {
                    training_pupil_has_mentor:
                        "Esta persona ya tiene mentor. Solo el propietario o un administrador puede cambiarlo.",
                },
            });
        } finally {
            setBusy(false);
        }
    };

    const name = (userId: string) =>
        members.get(userId)?.display_name || members.get(userId)?.email || t("training.miembro");

    return (
        <GlassCardUI>
            <SettingsRow layout="stacked">
                <SettingsLabel>{orgName}</SettingsLabel>
                {data === null ? (
                    <div className="h-10 animate-pulse rounded-md bg-gray-100" aria-busy="true" />
                ) : (
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <ModalSelect
                            id={`training-candidate-${orgId}`}
                            aria-label={t("training.miembroSinMentor")}
                            value={candidate}
                            placeholder={
                                data.candidates.length ? t("training.eligeAUnMiembroSinMentor") : t("training.todosLosMiembrosTienenMentor")
                            }
                            options={data.candidates.map((id) => ({ value: id, label: name(id) }))}
                            onChange={setCandidate}
                            disabled={busy || data.candidates.length === 0}
                            wrapLabels
                            className="min-w-0 flex-1"
                        />
                        <PillButtonUI
                            type="button"
                            tone="black"
                            size="sm"
                            disabled={busy || !candidate}
                            onClick={() =>
                                void run("add the pupil", async () => {
                                    await assignTrainingPupil(orgId, candidate);
                                    setCandidate("");
                                })
                            }
                        >
                            {t("training.agregarPupilo")}
                        </PillButtonUI>
                    </div>
                )}
            </SettingsRow>
            {data?.pupils.length === 0 && (
                <SettingsRow>
                    <SettingsDescription>{t("training.todaviaNoTienesPupilosAqui")}</SettingsDescription>
                </SettingsRow>
            )}
            {data?.pupils.map((pupil) => (
                <SettingsRow key={pupil.user_id} layout="stacked">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                        <MemberIdentity member={members.get(pupil.user_id)} userId={pupil.user_id} />
                        <PillButtonUI
                            type="button"
                            tone="white"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                                void run("release the pupil", () => releaseTrainingPupil(orgId, pupil.user_id))
                            }
                        >
                            {t("training.liberar")}
                        </PillButtonUI>
                    </div>
                    <StageList
                        stages={pupil.stages}
                        busy={busy}
                        onRemove={(practice) =>
                            void run("remove the stage", () =>
                                removeTrainingStage(orgId, pupil.user_id, practice),
                            )
                        }
                    />
                    <StageEditor
                        id={`training-stage-${orgId}-${pupil.user_id}`}
                        practices={practices}
                        disabled={busy}
                        onSave={(practice, stage) =>
                            void run("set the stage", () =>
                                setTrainingStage(orgId, pupil.user_id, practice, stage),
                            )
                        }
                    />
                </SettingsRow>
            ))}
        </GlassCardUI>
    );
}

/** Choose a practice area (or all of them) and a stage for it. */
export function StageEditor({
    id,
    practices,
    disabled,
    onSave,
}: {
    id: string;
    /** The areas to offer: the firm's profile, or every area when it names none. */
    practices: readonly string[];
    disabled: boolean;
    onSave: (practice: string | null, stage: TrainingStage) => void;
}) {
    const t = useTranslations();
    const stageLabel = useStageLabel();
    const [practice, setPractice] = useState(ALL_PRACTICES);
    const [custom, setCustom] = useState("");
    const [stage, setStage] = useState<TrainingStage>("pasante");
    const chosen =
        practice === ALL_PRACTICES ? null : practice === OTHER_PRACTICE ? custom.trim() : practice;
    const ready = chosen === null || chosen !== "";
    return (
        <div className="space-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <ModalSelect
                    id={`${id}-practice`}
                    aria-label={t("training.materia")}
                    value={practice}
                    options={[
                        { value: ALL_PRACTICES, label: t("training.allPractices") },
                        ...practices.map((area) => ({
                            value: area,
                            label: practiceAreaLabel(area, t),
                        })),
                        { value: OTHER_PRACTICE, label: t("training.otraMateria") },
                    ]}
                    onChange={setPractice}
                    disabled={disabled}
                    wrapLabels
                    className="min-w-0 flex-1"
                />
                {practice === OTHER_PRACTICE && (
                    <FormTextInput
                        aria-label={t("training.nombreDeLaMateria")}
                        placeholder={t("training.escribeLaMateria")}
                        value={custom}
                        maxLength={200}
                        onChange={(event) => setCustom(event.target.value)}
                        disabled={disabled}
                        className="min-w-0 flex-1"
                    />
                )}
                <ModalSelect
                    id={`${id}-stage`}
                    aria-label={t("training.etapa")}
                    value={stage}
                    options={[
                        { value: "pasante", label: stageLabel("pasante") },
                        { value: "junior", label: stageLabel("junior") },
                    ]}
                    onChange={(value) => setStage(value as TrainingStage)}
                    disabled={disabled}
                    className="w-36"
                />
                <PillButtonUI
                    type="button"
                    tone="black"
                    size="sm"
                    disabled={disabled || !ready}
                    onClick={() => onSave(chosen, stage)}
                >
                    {t("training.guardarEtapa")}
                </PillButtonUI>
            </div>
            <p className="text-sm text-gray-500">{t(`training.stageHelp.${stage}`)}</p>
            <p className="text-sm text-gray-500">{t("training.practiceHelp")}</p>
        </div>
    );
}
