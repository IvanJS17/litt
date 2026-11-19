import { useTranslations } from "next-intl";
import "./landing.css";
import { AssistantSpecimen } from "./AssistantSpecimen";
import { CtaPair } from "./LandingCtas";
import { FeatureIndex } from "./FeatureIndex";
import { FeaturePair } from "./FeaturePair";
import { FeatureRow } from "./FeatureRow";
import { FlowsSpecimen } from "./FlowsSpecimen";
import { LandingFooter } from "./LandingFooter";
import { LandingHeader } from "./LandingHeader";
import { LegacyAnchor } from "./LegacyAnchor";
import { ProjectSpecimen } from "./ProjectSpecimen";
import { SectionHead } from "./SectionHead";
import { SoonBand } from "./SoonBand";
import { TabularSpecimen } from "./TabularSpecimen";
import { TrainingBand } from "./TrainingBand";
import { TrustList } from "./TrustList";
import { WhyColumns } from "./WhyColumns";
import { WordSpecimen } from "./WordSpecimen";
import {
    HERO_CTA_ID,
    MAIN_ID,
    SECTION_IDS,
    SKIP_LINK_ID,
    SOURCE_REPOSITORY_URL,
    SUPPORT_EMAIL,
} from "./landingConstants";
import { LANDING_FOCUS, LANDING_PIXEL, LANDING_SECTION } from "./landingStyles";

/**
 * The public start page (`/`): what LiTT is, what it does today, why it is
 * different, what is coming, how it is built and how to get in. The same page
 * with or without a session; only the main button changes ("Iniciar sesión" →
 * /login, "Abrir LiTT" → /assistant), and it is decided on the server, so it
 * never flickers. Static text and fictitious examples: it calls no API.
 *
 * The order: Portada (the assistant at work), PRIMERO Formación (the inverted
 * band), SEGUNDO Funciones (four rows and the Donna / Claude-or-ChatGPT pair),
 * TERCERO Por qué LiTT, CUARTO Próximamente, QUINTO Confianza, SEXTO Acceso
 * (SPEC v2 §1, with Formación moved up by the owner on 18 Nov 2026).
 */
