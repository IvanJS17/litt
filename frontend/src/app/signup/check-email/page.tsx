"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authGlassCardUIClassName, pillButtonUIClassName } from "@mike/ui";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTranslations } from "next-intl";

function SignupCheckEmailContent() {
    const t = useTranslations();
    const router = useRouter();
    const invitationOnly = useSearchParams().get("mode") === "invitation";
    const { isAuthenticated, authLoading } = useAuth();

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/onboarding/profile");
        }
    }, [authLoading, isAuthenticated, router]);

    return (
        <AuthPageShell>
            <div className="w-full max-w-md">
                <div className={authGlassCardUIClassName}>
                    {authLoading || isAuthenticated ? (
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-500" />
                    ) : (
                        <>
                            <h1 className="font-serif text-2xl font-medium text-gray-950">
                                {t("auth.checkEmail.checkYourEmail")}
                            </h1>
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">
                                {t(
                                    invitationOnly
                                        ? "auth.checkEmail.invitationSent"
                                        : "auth.checkEmail.confirmationSent",
                                )}
                            </p>
                            <Link
                                href="/login"
                                className={pillButtonUIClassName({
                                    tone: "black",
                                    size: "normal",
                                    className: "mt-6",
                                })}
                            >
                                {t("auth.checkEmail.returnToLogin")}
                            </Link>
                        </>
                    )}
                </div>
            </div>
        </AuthPageShell>
    );
}

export default function SignupCheckEmailPage() {
    return (
        <Suspense fallback={null}>
            <SignupCheckEmailContent />
        </Suspense>
    );
}
