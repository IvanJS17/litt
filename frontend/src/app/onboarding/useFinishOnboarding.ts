"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserProfile } from "@/app/contexts/UserProfileContext";

/**
 * Marks onboarding done and opens the app. The workspace the invitation step
 * stored (the firm just joined, or Personal) is the one the app opens in.
 */
export function useFinishOnboarding() {
    const router = useRouter();
    const { completeOnboarding } = useUserProfile();
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(false);

    async function finish() {
        if (submitting) return;
        setSubmitting(true);
        setError(false);
        if (await completeOnboarding()) {
            router.replace("/assistant");
        } else {
            setError(true);
            setSubmitting(false);
        }
    }

    return { finish, submitting, error, dismissError: () => setError(false) };
}