export function LandingPage({ signedIn }: { signedIn: boolean }) {
    const t = useTranslations();
    const link = `rounded-sm text-foreground underline underline-offset-2 ${LANDING_FOCUS}`;
    const mail = (chunks: React.ReactNode) => (
        <a href={`mailto:${SUPPORT_EMAIL}`} className={link}>
            {chunks}
        </a>
    );
    const github = (chunks: React.ReactNode) => (
        <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className={link}>
            {chunks}
        </a>
    );
    const bold = (chunks: React.ReactNode) => <b>{chunks}</b>;

    return (
        <div className="landing-root min-h-dvh bg-surface-desk font-serif text-[1.125rem]/[1.55] text-foreground [font-optical-sizing:auto]">
            <a
                id={SKIP_LINK_ID}
                href={`#${MAIN_ID}`}
                className={`absolute top-[-60px] left-3 z-50 rounded-lg bg-interactive px-3.5 py-2.5 text-interactive-foreground focus:top-3 ${LANDING_FOCUS}`}
            >
                {t("common.skipToContent")}
            </a>
            <LegacyAnchor />
            <LandingHeader signedIn={signedIn} />

            <main id={MAIN_ID}>
                {/* ── Portada: el asistente ── */}
                <section
                    aria-labelledby="landing-hero-title"
                    className="pt-[clamp(28px,5vw,72px)] pb-[clamp(56px,8vw,112px)]"
                >
                    <div className="landing-wrap">
                        <div className="grid grid-cols-1 items-start gap-x-16 gap-y-6 min-[960px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                            <p className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-base text-muted-foreground min-[960px]:col-span-full">
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
                            <div className="min-[960px]:pt-[0.6em]">
                                <p className="landing-lede">{t("landing.hero.lede")}</p>
                                <p className="landing-pretty mt-3 max-w-[34em] text-[1.0625rem] text-muted-foreground">
                                    {t("landing.hero.lede2")}
                                </p>
                                <div className="mt-7">
                                    <CtaPair signedIn={signedIn} id={HERO_CTA_ID} />
                                </div>
                                <p className="mt-3.5 text-[0.9375rem] text-muted-foreground">
                                    {t.rich("landing.hero.note", { mail })}
                                </p>
                            </div>
                        </div>
                        <div className="mt-[clamp(36px,5vw,64px)]">
                            <AssistantSpecimen />
                        </div>
                    </div>
                </section>

                {/* ── PRIMERO · Formación ── */}
                <TrainingBand />

                {/* ── SEGUNDO · Funciones ── */}
                <section
                    id={SECTION_IDS.features}
                    aria-labelledby="landing-features-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.features.marker")}
                            id="landing-features-title"
                            title={t("landing.features.title")}
                        >
                            <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                                {t("landing.features.intro")}
                            </p>
                        </SectionHead>
                        <div>
                            <FeatureRow
                                n={1}
                                id="landing-feature-assistant"
                                title={t("landing.features.assistant.title")}
                                body={t("landing.features.assistant.body")}
                                also={t.rich("landing.features.assistant.also", { b: bold })}
                            >
                                <WordSpecimen />
                            </FeatureRow>
                            <FeatureRow
                                n={2}
                                id="landing-feature-projects"
                                title={t("landing.features.projects.title")}
                                body={t("landing.features.projects.body")}
                            >
                                <ProjectSpecimen />
                            </FeatureRow>
                            <FeatureRow
                                n={3}
                                id="landing-feature-tabular"
                                title={t("landing.features.tabular.title")}
                                body={t("landing.features.tabular.body")}
                            >
                                <TabularSpecimen />
                            </FeatureRow>
                            <FeatureRow
                                n={4}
                                id="landing-feature-flows"
                                title={t("landing.features.flows.title")}
                                body={t("landing.features.flows.body")}
                            >
                                <FlowsSpecimen />
                            </FeatureRow>
                        </div>
                        <FeaturePair />
                    </div>
                </section>

                {/* ── TERCERO · Por qué LiTT ── */}
                <section
                    id={SECTION_IDS.why}
                    aria-labelledby="landing-why-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.why.marker")}
                            id="landing-why-title"
                            title={t("landing.why.title")}
                        >
                            <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                                {t("landing.why.intro")}
                            </p>
                        </SectionHead>
                        <WhyColumns />
                        <FeatureIndex />
                    </div>
                </section>

                {/* ── CUARTO · Próximamente ── */}
                <SoonBand />

                {/* ── QUINTO · Confianza ── */}
                <section
                    id={SECTION_IDS.trust}
                    aria-labelledby="landing-trust-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.trust.marker")}
                            id="landing-trust-title"
                            title={t("landing.trust.title")}
                        >
                            <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                                {t("landing.trust.intro")}
                            </p>
                        </SectionHead>
                        <TrustList />
                    </div>
                </section>

                {/* ── SEXTO · Acceso ── */}
                <section
                    id={SECTION_IDS.access}
                    aria-labelledby="landing-access-title"
                    className={LANDING_SECTION}
                >
                    <div className="landing-wrap">
                        <SectionHead
                            marker={t("landing.access.marker")}
                            id="landing-access-title"
                            title={t("landing.access.title")}
                        >
                            <div className="mt-6 grid justify-items-start gap-6">
                                <p className="landing-pretty max-w-[44ch] text-muted-foreground">
                                    {t.rich("landing.access.body", { mail })}
                                </p>
                                <CtaPair signedIn={signedIn} />
                                <p className="landing-pretty max-w-[46ch] text-muted-foreground">
                                    {t.rich("landing.access.self", { github })}
                                </p>
                            </div>
                        </SectionHead>
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
}
