import { useLocale, useTranslations } from "next-intl";
import {
    LANDING_BUTTON_SECONDARY,
    LANDING_BUTTON_SIZE,
    LANDING_FOCUS,
    LANDING_RULE,
} from "./landingStyles";
import { accessFormHref, SECTION_IDS } from "./landingConstants";
import { SectionHead } from "./SectionHead";
import { TrainingSpecimen } from "./TrainingSpecimens";

const STEPS = ["s1", "s2", "s3"] as const;

/** «Todo lo que incluye»: the four groups, each with its items (ids of `landing.training.items`). */
const GROUPS = [
    { id: "pupil", items: ["turn", "hints", "map"] },
    { id: "junior", items: ["accountability", "annex"] },
    { id: "mentor", items: ["review", "defense", "pass", "promotion", "gym"] },
    { id: "firm", items: ["seal", "stages", "criteria"] },
] as const;

/**
 * PRIMERO · Formación (variant B). The inverted band: it takes the tokens of
 * the other theme on its own container (landing.css `.landing-band`), tinta
 * with papel letters on the light page and papel with tinta letters on the
 * dark one. Three steps with their example, then «Todo lo que incluye la
 * formación» in a disclosure (the gym among them), the privacy line and the
 * button to the questionnaire (`origen=formacion`).
 */
export function TrainingBand() {
    const t = useTranslations();
    const locale = useLocale();
    return (
        <section
            id={SECTION_IDS.training}
            aria-labelledby="landing-training-title"
            className="landing-band bg-surface-desk py-[clamp(64px,9vw,128px)] text-foreground"
        >
            <div className="landing-wrap">
                <SectionHead
                    marker={t("landing.training.marker")}
                    id="landing-training-title"
                    title={t("landing.training.title")}
                >
                    <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                        {t("landing.training.intro")}
                    </p>
                </SectionHead>

                <ol className="grid grid-cols-1 gap-[clamp(32px,4vw,56px)] min-[960px]:grid-cols-3">
                    {STEPS.map((step, index) => (
                        <li key={step} className="grid content-start gap-3">
                            <p aria-hidden="true" className="text-base text-muted-foreground tabular-nums">
                                {index + 1}
                            </p>
                            <h3 className="landing-h3">{t(`landing.training.steps.${step}.title`)}</h3>
                            <p className="landing-pretty text-muted-foreground">
                                {t(`landing.training.steps.${step}.body`)}
                            </p>
                            <TrainingSpecimen step={step} />
                        </li>
                    ))}
                </ol>

                <details className="group mt-[clamp(40px,6vw,72px)]">
                    <summary
                        className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm text-[1.0625rem] font-medium underline decoration-interactive-border underline-offset-4 [&::-webkit-details-marker]:hidden ${LANDING_FOCUS}`}
                    >
                        <span
                            aria-hidden="true"
                            className="inline-block transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                        >
                            ›
                        </span>
                        {t("landing.training.more")}
                    </summary>
                    <div
                        className={`mt-6 grid grid-cols-1 gap-x-10 gap-y-8 border-t pt-8 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-4 ${LANDING_RULE}`}
                    >
                        {GROUPS.map((group) => (
                            <section key={group.id} aria-labelledby={`landing-training-group-${group.id}`} className="grid content-start gap-3">
                                <div>
                                    <h3 id={`landing-training-group-${group.id}`} className="text-[1.125rem]/[1.35] font-semibold">
                                        {t(`landing.training.groups.${group.id}.title`)}
                                    </h3>
                                    <p className="text-base text-muted-foreground">
                                        {t(`landing.training.groups.${group.id}.lead`)}
                                    </p>
                                </div>
                                <ul className="grid gap-4">
                                    {group.items.map((item) => (
                                        <li key={item}>
                                            <h4 className="text-base font-semibold">
                                                {t(`landing.training.items.${item}.title`)}
                                            </h4>
                                            <p className="landing-pretty text-[0.9375rem]/[1.5] text-muted-foreground">
                                                {t(`landing.training.items.${item}.body`)}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        ))}
                    </div>
                </details>

                <div className={`mt-[clamp(32px,5vw,56px)] grid justify-items-start gap-5 border-t pt-8 ${LANDING_RULE}`}>
                    <p className="landing-pretty max-w-[62ch] text-muted-foreground">{t("landing.training.privacy")}</p>
                    <a
                        href={accessFormHref("formacion", locale)}
                        rel="noopener noreferrer"
                        className={`${LANDING_BUTTON_SECONDARY} ${LANDING_BUTTON_SIZE}`}
                    >
                        {t("landing.training.interest")}
                    </a>
                </div>
            </div>
        </section>
    );
}
