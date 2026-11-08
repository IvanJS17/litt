"use client";

import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authGlassCardUIClassName, pillButtonUIClassName } from "@mike/ui";
import { useAuth } from "@/app/contexts/AuthContext";
import { useTranslations } from "next-intl";

export default function SignupCheckEmailPage() {
    const t = useTranslations();
    const router = useRouter();
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
                                {t("auth.checkEmail.confirmationSent")}
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
