import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale, useTranslations } from "next-intl";
import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import { LegalBackLink } from "@/app/components/legal/LegalBackLink";
import { legalToc, rehypeLegalAnchors } from "@/app/components/legal/legalAnchors";

// No typography plugin is installed: style the Markdown elements from here.
// 16 px on a phone (14 from md up); a section or clause reached by a link
// (#5-5) stops below the top and is outlined with the keyboard-focus ring.
const DOCUMENT_CLASS =
    "w-full text-base leading-relaxed text-gray-800 md:text-sm " +
    "[&_h1]:mb-4 [&_h1]:font-serif [&_h1]:text-3xl [&_h1]:font-semibold " +
    "[&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:font-serif [&_h2]:text-xl [&_h2]:font-semibold " +
    "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold [&_p]:my-3 " +
    "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 " +
    "[&_a]:underline [&_table]:my-4 [&_table]:block [&_table]:overflow-x-auto " +
    "[&_th]:border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border [&_td]:px-3 [&_td]:py-2 " +
    "[&_[id]]:scroll-mt-6 [&_li:target]:rounded-md [&_li:target]:outline [&_li:target]:outline-2 " +
    "[&_li:target]:outline-offset-4 [&_li:target]:outline-interactive-border";

/**
 * A published legal text on the signed-out page frame (logo, back link,
 * contents, text). A server component: the Markdown becomes static HTML on the
 * server, so the phone downloads and hydrates none of it. The text is fixed
 * Spanish, with a note outside es-MX.
 */
export function LegalDocument({ markdown }: { markdown: string }) {
    const t = useTranslations("legal");
    const locale = useLocale();
    const toc = legalToc(markdown);
    return (
        <AuthPageShell>
            <div className="w-full max-w-3xl pb-10">
                <LegalBackLink />
                <main className="mt-2">
                    {locale !== "es-MX" && (
                        <p className="mb-4 rounded bg-gray-100 px-3 py-2 text-gray-600">
                            {t("onlySpanish")}
                        </p>
                    )}
                    {toc.length > 0 && (
                        <details className="mb-6 rounded-xl bg-app-surface px-4 py-3 text-sm text-gray-800">
                            <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                                {t("toc")}
                            </summary>
                            <ol className="mt-2 space-y-1">
                                {toc.map((entry) => (
                                    <li key={entry.id}>
                                        <a
                                            href={`#${entry.id}`}
                                            className="inline-block py-1 underline-offset-2 hover:underline"
                                        >
                                            {entry.title}
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        </details>
                    )}
                    <article data-testid="legal-text" className={DOCUMENT_CLASS}>
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            rehypePlugins={[rehypeLegalAnchors]}
                        >
                            {markdown}
                        </ReactMarkdown>
                    </article>
                </main>
            </div>
        </AuthPageShell>
    );
}
