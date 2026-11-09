"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale, useTranslations } from "next-intl";
import { LegalLinks } from "@/app/components/legal/LegalLinks";
import { AVISO_SIMPLIFICADO } from "@/content/legal/avisoSimplificado";

// No typography plugin is installed: style the Markdown elements from here.
const DOCUMENT_CLASS =
    "mx-auto w-full max-w-3xl px-6 py-10 text-sm leading-relaxed text-gray-800 " +
    "[&_h1]:mb-4 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-semibold " +
    "[&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold " +
    "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_p]:my-3 " +
    "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 " +
    "[&_a]:underline [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto " +
    "[&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-2";

/** The sign-up line with both links, and the simplified notice behind a fold. */
export function SignupLegal() {
    const t = useTranslations("legal");
    const locale = useLocale();
    return (
        <div className="mt-4 space-y-2 text-center text-xs text-gray-500">
            <p>
                <LegalLinks message="signupLine" />
            </p>
            {locale !== "es-MX" && <p>{t("onlySpanish")}</p>}
            <details className="text-left">
                <summary className="cursor-pointer text-center font-medium">
                    {t("simplifiedTitle")}
                </summary>
                <div className="mt-2 space-y-2 [&_a]:underline [&_h1]:font-semibold [&_p]:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{AVISO_SIMPLIFICADO}</ReactMarkdown>
                </div>
            </details>
        </div>
    );
}

/** A published legal text: fixed Spanish Markdown, with a note outside es-MX. */
export function LegalDocument({ markdown }: { markdown: string }) {
    const t = useTranslations("legal");
    const locale = useLocale();
    return (
        <main className={DOCUMENT_CLASS}>
            {locale !== "es-MX" && (
                <p className="rounded bg-gray-100 px-3 py-2 text-gray-600">
                    {t("onlySpanish")}
                </p>
            )}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </main>
    );
}
