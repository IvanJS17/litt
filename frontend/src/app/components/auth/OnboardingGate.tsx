"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { useAuth } from "@/app/contexts/AuthContext";
import { TermsAcceptance } from "@/app/components/legal/TermsAcceptance";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { isLegalPath } from "@/app/lib/legalRoutes";

export function OnboardingGate({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const router = useRouter();
    const { user } = useAuth();
    const { profile, loading } = useUserProfile();
    const isOnboardingRoute = pathname.startsWith("/onboarding");
    // Credential-recovery pages must stay reachable even when onboarding is
    // incomplete: a recovery link logs the user in, and bouncing them to
    // onboarding here would discard the recovery session before they can set
    // a password (they'd stay locked out of their account forever).
    const isAuthTransitionRoute =
        pathname === "/login" ||
        pathname === "/login/sso" ||
        pathname === "/signup" ||
        pathname === "/signup/check-email" ||
        pathname === "/auth/callback" ||
        pathname === "/auth/set-password" ||
        pathname === "/forgot-password" ||
        pathname === "/reset-password" ||
        pathname === "/verify-mfa";
    // The published texts stay readable to everyone, signed in or not.
    const isLegalRoute = isLegalPath(pathname);
    const needsTerms =
        profile?.termsRequired === true && !isLegalRoute && !isAuthTransitionRoute;
    const needsOnboarding = profile?.onboardingComplete === false;

    useEffect(() => {
        if (!user || loading || !profile || needsTerms) return;

        if (needsOnboarding && !isOnboardingRoute && !isAuthTransitionRoute) {
            router.replace("/onboarding/profile");
            return;
        }
        if (!needsOnboarding && isOnboardingRoute) {
            router.replace("/assistant");
        }
    }, [
        isOnboardingRoute,
        isAuthTransitionRoute,
        loading,
        needsOnboarding,
        needsTerms,
        profile,
        router,
        user,
    ]);

    if (!user) return <>{children}</>;
    if (loading || !profile) return <FullScreenLoader />;
    if (needsTerms) return <TermsAcceptance />;
    if (needsOnboarding && !isOnboardingRoute && !isAuthTransitionRoute) {
        return <FullScreenLoader />;
    }
    if (!needsOnboarding && isOnboardingRoute) return <FullScreenLoader />;

    return <>{children}</>;
}
