"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import {
    PersonalisationFields,
    personalisationInitialValues,
    usePersonalisationFields,
} from "@/app/components/settings/PersonalisationFields";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import {
    onboardingStepCount,
    showsModelsStep,
    useJoinedOrganization,
} from "@/app/onboarding/joinedOrganization";
import { useFinishOnboarding } from "@/app/onboarding/useFinishOnboarding";
import { PillButtonUI } from "@mike/ui";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useTranslations } from "next-intl";

export default function OnboardingPracticePage() {
    const router = useRouter();
    const { user, authLoading } = useAuth();
    const { profile, loading } = useUserProfile();

    useEffect(() => {
        if (!authLoading && !user) router.replace("/login");
    }, [authLoading, router, user]);

    if (authLoading || loading || !user || !profile) {
        return <FullScreenLoader />;
    }

    return (
        <PracticeDetailsForm
            key={user.id}
            userId={user.id}
            initial={personalisationInitialValues(profile)}
        />
    );
}

function PracticeDetailsForm({
    userId,
    initial,
}: {
    userId: string;
    initial: ReturnType<typeof personalisationInitialValues>;
}) {
    const t = useTranslations();
    const router = useRouter();
    const { updatePersonalisation } = useUserProfile();
    const form = usePersonalisationFields(initial);
    const { ready, joined } = useJoinedOrganization(userId);
    const finishing = useFinishOnboarding();
    // Models come next, unless the firm the person joined leaves no use for
    // keys of their own: then this is the last step.
    const last = ready && !showsModelsStep(joined);
    const goNext = () =>
        last ? void finishing.finish() : router.push("/onboarding/models");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const savePracticeDetails = async (
        details: Parameters<typeof updatePersonalisation>[0],
    ) => {
        if (submitting) return;
        setSubmitting(true);
        setError(null);
        const saved = await updatePersonalisation(details);
        if (saved) {
            goNext();
            // Finishing can fail and leave the person here; opening the
            // models step never does, so the form stays locked for it.
            if (last) setSubmitting(false);
        } else {
            // `updatePersonalisation` already raised the notice with the
            // sentence, Retry and support; an inline line would repeat it.
            setSubmitting(false);
        }
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (form.validationError) {
            setError(form.validationError);
            return;
        }

        await savePracticeDetails({
            ...(form.details.jurisdiction
                ? { jurisdiction: form.details.jurisdiction }
                : {}),
            ...(form.details.practiceSetting
                ? { practiceSetting: form.details.practiceSetting }
                : {}),
            ...(form.details.professionalTitle
                ? { professionalTitle: form.details.professionalTitle }
                : {}),
            ...(form.details.practiceAreas?.length
                ? { practiceAreas: form.details.practiceAreas }
                : {}),
        });
    };

    return (
        <OnboardingShell
            step={
                ready
                    ? t("auth.onboarding.stepOf", {
                          step: 2,
                          total: onboardingStepCount(joined),
                      })
                    : undefined
            }
            title={t("auth.onboarding.yourLegalPractice")}
            description={t("auth.onboarding.optionallyAddYourProfessionalSettingPrimary")}
        >
            <form onSubmit={handleSubmit}>
                <PersonalisationFields
                    form={form}
                    order={[
                        "jurisdiction",
                        "professionalTitle",
                        "practiceSetting",
                        "practiceAreas",
                    ]}
                    className="space-y-4"
                />

                {error && (
                    <div
                        className="mt-4 rounded bg-red-50 p-3 text-sm text-red-600"
                        role="alert"
                    >
                        {error}
                    </div>
                )}

                <div className="flex items-center justify-between gap-3 pt-6">
                    <PillButtonUI
                        type="button"
                        tone="white"
                        size="normal"
                        disabled={submitting}
                        onClick={() => router.push("/onboarding/profile")}
                    >
                        {t("auth.onboarding.back")}
                    </PillButtonUI>
                    <div className="flex items-center gap-4">
                        <button
                            type="button"
                            disabled={submitting || !ready || finishing.submitting}
                            onClick={goNext}
                            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                            {t("auth.onboarding.skip")}
                        </button>
                        <PillButtonUI
                            type="submit"
                            tone="black"
                            size="normal"
                            disabled={submitting || !ready || finishing.submitting}
                        >
                            {submitting ? t("auth.onboarding.saving") : t("auth.onboarding.continue")}
                        </PillButtonUI>
                    </div>
                </div>
            </form>
            <WarningPopup
                open={finishing.error}
                onClose={finishing.dismissError}
                title={t("auth.onboarding.unableToFinishSetup")}
                message={t("auth.onboarding.pleaseTryAgain")}
            />
        </OnboardingShell>
    );
}
