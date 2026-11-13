"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { PersonalProviderKeys } from "@/app/components/settings/PersonalProviderKeys";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { type ApiKeyState } from "@/app/lib/mikeApi";
import {
    hasUsableProvider,
    onboardingStepCount,
        useJoinedOrganization,
    type JoinedOrganization,
} from "@/app/onboarding/joinedOrganization";
import { useFinishOnboarding } from "@/app/onboarding/useFinishOnboarding";
import { PillButtonUI } from "@mike/ui";
import { useTranslations } from "next-intl";

export default function OnboardingModelsPage() {
    const router = useRouter();
    const { user, authLoading } = useAuth();
    const { profile, loading } = useUserProfile();

    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, router, user]);

    if (authLoading || loading || !user || !profile) {
        return <FullScreenLoader />;
    }

    return <ModelStep key={user.id} userId={user.id} />;
}

// LiTT keeps personal BYOK inside an organization: a member's own key covers
// any provider the organization has not set up, unless its owners turn that
// off. The copy never says a key is for the Personal workspace only unless
// the organization the person joined says so.
function ModelStep({ userId }: { userId: string }) {
    const t = useTranslations();
    const router = useRouter();
    const { profile } = useUserProfile();
    const { ready, joined } = useJoinedOrganization(userId);
    const { finish, submitting, error, dismissError } = useFinishOnboarding();
    // A firm that already gives the person models makes their own keys a
    // bonus, not a requirement: the step says so and can be skipped.
    const optional = joined?.hasModels === true;

    function stepDescription(
        keys: ApiKeyState | undefined,
        joined: JoinedOrganization | null,
    ): string {
        // Those sentences speak of a Personal workspace and of keys of one's
        // own; a firm-managed account has neither.
        if (profile?.personalWorkspaceDisabled) return "";
        if (joined?.hasModels) {
            return t("auth.onboarding.stepJoined", { name: joined.name });
        }
        if (joined) {
            return t("auth.onboarding.stepJoinedNoModels", { name: joined.name });
        }
        if (hasUsableProvider(keys, "user")) {
            return t("auth.onboarding.stepKeySaved");
        }
        if (hasUsableProvider(keys, "env")) {
            return t("auth.onboarding.stepDeployment");
        }
        return t("auth.onboarding.stepAddKey");
    }

    return (
        <OnboardingShell
            step={
                ready
                    ? t("auth.onboarding.stepOf", {
                          step: onboardingStepCount(joined),
                          total: onboardingStepCount(joined),
                      })
                    : undefined
            }
            title={
                optional
                    ? t("auth.onboarding.ownKeysOptional")
                    : t("auth.onboarding.connectAModel")
            }
            description={stepDescription(profile?.apiKeys, joined)}
            width="wide"
        >
            <PersonalProviderKeys intro={null} />
            <WarningPopup
                open={error}
                onClose={dismissError}
                title={t("auth.onboarding.unableToFinishSetup")}
                message={t("auth.onboarding.pleaseTryAgain")}
            />
            <div className="flex items-center justify-between gap-3 pt-6">
                <PillButtonUI
                    type="button"
                    tone="white"
                    size="normal"
                    disabled={submitting}
                    onClick={() => router.push("/onboarding/practice")}
                >
                    {t("auth.onboarding.back")}
                </PillButtonUI>
                <div className="flex items-center gap-4">
                    {optional && (
                        <button
                            type="button"
                            disabled={submitting}
                            onClick={() => void finish()}
                            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                            {t("auth.onboarding.skip")}
                        </button>
                    )}
                    <PillButtonUI
                        type="button"
                        tone="black"
                        size="normal"
                        disabled={submitting}
                        onClick={() => void finish()}
                    >
                        {submitting ? t("auth.onboarding.finishing") : t("auth.onboarding.finish")}
                    </PillButtonUI>
                </div>
            </div>
        </OnboardingShell>
    );
}
