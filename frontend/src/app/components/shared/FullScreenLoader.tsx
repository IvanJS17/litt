"use client";

import { usePathname } from "next/navigation";
import { AppShellSkeleton } from "@/app/components/shared/AppShellSkeleton";
import { isAppShellRoute } from "@/app/lib/appShellRoutes";

/**
 * The single full-screen loading state. Every gate in the provider/layout
 * chain (Suspense fallback, MFA gate, onboarding gate, auth-loading layout)
 * must render this exact markup: the server and client can resolve those
 * gates differently on first paint, and identical DOM is what keeps that
 * from being a hydration mismatch. It depends only on the path, which the
 * server and the client agree on.
 *
 * A page inside the sidebar layout loads with the sidebar and header in
 * place; the sign-in and onboarding screens, which have no sidebar, show a
 * spinner.
 */
export function FullScreenLoader() {
    const pathname = usePathname();
    if (isAppShellRoute(pathname)) return <AppShellSkeleton />;
    return (
        <div className="flex min-h-dvh items-center justify-center bg-app-background">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
        </div>
    );
}
