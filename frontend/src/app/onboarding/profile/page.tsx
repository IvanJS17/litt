"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import { authInputUIClassName, InputUI, PillButtonUI } from "@mike/ui";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { listMyOrgInvitations, updateUserProfile } from "@/app/lib/mikeApi";
import {
    joinedOrganizationId,
    onboardingStepCount,
    useJoinedOrganization,
} from "@/app/onboarding/joinedOrganization";
import { FieldLabel } from "@/app/components/ui/form-field";
import { describeError } from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

export default function OnboardingProfilePage() {
    const router = useRouter();
    const { user, authLoading } = useAuth();
    const { profile, loading } = useUserProfile();
    const [invitationsChecked, setInvitationsChecked] = useState(false);

    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, router, user]);

    // An invitation to a firm is the first thing the person answers, however
    // they got here (the invitation email goes straight to it). Somebody who
    // already went through it, or could not load it, is let through.
    const userId = user?.id;
    useEffect(() => {
        if (!userId) return;
        if (new URLSearchParams(window.location.search).has("invitations")) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to look up
            setInvitationsChecked(true);
            return;
        }
        let cancelled = false;
        void listMyOrgInvitations().then(
            (pending) => {
                if (cancelled) return;
                if (pending.length > 0) router.replace("/onboarding/invitations");
                else setInvitationsChecked(true);
            },
            () => {
                if (!cancelled) setInvitationsChecked(true);
            },
        );
        return () => {
            cancelled = true;
        };
    }, [router, userId]);

    if (authLoading || loading || !user || !profile || !invitationsChecked) {
        return <FullScreenLoader />;
    }

    return (
        <ProfileDetailsForm
            key={user.id}
            userId={user.id}
            initialName={profile.displayName ?? ""}
            initialOrganisation={profile.organisation ?? ""}
        />
    );
}

function ProfileDetailsForm({
    userId,
    initialName,
    initialOrganisation,
}: {
    userId: string;
    initialName: string;
    initialOrganisation: string;
}) {
    const t = useTranslations();
    const router = useRouter();
    const { reloadProfile } = useUserProfile();
    const { ready, joined } = useJoinedOrganization(userId);
    // Somebody who joined a firm already says which one: no Organization.
    const joinedFirm = joinedOrganizationId(userId) !== null;
    const [name, setName] = useState(initialName);
    const [organisation, setOrganisation] = useState(initialOrganisation);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (submitting) return;
        const displayName = name.trim();

        setSubmitting(true);
        setError(null);
        try {
            await updateUserProfile({
                displayName: displayName || null,
                ...(joinedFirm
                    ? {}
                    : { organisation: organisation.trim() || null }),
            });
            await reloadProfile();
            router.push("/onboarding/practice");
        } catch (submitError) {
            setError(
                describeError(submitError, {
                    action: t("auth.onboarding.saveDetailsAction"),
                    fallback: t("auth.onboarding.saveDetailsFailed"),
                }).message,
            );
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <OnboardingShell
            step={
                ready
                    ? t("auth.onboarding.stepOf", {
                          step: 1,
                          total: onboardingStepCount(joined),
                      })
                    : undefined
            }
            title={t("auth.onboarding.tellUsAboutYou")}
            description={t("auth.onboarding.addTheDetailsWeShouldUse")}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <FieldLabel htmlFor="name">
                        {t("auth.onboarding.name")}
                    </FieldLabel>
                    <InputUI
                        id="name"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        maxLength={200}
                        autoComplete="name"
                        className={`w-full ${authInputUIClassName}`}
                    />
                </div>

                {!joinedFirm && (
                    <div>
                        <FieldLabel htmlFor="organisation">
                            {t("auth.onboarding.organisation")}
                        </FieldLabel>
                        <InputUI
                            id="organisation"
                            value={organisation}
                            onChange={(event) =>
                                setOrganisation(event.target.value)
                            }
                            maxLength={200}
                            autoComplete="organization"
                            className={`w-full ${authInputUIClassName}`}
                        />
                    </div>
                )}

                {error && (
                    <div
                        className="rounded bg-red-50 p-3 text-sm text-red-600"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <div className="pt-2">
                    <PillButtonUI
                        type="submit"
                        tone="black"
                        size="normal"
                        disabled={submitting}
                        className="w-full"
                    >
                        {submitting ? t("auth.onboarding.saving") : t("auth.onboarding.continue")}
                    </PillButtonUI>
                </div>
            </form>
        </OnboardingShell>
    );
}
