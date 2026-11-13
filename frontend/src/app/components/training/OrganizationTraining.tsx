"use client";

import { useCallback, useEffect, useState } from "react";
import { GlassCardUI, ToggleSwitchUI } from "@mike/ui";
import { useTranslations } from "next-intl";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { useOrganizationSettings } from "@/app/components/organizations/OrganizationSettingsShell";
import {
    assignTrainingPupil,
    designateTrainingMentor,
    getOrgTraining,
    listOrgMembers,
    releaseTrainingPupil,
    removeTrainingMentor,
    type OrgMember,
    type TrainingOrgOverview,
} from "@/app/lib/mikeApi";
import { isOrgAdmin } from "@/app/lib/permissions";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { FirmCriteriaSection } from "./firmCriteria/FirmCriteriaSettings";
import { MemberIdentity, membersById } from "./trainingShared";

// Ajustes del despacho → Formación (docs/training.md): the one place of the
// firm for training.
//   Owner or admin   name the mentors, assign members to a mentor (or move or
//                    free them), see who mentors whom, and the firm's criteria.
//   Anybody else     only the firm's criteria: they read them, and write them
//                    when the server lets them (they are not in training).
// Stages are a matter between a mentor and their pupil, so they are never
// shown here (the server does not send them). An owner or admin is never a
// pupil, so their rows offer a mentor switch and no mentor to choose.

const NO_MENTOR = "";

export function OrganizationTraining() {
    const t = useTranslations();
    const { orgId, org } = useOrganizationSettings();
    const canManage = org !== null && isOrgAdmin(org.role);

    return (
        <div className="space-y-8">
            {canManage ? (
                <MentorsAndPupils orgId={orgId} />
            ) : (
                org !== null && (
                    <SettingsDescription>{t("training.org.memberIntro")}</SettingsDescription>
                )
            )}
            {org !== null && <FirmCriteriaSection orgId={orgId} orgName={org.name} />}
        </div>
    );
}

function MentorsAndPupils({ orgId }: { orgId: string }) {
    const t = useTranslations();
    const [members, setMembers] = useState<OrgMember[] | null>(null);
    const [overview, setOverview] = useState<TrainingOrgOverview | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saving, setSaving] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [nextMembers, nextOverview] = await Promise.all([
                listOrgMembers(orgId),
                getOrgTraining(orgId),
            ]);
            setMembers(nextMembers);
            setOverview(nextOverview);
            setLoadError(null);
        } catch (error) {
            setLoadError(userFacingApiError(error, t("training.org.loadFailed")));
        }
    }, [orgId, t]);

    useEffect(() => {
        void load();
    }, [load]);

    const byId = membersById(members ?? []);
    const mentors = new Set(overview?.mentors ?? []);
    const nameOf = (userId: string) => {
        const who = byId.get(userId);
        return who?.display_name || who?.email || t("training.miembro");
    };
    const pupilsOf = (mentorId: string) =>
        (overview?.pupils ?? []).filter((pupil) => pupil.mentor_user_id === mentorId);
    const mentorOptions = (forUserId: string) => [
        { value: NO_MENTOR, label: t("training.org.noMentor") },
        ...(overview?.mentors ?? [])
            .filter((id) => id !== forUserId)
            .map((id) => ({ value: id, label: nameOf(id) })),
    ];

    const run = async (key: string, action: string, change: () => Promise<void>) => {
        setSaving(key);
        try {
            await change();
            await load();
        } catch (error) {
            notifyError(error, {
                action,
                operation: "training.manage",
                codeMessages: {
                    training_mentor_has_pupils: t("training.org.mentorHasPupils"),
                },
            });
        } finally {
            setSaving(null);
        }
    };

    const toggleMentor = (userId: string, mentor: boolean) =>
        run(
            userId,
            mentor ? "designate the mentor" : "remove the mentor",
            () => (mentor ? designateTrainingMentor(orgId, userId) : removeTrainingMentor(orgId, userId)),
        );

    const chooseMentor = (userId: string, mentorId: string) =>
        run(
            userId,
            mentorId === NO_MENTOR ? "release the pupil" : "assign the pupil",
            () =>
                mentorId === NO_MENTOR
                    ? releaseTrainingPupil(orgId, userId)
                    : assignTrainingPupil(orgId, userId, mentorId),
        );

    return (
        <section className="space-y-3">
            <SettingsHeading id="mentores-y-aprendices">{t("training.org.mentorsHeading")}</SettingsHeading>
            <SettingsDescription>{t("training.org.mentorsHelp")}</SettingsDescription>
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
            {overview !== null && overview.mentors.length === 0 && (
                <SettingsDescription>{t("training.org.noMentorsYet")}</SettingsDescription>
            )}
            <GlassCardUI>
                {members === null && !loadError ? (
                    <div className="space-y-3 p-4" aria-busy="true">
                        {[0, 1, 2].map((row) => (
                            <div key={row} className="h-10 animate-pulse rounded-md bg-gray-100" />
                        ))}
                    </div>
                ) : (
                    (members ?? []).map((member) => {
                        const pupils = pupilsOf(member.user_id);
                        const mentorOf = overview?.pupils.find(
                            (pupil) => pupil.trainee_user_id === member.user_id,
                        );
                        const canBePupil = member.role === "member";
                        const name = nameOf(member.user_id);
                        return (
                            <SettingsRow key={member.user_id} layout="stacked">
                                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                                    <MemberIdentity member={member} userId={member.user_id} />
                                    <label className="flex shrink-0 items-center gap-2 text-sm text-gray-700">
                                        {t("training.mentor")}
                                        <ToggleSwitchUI
                                            checked={mentors.has(member.user_id)}
                                            disabled={saving !== null}
                                            aria-busy={saving === member.user_id}
                                            aria-label={t("training.mentorNombre", { name })}
                                            onCheckedChange={(checked) => {
                                                void toggleMentor(member.user_id, checked);
                                            }}
                                        />
                                    </label>
                                </div>
                                {pupils.length > 0 && (
                                    <p className="text-sm text-gray-500 break-words">
                                        <span className="font-medium text-gray-700">{t("training.mentorDe")} </span>
                                        {pupils.map((pupil) => nameOf(pupil.trainee_user_id)).join(", ")}
                                    </p>
                                )}
                                {canBePupil ? (
                                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <span className="text-sm text-gray-500">{t("training.org.mentorLabel")}</span>
                                        <ModalSelect
                                            id={`training-mentor-of-${member.user_id}`}
                                            aria-label={t("training.org.mentorOf", { name })}
                                            value={mentorOf?.mentor_user_id ?? NO_MENTOR}
                                            options={mentorOptions(member.user_id)}
                                            onChange={(mentorId) => void chooseMentor(member.user_id, mentorId)}
                                            disabled={saving !== null || (overview?.mentors.length ?? 0) === 0}
                                            wrapLabels
                                            className="min-w-0 flex-1 basis-56"
                                        />
                                    </div>
                                ) : (
                                    <p className="text-sm text-gray-500">{t("training.org.cannotBePupil")}</p>
                                )}
                            </SettingsRow>
                        );
                    })
                )}
            </GlassCardUI>
        </section>
    );
}
