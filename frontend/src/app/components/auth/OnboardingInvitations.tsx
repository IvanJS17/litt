"use client";

import { useEffect, useRef, useState } from "react";
import { ConnectorCard } from "@/app/components/settings/ConnectorCard";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { storeWorkspace } from "@/app/contexts/WorkspaceContext";
import { notifyOrganizationInvitationsChanged } from "@/app/hooks/useOrganizationInvitationCount";
import {
    acceptOrgInvitation,
    declineOrgInvitation,
    listMyOrgInvitations,
    type OrgInvitation,
} from "@/app/lib/mikeApi";
import { ManagedAccountNotice } from "@/app/components/organizations/ManagedAccountNotice";
import { orgRoleLabel } from "@/app/components/organizations/orgRoleText";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { GlassCardUI, PillButtonUI, TOUCH_TARGET_CLASS } from "@mike/ui";
import { useTranslations } from "next-intl";

type Answer = "joined" | "declined";

/**
 * The firm invitations waiting for this person, each to accept or decline.
 * Accepting makes that firm the workspace the app opens in. Once every one is
 * answered `onAnswered` says whether any was accepted; with none waiting
 * `onNone` fires instead. The authenticated endpoint only exposes invitations
 * for a verified email.
 */
export function OnboardingInvitations({
    userId,
    onBusyChange,
    onAnswered,
    onNone,
    onLoadFailed,
}: {
    userId: string;
    onBusyChange: (busy: boolean) => void;
    onAnswered: (joinedAny: boolean) => void;
    onNone: () => void;
    /** The list could not be read: the page offers a way past it. */
    onLoadFailed?: () => void;
}) {
    const t = useTranslations();
    const [invitations, setInvitations] = useState<OrgInvitation[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [answerError, setAnswerError] = useState<string | null>(null);
    const [answeringId, setAnsweringId] = useState<string | null>(null);
    const [answers, setAnswers] = useState<Record<string, Answer>>({});
    const [attempt, setAttempt] = useState(0);
    const mounted = useRef(false);
    const answering = useRef(false);
    // Callbacks change identity on every render of the page; the effects
    // below must not restart because of that.
    const callbacks = useRef({ onBusyChange, onAnswered, onNone, onLoadFailed });
    useEffect(() => {
        callbacks.current = { onBusyChange, onAnswered, onNone, onLoadFailed };
    });

    useEffect(() => {
        mounted.current = true;
        let cancelled = false;
        callbacks.current.onBusyChange(true);
        void listMyOrgInvitations()
            .then(
                (items) => {
                    if (cancelled) return;
                    setInvitations(items);
                    if (items.length === 0) callbacks.current.onNone();
                },
                (error) => {
                    if (cancelled) return;
                    setLoadError(
                        userFacingApiError(error, t("auth.onboarding.loadInvitationsFailed")),
                    );
                    callbacks.current.onLoadFailed?.();
                },
            )
            .finally(() => {
                if (!cancelled) callbacks.current.onBusyChange(false);
            });
        return () => {
            cancelled = true;
            mounted.current = false;
        };
    }, [attempt, t, userId]);

    function reload() {
        setInvitations(null);
        setLoadError(null);
        setAnswerError(null);
        setAttempt((current) => current + 1);
    }

    async function answer(invitation: OrgInvitation, kind: Answer) {
        if (answering.current) return;
        answering.current = true;
        setAnsweringId(invitation.id);
        setAnswerError(null);
        callbacks.current.onBusyChange(true);
        try {
            if (kind === "joined") {
                const accepted = await acceptOrgInvitation(invitation.id);
                if (!mounted.current) return;
                storeWorkspace(userId, accepted.org_id);
            } else {
                await declineOrgInvitation(invitation.id);
                if (!mounted.current) return;
            }
            notifyOrganizationInvitationsChanged();
            const next = { ...answers, [invitation.id]: kind };
            setAnswers(next);
            if (invitations?.every((item) => next[item.id])) {
                callbacks.current.onAnswered(
                    Object.values(next).includes("joined"),
                );
            }
        } catch (error) {
            if (mounted.current)
                setAnswerError(
                    userFacingApiError(error, t("auth.onboarding.acceptInvitationFailed")),
                );
        } finally {
            answering.current = false;
            if (mounted.current) {
                setAnsweringId(null);
                callbacks.current.onBusyChange(false);
            }
        }
    }

    return (
        <section aria-label={t("auth.onboarding.organizationInvitations")} className="space-y-3">
            {invitations === null && !loadError ? (
                <GlassCardUI>
                    <div role="status" aria-label={t("auth.onboarding.checkingYourInvitations")} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <SkeletonLine className="h-9 w-9 shrink-0" />
                        <div className="min-w-0 flex-1 space-y-2"><SkeletonLine className="w-32 max-w-full" /><SkeletonLine className="w-24 max-w-full" /></div>
                        <SkeletonLine className="h-7 w-16" />
                    </div>
                </GlassCardUI>
            ) : null}
            {loadError || answerError ? (
                <div className="space-y-2">
                    <p role="alert" className="text-sm text-red-600">{loadError || answerError}</p>
                    <PillButtonUI type="button" tone="white" size="sm" disabled={answeringId !== null} onClick={reload}>
                        {loadError ? t("auth.onboarding.tryAgain") : t("auth.onboarding.refreshInvitations")}
                    </PillButtonUI>
                </div>
            ) : null}
            {invitations?.map((invitation) => {
                const orgName = invitation.org_name || t("auth.onboarding.organizationFallback");
                const result = answers[invitation.id];
                return (
                    <div key={invitation.id} className="space-y-2">
                    {/* Read before Accept: this invitation creates a firm-managed account. */}
                    {invitation.managed_account && !result ? (
                        <ManagedAccountNotice firm={orgName} />
                    ) : null}
                    <ConnectorCard kind="invitation" stacked
                        name={t("auth.onboarding.invitedToJoin", { name: orgName, role: orgRoleLabel(t, invitation.role) })}
                        icon={<OrganizationSkeuoIcon className="h-6 w-6" />}
                        detail={invitation.invited_by_email ? (
                            <span className="block [overflow-wrap:anywhere]">{t("auth.onboarding.fromInvitedByEmail", { invited_by_email: invitation.invited_by_email })}</span>
                        ) : null}
                        action={result ? (
                            <span role="status" className="text-xs font-medium text-gray-500">
                                {result === "joined" ? t("auth.onboarding.joined") : t("auth.onboarding.declined")}
                            </span>
                        ) : (
                            <div className="flex items-center gap-2">
                                <PillButtonUI type="button" tone="white" size="sm" className={TOUCH_TARGET_CLASS} aria-label={t("auth.onboarding.declineName", { name: orgName })}
                                    disabled={answeringId !== null}
                                    onClick={() => void answer(invitation, "declined")}>{t("auth.onboarding.decline")}</PillButtonUI>
                                <PillButtonUI type="button" tone="black" size="sm" className={TOUCH_TARGET_CLASS} aria-label={t("auth.onboarding.acceptName", { name: orgName })}
                                    disabled={answeringId !== null}
                                    loading={answeringId === invitation.id} onClick={() => void answer(invitation, "joined")}>{t("auth.onboarding.accept")}</PillButtonUI>
                            </div>
                        )}
                    />
                    </div>
                );
            })}
        </section>
    );
}
