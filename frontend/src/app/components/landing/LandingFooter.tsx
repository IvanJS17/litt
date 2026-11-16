import Link from "next/link";
import { useTranslations } from "next-intl";
import { SourceCodeLink } from "@/app/components/shared/SourceCodeLink";
import { AGPL_URL, ATTRIBUTION_ANCHOR, SOURCE_REPOSITORY_URL, SUPPORT_EMAIL } from "./landingConstants";
import { LANDING_FOCUS } from "./landingStyles";
import { LandingLanguage } from "./LandingLanguage";
import { LandingThemeControl } from "./LandingThemeControl";

const FOOTER_LINK = `inline-flex min-h-11 items-center rounded-sm text-foreground underline decoration-interactive-border underline-offset-4 ${LANDING_FOCUS}`;

/**
 * The footer: the two links Google asks for (Aviso de privacidad, Términos y
 * condiciones), support, the source of the exact version running (AGPL-3.0 §13),
 * the license and the upstream credit in a sentence, and the theme and
 * language controls. The wordmark is not repeated here.
 */
export function LandingFooter() {
    const t = useTranslations();
    const outside = { target: "_blank", rel: "noopener noreferrer" } as const;
    return (
        <footer className="border-t border-foreground/14 pt-10 pb-[calc(32px+env(safe-area-inset-bottom))] text-base text-muted-foreground">
            <div className="landing-wrap grid grid-cols-1 gap-7 min-[880px]:grid-cols-[minmax(0,1fr)_auto] min-[880px]:items-start">
                <div>
                    <nav aria-label={t("landing.footer.nav")}>
                        <ul className="flex flex-wrap gap-x-6 gap-y-1">
                            <li>
                                <Link href="/privacidad" className={FOOTER_LINK}>
                                    {t("landing.footer.privacy")}
                                </Link>
                            </li>
                            <li>
                                <Link href="/terminos" className={FOOTER_LINK}>
                                    {t("landing.footer.terms")}
                                </Link>
                            </li>
                            <li>
                                <a href={`mailto:${SUPPORT_EMAIL}`} className={FOOTER_LINK}>
                                    {t("landing.footer.support")}
                                </a>
                            </li>
                            <li>
                                <SourceCodeLink
                                    className={`${FOOTER_LINK} px-0 text-base text-foreground`}
                                />
                            </li>
                        </ul>
                    </nav>
                    <p className="landing-pretty mt-3 max-w-[64ch] text-[0.9375rem]/[1.5]">
                        {t.rich("landing.footer.legal", {
                            agpl: (chunks) => (
                                <a href={AGPL_URL} {...outside} className={`rounded-sm underline underline-offset-2 ${LANDING_FOCUS}`}>
                                    {chunks}
                                </a>
                            ),
                            credits: (chunks) => (
                                <a
                                    href={`${SOURCE_REPOSITORY_URL}${ATTRIBUTION_ANCHOR}`}
                                    {...outside}
                                    className={`rounded-sm underline underline-offset-2 ${LANDING_FOCUS}`}
                                >
                                    {chunks}
                                </a>
                            ),
                        })}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <LandingThemeControl />
                    <LandingLanguage />
                </div>
            </div>
        </footer>
    );
}
