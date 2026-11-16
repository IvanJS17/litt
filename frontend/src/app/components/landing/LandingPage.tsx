import { useTranslations } from "next-intl";
import "./landing.css";
import { CitationSpecimen } from "./CitationSpecimen";
import { CtaPair } from "./LandingCtas";
import { FeatureIndex } from "./FeatureIndex";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { SectionHead } from "./SectionHead";
import { SoonBand } from "./SoonBand";
import { TabularSpecimen } from "./TabularSpecimen";
import { TrustList } from "./TrustList";
import { WordSpecimen } from "./WordSpecimen";
import { HERO_CTA_ID, SECTION_IDS, SUPPORT_EMAIL } from "./landingConstants";
import { LANDING_FOCUS, LANDING_PIXEL, LANDING_SECTION } from "./landingStyles";

const MAIN_ID = "main";

/** A sheet with its example: the folio of PRIMERO. */
function Folio({
    id,
    title,
    body,
    children,
}: {
    id: string;
    title: string;
    body: string;
    children: React.ReactNode;
}) {
    return (
        <article
            aria-labelledby={id}
            className="flex min-w-0 flex-col gap-5 rounded-[20px] bg-surface-sheet p-[clamp(20px,3vw,32px)] shadow-elev-sheet"
        >
            <div>
                <h3 id={id} className="mb-1.5 text-[1.375rem]/[1.25] font-semibold">
                    {title}
                </h3>
                <p className="landing-pretty max-w-[40ch] text-muted-foreground">{body}</p>
            </div>
            <div className="mt-auto">{children}</div>
        </article>
    );
}

/**
 * The public start page (`/`): what LiTT is, what it does today, what is
 * coming, how it is built and how to get in. The same page with or without a
 * session; only the main button changes ("Iniciar sesión" → /login, "Abrir
 * LiTT" → /assistant), and it is decided on the server, so it never flickers.
 * Static text and fictitious examples: it calls no API.
 */
export function LandingPage({ signedIn }: { signedIn: boolean }) {
    const t = useTranslations();
    const mail = (chunks: React.ReactNode) => (
        <a href={`mailto:${SUPPORT_EMAIL}`} className={`rounded-sm text-foreground underline underline-offset-2 ${LANDING_FOCUS}`}>
            {chunks}
        </a>
    );

    return (
        <div className="landing-root min-h-dvh bg-surface-desk font-serif text-[1.125rem]/[1.55] text-foreground [font-optical-sizing:auto]">
            <a
                href={`#${MAIN_ID}`}
                className={`absolute top-[-60px] left-3 z-50 rounded-lg bg-interactive px-3.5 py-2.5 text-interactive-foreground focus:top-3 ${LANDING_FOCUS}`}
            >
                {t("common.skipToContent")}
            </a>
            <LandingHeader signedIn={signedIn} />

            <main id={MAIN_ID}>
                {/* ── Portada ── */}
                <section
                    aria-labelledby="landing-hero-title"
                    className="pt-[clamp(32px,6vw,88px)] pb-[clamp(56px,8vw,112px)]"
                >
                    <div className="landing-wrap grid grid-cols-1 items-center gap-[clamp(40px,6vw,72px)] min-[960px]:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
                        <div>
                            <p className="mb-5 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-base text-muted-foreground">
                                <span
                                    aria-hidden="true"
                                    className={`${LANDING_PIXEL} rounded-[4px] px-[7px] pt-[5px] pb-1 text-foreground ring-1 ring-inset ring-interactive-border`}
                                >
                                    {t("landing.hero.badge")}
                                </span>
                                <span>{t("landing.hero.eyebrow")}</span>
                            </p>
                            <h1 id="landing-hero-title" className="landing-h1">
                                {t("landing.hero.title")}
                            </h1>
                            <p className="landing-lede mt-6">{t("landing.hero.lede")}</p>
                            <p className="landing-pretty mt-3 max-w-[34em] text-[1.0625rem] text-muted-foreground">
                                {t("landing.hero.lede2")}
                            </p>
                            <div className="mt-8">
                                <CtaPair signedIn={signedIn} id={HERO_CTA_ID} />
                            </div>
                            <p className="mt-3.5 text-[0.9375rem] text-muted-foreground">
                                {t.rich("landing.hero.note", { mail })}
                            </p>
                        </div>
                        <CitationSpecimen />
                    </div>
                </section>

                {/* ── PRIMERO · Lo que ya hace ── */}
                <section
                    id={SECTION_IDS.what}
                    aria-labelledby="landing-what-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.s1.marker")}
                            id="landing-what-title"
                            title={t("landing.s1.title")}
                        >
                            <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                                {t("landing.s1.intro")}
                            </p>
                        </SectionHead>
                        <div className="grid grid-cols-1 gap-6 min-[960px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                            <Folio
                                id="landing-folio-tab"
                                title={t("landing.tab.title")}
                                body={t("landing.tab.body")}
                            >
                                <TabularSpecimen />
                            </Folio>
                            <Folio
                                id="landing-folio-word"
                                title={t("landing.word.title")}
                                body={t("landing.word.body")}
                            >
                                <WordSpecimen />
                            </Folio>
                        </div>
                        <FeatureIndex />
                    </div>
                </section>

                {/* ── SEGUNDO · Próximamente ── */}
                <SoonBand />

                {/* ── TERCERO · Confianza ── */}
                <section
                    id={SECTION_IDS.trust}
                    aria-labelledby="landing-trust-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.s3.marker")}
                            id="landing-trust-title"
                            title={t("landing.s3.title")}
                        >
                            <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                                {t("landing.s3.intro")}
                            </p>
                        </SectionHead>
                        <TrustList />
                    </div>
                </section>

                {/* ── CUARTO · Acceso ── */}
                <section
                    id={SECTION_IDS.access}
                    aria-labelledby="landing-access-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.s4.marker")}
                            id="landing-access-title"
                            title={t("landing.s4.title")}
                        >
                            <div className="mt-6 grid justify-items-start gap-6">
                                <p className="landing-pretty max-w-[44ch] text-muted-foreground">
                                    {t.rich("landing.s4.body", { mail })}
                                </p>
                                <CtaPair signedIn={signedIn} />
                            </div>
                        </SectionHead>
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}

