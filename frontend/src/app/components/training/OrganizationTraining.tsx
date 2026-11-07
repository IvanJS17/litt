"use client";

import { useCallback, useEffect, useState } from "react";
import { GlassCardUI } from "@mike/ui";
import { ToggleSwitchUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { useOrganizationSettings } from "@/app/components/organizations/OrganizationSettingsShell";
import {
    designateTrainingMentor,
    getOrgTraining,
    listOrgMembers,
    removeTrainingMentor,
    type OrgMember,
    type TrainingOrgOverview,
} from "@/app/lib/mikeApi";
import { isOrgAdmin } from "@/app/lib/permissions";
import { notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { MemberIdentity, membersById } from "./trainingShared";

// Ajustes → Organización → Formación, for its owners and admins: who is a
// mentor and whose mentor they are. Stages are a matter between a mentor
// and their pupil, so they are not shown here (the server does not send them).

export function OrganizationTraining() {
    const { orgId, org } = useOrganizationSettings();
    const canManage = org !== null && isOrgAdmin(org.role);
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
            setLoadError(userFacingApiError(error, "No se pudo cargar la formación."));
        }
    }, [orgId]);

    useEffect(() => {
        if (canManage) void load();
    }, [canManage, load]);

    if (!canManage) {
        return (
            <SettingsDescription>
                Solo el dueño o un administrador de la organización designa mentores.
            </SettingsDescription>
        );
    }

    const byId = membersById(members ?? []);
    const mentors = new Set(overview?.mentors ?? []);
    const pupilsOf = (mentorId: string) =>
        (overview?.pupils ?? []).filter((pupil) => pupil.mentor_user_id === mentorId);

    const toggleMentor = async (userId: string, mentor: boolean) => {
        setSaving(userId);
        try {
            if (mentor) await designateTrainingMentor(orgId, userId);
            else await removeTrainingMentor(orgId, userId);
            await load();
        } catch (error) {
            notifyError(error, {
                action: mentor ? "designate the mentor" : "remove the mentor",
                operation: "training.manage",
                codeMessages: {
                    training_mentor_has_pupils:
                        "Esta persona todavía tiene pupilos. Libéralos o asígnales otro mentor primero.",
                },
            });
        } finally {
            setSaving(null);
        }
    };

    return (
        <section className="space-y-3">
            <SettingsHeading>Formación</SettingsHeading>
            <SettingsDescription>
                Designa a los mentores del despacho. Cada mentor toma a sus pupilos y les
                asigna su etapa por materia en Ajustes → Formación.
            </SettingsDescription>
            {loadError && <p className="text-sm text-red-600">{loadError}</p>}
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
                        return (
                            <SettingsRow key={member.user_id}>
                                <div className="min-w-0 flex-1 space-y-1">
                                    <MemberIdentity member={member} userId={member.user_id} />
                                    {pupils.length > 0 && (
                                        <div className="text-sm text-gray-500">
                                            <span className="font-medium text-gray-700">Mentor de: </span>
                                            {pupils
                                                .map((pupil) => {
                                                    const who = byId.get(pupil.trainee_user_id);
                                                    return who?.display_name || who?.email || "Miembro";
                                                })
                                                .join(", ")}
                                        </div>
                                    )}
                                    {mentorOf && (
                                        <p className="text-sm text-gray-500 break-words">
                                            Pupilo de{" "}
                                            {byId.get(mentorOf.mentor_user_id)?.display_name ||
                                                byId.get(mentorOf.mentor_user_id)?.email ||
                                                "un mentor"}
                                        </p>
                                    )}
                                </div>
                                <label className="flex shrink-0 items-center gap-2 text-sm text-gray-700">
                                    Mentor
                                    <ToggleSwitchUI
                                        checked={mentors.has(member.user_id)}
                                        disabled={saving !== null}
                                        aria-busy={saving === member.user_id}
                                        aria-label={`Mentor: ${member.display_name || member.email || "miembro"}`}
                                        onCheckedChange={(checked) => {
                                            void toggleMentor(member.user_id, checked);
                                        }}
                                    />
                                </label>
                            </SettingsRow>
                        );
                    })
                )}
            </GlassCardUI>
        </section>
    );
}
