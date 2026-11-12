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
    const [invitationsBusy, setInvitationsBusy] = useState(true);

    return (
        <OnboardingShell
            step={t("auth.onboarding.stepOf", { step: 3, total: 4 })}
            title={t("auth.onboarding.organizationInvitations")}
        >
            <OnboardingInvitations
                userId={userId}
                disabled={false}
                onBusyChange={setInvitationsBusy}
            />
            <div className="flex items-center justify-between gap-3 pt-6">
                <PillButtonUI
                    type="button"
                    tone="white"
                    size="normal"
                    disabled={invitationsBusy}
                    onClick={() => router.push("/onboarding/practice")}
                >
                    {t("auth.onboarding.back")}
                </PillButtonUI>
                <PillButtonUI
                    type="button"
                    tone="black"
                    size="normal"
                    disabled={invitationsBusy}
                    onClick={() => router.push("/onboarding/models")}
                >
                    {t("auth.onboarding.continue")}
                </PillButtonUI>
            </div>
        </OnboardingShell>
    );
}
