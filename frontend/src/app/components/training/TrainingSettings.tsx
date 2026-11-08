"use client";

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
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";
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
import { MemberIdentity, membersById, practiceLabel, STAGE_LABEL } from "./trainingShared";
import { MentorSeesMe } from "./supervision/MentorSeesMe";
import { ReadingNotice } from "./reading/ReadingNotice";
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
                <SettingsHeading id="mi-formacion">Mi formación</SettingsHeading>
                {asPupil.length === 0 ? (
                    <SettingsDescription>
                        No tienes mentor en ninguna organización. Sin etapa, LiTT funciona para ti
                        como para cualquier abogado.
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
                    <SettingsHeading id="mis-pupilos">Mis pupilos</SettingsHeading>
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
    if (stages.length === 0)
        return <p className="text-sm text-gray-500">Sin etapa asignada.</p>;
    return (
        <ul className="space-y-1">
            {stages.map((entry) => (
                <li
                    key={entry.practice ?? ALL_PRACTICES}
                    className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700"
                >
                    <span className="break-words">
                        {practiceLabel(entry.practice)}: {STAGE_LABEL[entry.stage]}
                    </span>
                    {onRemove && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => onRemove(entry.practice)}
                            className="rounded text-sm text-gray-500 underline-offset-2 hover:text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                        >
                            Quitar
                        </button>
                    )}
                </li>
            ))}
        </ul>
    );
}

function MyTraining({ membership, orgName }: { membership: TrainingMembership; orgName: string }) {
    const members = useOrgMembers(membership.org_id);
    return (
        <GlassCardUI>
            <SettingsRow layout="stacked">
                <SettingsLabel>{orgName}</SettingsLabel>
                <div className="space-y-1">
                    <p className="text-sm text-gray-500">Mentor</p>
                    <MemberIdentity
                        member={members.get(membership.mentor_user_id!)}
                        userId={membership.mentor_user_id!}
                    />
                </div>
                <div className="space-y-1">
                    <p className="text-sm text-gray-500">Etapas por materia</p>
                    <StageList stages={membership.stages} />
                </div>
            </SettingsRow>
            {membership.stages.some((entry) => entry.stage === "junior") && (
                <SettingsRow layout="stacked">
                    <ReadingNotice orgId={membership.org_id} />
                </SettingsRow>
            )}
            <SettingsRow layout="stacked">
                <MyCriterion orgId={membership.org_id} />
            </SettingsRow>
            <SettingsRow layout="stacked">
                <MentorSeesMe orgId={membership.org_id} />
            </SettingsRow>
        </GlassCardUI>
    );
}

function MyPupils({ orgId, orgName }: { orgId: string; orgName: string }) {
    const members = useOrgMembers(orgId);
    const [data, setData] = useState<TrainingMyPupils | null>(null);
    const [candidate, setCandidate] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            setData(await getMyPupils(orgId));
        } catch (error) {
            notifyError(error, { action: "load your pupils", operation: "training.manage" });
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
                        "Esta persona ya tiene mentor. Solo el dueño o un administrador puede cambiarlo.",
                },
            });
        } finally {
            setBusy(false);
        }
    };

    const name = (userId: string) =>
        members.get(userId)?.display_name || members.get(userId)?.email || "Miembro";

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
                            aria-label="Miembro sin mentor"
                            value={candidate}
                            placeholder={
                                data.candidates.length ? "Elige a un miembro sin mentor" : "Todos los miembros tienen mentor"
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
                            Agregar pupilo
                        </PillButtonUI>
                    </div>
                )}
            </SettingsRow>
            {data?.pupils.length === 0 && (
                <SettingsRow>
                    <SettingsDescription>Todavía no tienes pupilos aquí.</SettingsDescription>
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
                            Liberar
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
    disabled,
    onSave,
}: {
    id: string;
    disabled: boolean;
    onSave: (practice: string | null, stage: TrainingStage) => void;
}) {
    const [practice, setPractice] = useState(ALL_PRACTICES);
    const [custom, setCustom] = useState("");
    const [stage, setStage] = useState<TrainingStage>("pasante");
    const chosen =
        practice === ALL_PRACTICES ? null : practice === OTHER_PRACTICE ? custom.trim() : practice;
    const ready = chosen === null || chosen !== "";
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ModalSelect
                id={`${id}-practice`}
                aria-label="Materia"
                value={practice}
                options={[
                    { value: ALL_PRACTICES, label: "Todas las materias" },
                    ...PRACTICE_OPTIONS.filter((option) => option !== "Other").map((option) => ({
                        value: option,
                        label: option,
                    })),
                    { value: OTHER_PRACTICE, label: "Otra materia" },
                ]}
                onChange={setPractice}
                disabled={disabled}
                wrapLabels
                className="min-w-0 flex-1"
            />
            {practice === OTHER_PRACTICE && (
                <FormTextInput
                    aria-label="Nombre de la materia"
                    placeholder="Escribe la materia"
                    value={custom}
                    maxLength={200}
                    onChange={(event) => setCustom(event.target.value)}
                    disabled={disabled}
                    className="min-w-0 flex-1"
                />
            )}
            <ModalSelect
                id={`${id}-stage`}
                aria-label="Etapa"
                value={stage}
                options={[
                    { value: "pasante", label: STAGE_LABEL.pasante },
                    { value: "junior", label: STAGE_LABEL.junior },
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
                Guardar etapa
            </PillButtonUI>
        </div>
    );
}
