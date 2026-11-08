"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { GlassCardUI, PillButtonUI, TabPillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription, SettingsLabel } from "@/app/components/settings/SettingsText";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
    getMyPupils,
    getMyTraining,
    getPupilPasses,
    getPupilWorks,
    listOrgMembers,
    type OrgMember,
} from "@/app/lib/mikeApi";
import { MemberIdentity } from "../trainingShared";
import { CriterionTab } from "./CriterionTab";
import { DefensesTab } from "./DefensesTab";
import { PassesTab } from "./PassesTab";
import { PromotionTab } from "./PromotionTab";
import { WorksTab } from "./WorksTab";
import { LoadFailed, passInForce, useSupervisionData } from "./supervisionShared";

// Ajustes → Formación → Panel del mentor (docs/training.md): the caller's
// pupils, one organization at a time, ordered by their latest work (never by
// performance), and one pupil's supervision in five tabs. There are no
// totals, charts or comparisons across pupils.

const TABS = ["works", "defenses", "passes", "promotion", "criterion"] as const;
type Tab = (typeof TABS)[number];

type PupilSummary = {
    userId: string;
    member: OrgMember | undefined;
    pendingReview: number;
    lastWorkAt: string | null;
    passEndsAt: string | null;
};
type OrgPupils = { orgId: string; pupils: PupilSummary[] };

async function loadOrgPupils(orgId: string): Promise<OrgPupils> {
    const [mine, members] = await Promise.all([getMyPupils(orgId), listOrgMembers(orgId)]);
    const byId = new Map(members.map((member) => [member.user_id, member]));
    const pupils = await Promise.all(
        mine.pupils.map(async ({ user_id: userId }) => {
            const [works, passes] = await Promise.all([
                getPupilWorks(orgId, userId),
                getPupilPasses(orgId, userId),
            ]);
            const inForce = passes.passes.filter((pass) => passInForce(pass));
            return {
                userId,
                member: byId.get(userId),
                pendingReview: works.works.filter((work) => !work.review?.reviewed_at || work.has_new_work).length,
                lastWorkAt: works.works.reduce<string | null>(
                    (latest, work) => (latest === null || work.last_note_at > latest ? work.last_note_at : latest),
                    null,
                ),
                passEndsAt: inForce.reduce<string | null>(
                    (latest, pass) => (latest === null || pass.expires_at > latest ? pass.expires_at : latest),
                    null,
                ),
            };
        }),
    );
    // Most recent work first; pupils without work last, in the server's order.
    pupils.sort((a, b) => (b.lastWorkAt ?? "").localeCompare(a.lastWorkAt ?? ""));
    return { orgId, pupils };
}

export function MentorPanel() {
    const t = useTranslations("training.mentorPanel");
    const { organizations } = useWorkspace();
    const load = useCallback(async () => {
        const memberships = await getMyTraining();
        return Promise.all(memberships.filter((m) => m.is_mentor).map((m) => loadOrgPupils(m.org_id)));
    }, []);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.manage",
    });
    const [selected, setSelected] = useState<{ orgId: string; pupil: PupilSummary } | null>(null);
    const orgName = (orgId: string) => organizations?.find((org) => org.id === orgId)?.name ?? "";

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Link
                    href="/settings/training"
                    className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t("back")}
                </Link>
                <SettingsHeading id="panel-del-mentor">{t("title")}</SettingsHeading>
                <SettingsDescription>{t("intro")}</SettingsDescription>
            </div>
            {selected ? (
                <PupilSupervision
                    orgId={selected.orgId}
                    orgName={orgName(selected.orgId)}
                    pupil={selected.pupil}
                    onBack={() => {
                        setSelected(null);
                        reload();
                    }}
                />
            ) : failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <PupilListSkeleton />
            ) : data.length === 0 ? (
                <SettingsDescription>{t("notMentor")}</SettingsDescription>
            ) : (
                data.map((org) => (
                    <PupilList
                        key={org.orgId}
                        org={org}
                        orgName={orgName(org.orgId)}
                        onSelect={(pupil) => setSelected({ orgId: org.orgId, pupil })}
                    />
                ))
            )}
        </div>
    );
}

