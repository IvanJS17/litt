"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingInvitations } from "@/app/components/auth/OnboardingInvitations";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { PillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

export default function OnboardingInvitationsPage() {
    const router = useRouter();
    const { user, authLoading } = useAuth();
    const { profile, loading } = useUserProfile();

    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, router, user]);

    if (authLoading || loading || !user || !profile) {
        return <FullScreenLoader />;
    }

    return <InvitationStep key={user.id} userId={user.id} />;
}

function InvitationStep({ userId }: { userId: string }) {
    const t = useTranslations();
    const router = useRouter();
    const [busy, setBusy] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    // The first screen after the password. Somebody with nothing waiting
    // never sees it; somebody who declined everything carries on as a person
    // who signed up alone ("invitations" tells the next page it was asked).
    const next = () => router.replace("/onboarding/profile?invitations=answered");

    return (
        <OnboardingShell title={t("auth.onboarding.invitationTitle")}>
            <OnboardingInvitations
                userId={userId}
                onBusyChange={setBusy}
                onAnswered={next}
                onNone={next}
                onLoadFailed={() => setLoadFailed(true)}
            />
            {loadFailed && (
                <div className="flex justify-end pt-6">
                    <PillButtonUI type="button" tone="white" size="normal" disabled={busy} onClick={next}>
                        {t("auth.onboarding.continueWithoutAnswering")}
                    </PillButtonUI>
                </div>
            )}
        </OnboardingShell>
    );
}
