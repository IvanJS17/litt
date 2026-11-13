"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ModalUI } from "@mike/ui";
import { useLocale, useTranslations } from "next-intl";
import { LegalLinks } from "@/app/components/legal/LegalLinks";
import { AVISO_SIMPLIFICADO } from "@/content/legal/avisoSimplificado";

/**
 * The sign-up line with both links. The simplified notice opens from a button
 * in the same paragraph, so the legal text adds no height under the card
 * (AuthPageShell: sign-in and sign-up must fit 1280×640).
 */
export function SignupLegal() {
    const t = useTranslations("legal");
    const locale = useLocale();
    const [open, setOpen] = useState(false);
    return (
        <p className="mt-1 text-center text-xs leading-4 text-gray-500 md:-mx-16 [@media(min-height:701px)]:mt-4">
            <LegalLinks message="signupLine" />{" "}
            {locale !== "es-MX" && <>{t("onlySpanish")} </>}
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="font-medium underline transition-colors hover:text-gray-950"
            >
                {t("simplifiedTitle")}
            </button>
            <ModalUI
                open={open}
                onClose={() => setOpen(false)}
                size="md"
                ariaLabel={t("simplifiedTitle")}
                breadcrumbs={[t("simplifiedTitle")]}
            >
                <div className="space-y-2 p-6 text-left text-sm text-gray-800 [&_a]:underline [&_h1]:font-semibold">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{AVISO_SIMPLIFICADO}</ReactMarkdown>
                </div>
            </ModalUI>
        </p>
    );
}