const identityName = (member: OrgMember | undefined, fallback: string) =>
    member?.display_name?.trim() || member?.email || fallback;

function PupilList({
    org,
    orgName,
    onSelect,
}: {
    org: OrgPupils;
    orgName: string;
    onSelect: (pupil: PupilSummary) => void;
}) {
    const t = useTranslations("training");
    return (
        <GlassCardUI>
            <SettingsRow layout="stacked">
                <SettingsLabel>{orgName}</SettingsLabel>
                {org.pupils.length === 0 && <SettingsDescription>{t("mentorPanel.noPupils")}</SettingsDescription>}
            </SettingsRow>
            {org.pupils.map((pupil) => (
                <SettingsRow key={pupil.userId}>
                    <div className="min-w-0 space-y-1">
                        <MemberIdentity userId={pupil.userId} member={pupil.member} />
                        <p className="text-sm text-gray-700">
                            {t("mentorPanel.pendingReview", { count: pupil.pendingReview })}
                        </p>
                        <p className="text-sm text-gray-500">
                            {pupil.lastWorkAt
                                ? t("mentorPanel.lastWork", { date: new Date(pupil.lastWorkAt) })
                                : t("mentorPanel.noWork")}
                        </p>
                        {pupil.passEndsAt && (
                            <p className="text-sm text-gray-700">
                                {t("mentorPanel.passInForce", { end: new Date(pupil.passEndsAt) })}
                            </p>
                        )}
                    </div>
                    <PillButtonUI
                        type="button"
                        tone="black"
                        size="sm"
                        aria-label={t("mentorPanel.superviseName", {
                            name: identityName(pupil.member, t("member")),
                        })}
                        onClick={() => onSelect(pupil)}
                        className="shrink-0 self-start sm:self-center"
                    >
                        {t("mentorPanel.supervise")}
                    </PillButtonUI>
                </SettingsRow>
            ))}
        </GlassCardUI>
    );
}

function PupilListSkeleton() {
    const t = useTranslations("common");
    return (
        <GlassCardUI>
            <div aria-busy="true" aria-label={t("loading")}>
                <SettingsRow layout="stacked">
                    <SkeletonLine className="w-40" />
                </SettingsRow>
                {[0, 1].map((row) => (
                    <SettingsRow key={row}>
                        <div className="w-full min-w-0 space-y-2">
                            <SkeletonLine className="w-48" />
                            <SkeletonLine className="w-64 max-w-full" />
                            <SkeletonLine className="w-40" />
                        </div>
                        <SkeletonLine className="h-7 w-24 rounded-full" />
                    </SettingsRow>
                ))}
            </div>
        </GlassCardUI>
    );
}

function PupilSupervision({
    orgId,
    orgName,
    pupil,
    onBack,
}: {
    orgId: string;
    orgName: string;
    pupil: PupilSummary;
    onBack: () => void;
}) {
    const t = useTranslations("training.mentorPanel");
    const [tab, setTab] = useState<Tab>("works");
    return (
        <section className="space-y-4" aria-labelledby="supervised-pupil">
            <button
                type="button"
                onClick={onBack}
                className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                {t("allPupils")}
            </button>
            <div id="supervised-pupil" className="min-w-0 space-y-0.5">
                <MemberIdentity userId={pupil.userId} member={pupil.member} />
                {orgName && <p className="break-words text-sm text-gray-500">{orgName}</p>}
            </div>
            <div role="group" aria-label={t("tabsLabel")} className="flex min-w-0 flex-wrap gap-2">
                {TABS.map((value) => (
                    <TabPillButtonUI key={value} active={tab === value} onClick={() => setTab(value)}>
                        {t(`tabs.${value}`)}
                    </TabPillButtonUI>
                ))}
            </div>
            {tab === "works" && <WorksTab orgId={orgId} pupilId={pupil.userId} />}
            {tab === "defenses" && <DefensesTab orgId={orgId} pupilId={pupil.userId} />}
            {tab === "passes" && <PassesTab orgId={orgId} pupilId={pupil.userId} />}
            {tab === "promotion" && <PromotionTab orgId={orgId} pupilId={pupil.userId} />}
            {tab === "criterion" && <CriterionTab orgId={orgId} pupilId={pupil.userId} />}
        </section>
    );
}
