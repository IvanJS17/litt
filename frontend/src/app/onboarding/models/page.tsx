"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OnboardingShell } from "@/app/components/auth/OnboardingShell";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { MODEL_API_KEY_FIELDS } from "@/app/components/settings/modelProviders";
import { PersonalProviderKeys } from "@/app/components/settings/PersonalProviderKeys";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
    PERSONAL_WORKSPACE,
    readStoredWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { apiKeyStateFromStatus } from "@/app/lib/apiKeyState";
import { getOrgApiKeys, listOrgs, type ApiKeyState } from "@/app/lib/mikeApi";
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

type KeySource = "user" | "org" | "env" | null;

/** Whether any model provider can run on the given keys, from the named source. */
function hasUsableProvider(
    keys: ApiKeyState | undefined,
    source?: Exclude<KeySource, null>,
): boolean {
    if (!keys) return false;
    return MODEL_API_KEY_FIELDS.some((field) => {
        const state = keys[field.provider];
        return (
            !!state?.configured &&
            state.enabled !== false &&
            (source === undefined || state.source === source)
        );
    });
}

type JoinedOrganization = {
    name: string;
    hasModels: boolean;
    allowsOwnKeys: boolean;
};

/**
 * The organization the person accepted an invitation to in the previous
 * step, and whether it already has models to run on. Onboarding runs
 * outside the app's WorkspaceProvider, so the stored workspace is read and
 * resolved here. Null until known, or when there is nothing to say.
 */
function useJoinedOrganization(userId: string) {
    const [joined, setJoined] = useState<JoinedOrganization | null>(null);

    useEffect(() => {
        const orgId = readStoredWorkspace(userId);
        if (orgId === PERSONAL_WORKSPACE) return;
        let cancelled = false;
        void Promise.all([listOrgs(), getOrgApiKeys(orgId)]).then(
            ([orgs, keys]) => {
                if (cancelled) return;
                const org = orgs.find((candidate) => candidate.id === orgId);
                if (!org) return;
                setJoined({
                    name: org.name,
                    hasModels: hasUsableProvider(
                        apiKeyStateFromStatus(keys.effective),
                    ),
                    // LiTT: members' own keys are allowed unless the owners
                    // turned them off (on by default).
                    allowsOwnKeys: keys.allow_personal_api_keys !== false,
                });
            },
            () => {
                // Unknown is not "no models": the step keeps its general
                // wording and the server still decides what may run.
            },
        );
        return () => {
            cancelled = true;
        };
    }, [userId]);

    return joined;
}

// LiTT keeps personal BYOK inside an organization: a member's own key covers
// any provider the organization has not set up, unless its owners turn that
// off. The copy never says a key is for the Personal workspace only unless
// the organization the person joined says so.
function ModelStep({ userId }: { userId: string }) {
    const t = useTranslations();
    const router = useRouter();
    const { profile, completeOnboarding } = useUserProfile();
    const joined = useJoinedOrganization(userId);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(false);

    function stepDescription(
        keys: ApiKeyState | undefined,
        joined: JoinedOrganization | null,
    ): string {
        // Those sentences speak of a Personal workspace and of keys of one's
        // own; a firm-managed account has neither.
        if (profile?.personalWorkspaceDisabled) return "";
        if (joined?.hasModels) {
            return t("auth.onboarding.stepJoined", {
                name: joined.name,
                ownKeys: joined.allowsOwnKeys ? "allowed" : "own",
            });
        }
        if (hasUsableProvider(keys, "user")) {
            return t("auth.onboarding.stepKeySaved");
        }
        if (hasUsableProvider(keys, "env")) {
            return t("auth.onboarding.stepDeployment");
        }
        return t("auth.onboarding.stepAddKey");
    }

    async function finish() {
        if (submitting) return;
        setSubmitting(true);
        setError(false);
        const saved = await completeOnboarding();
        if (saved) {
            router.replace("/assistant");
        } else {
            setError(true);
            setSubmitting(false);
        }
    }

    return (
        <OnboardingShell
            step={t("auth.onboarding.stepOf", { step: 4, total: 4 })}
            title={t("auth.onboarding.connectAModel")}
            description={stepDescription(profile?.apiKeys, joined)}
            width="wide"
        >
            <PersonalProviderKeys intro={null} />
            <WarningPopup
                open={error}
                onClose={() => setError(false)}
                title={t("auth.onboarding.unableToFinishSetup")}
                message={t("auth.onboarding.pleaseTryAgain")}
            />
            <div className="flex items-center justify-between gap-3 pt-6">
                <PillButtonUI
                    type="button"
                    tone="white"
                    size="normal"
                    disabled={submitting}
                    onClick={() => router.push("/onboarding/invitations")}
                >
                    {t("auth.onboarding.back")}
                </PillButtonUI>
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
        </OnboardingShell>
    );
}
