import { useTranslations } from "next-intl";
import { LANDING_RULE, LANDING_TAG } from "./landingStyles";
import { SECTION_IDS } from "./landingConstants";
import { SectionHead } from "./SectionHead";

/** "Próximamente": the Departure detail with its ring, and the same words for a screen reader. */
export function SoonTag() {
    const t = useTranslations();
    return (
        <span className="inline-flex w-fit">
            <span aria-hidden="true" className={LANDING_TAG}>
                {t("landing.soon.tag")}
            </span>
            <span className="sr-only">{t("landing.soon.tag")}</span>
        </span>
    );
}

function SoonItem({ title, body }: { title: string; body: string }) {
    return (
        <article
            className={`grid content-start gap-2.5 border-b py-7 last:border-b-0 min-[960px]:border-b-0 min-[960px]:pt-10 min-[960px]:pb-0 ${LANDING_RULE}`}
        >
            <SoonTag />
            <h3 className="landing-pretty text-2xl/[1.2] font-semibold text-balance">{title}</h3>
            <p className="landing-pretty text-muted-foreground">{body}</p>
        </article>
    );
}

/**
 * The illustration of a future citation of the law: «ContextLex MX · Código
 * Civil Federal», article 2398 and its text. The one real citation on the page;
 * the caption says it is an illustration and that the function is not there yet.
 */
function LawCitationCard() {
    const t = useTranslations();
    return (
        <figure
            aria-labelledby="landing-law-caption"
            className="m-0 rounded-2xl bg-surface-sheet px-5 py-[18px] font-sans shadow-elev-float"
        >
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs/[1.4] font-medium text-muted-foreground">
                <b lang="es" className="font-semibold text-foreground">
                    {t("landing.cl.name")}
                </b>
                <span aria-hidden="true">·</span>
                <span>{t("landing.cl.code")}</span>
            </div>
            <p className="mt-2.5 font-serif text-lg/[1.3] font-semibold">
                {t("landing.cl.article")}
            </p>
            <blockquote lang="es" className="landing-pretty mt-1.5 font-serif text-base/[1.55]">
                {t("landing.cl.text")}
            </blockquote>
            <figcaption
                id="landing-law-caption"
                className="mt-3 border-t border-foreground/14 pt-2.5 text-xs/[1.4] text-muted-foreground"
            >
                {t("landing.cl.caption")}
            </figcaption>
        </figure>
    );
}

/**
 * TERCERO · Próximamente. The band takes the tokens of the other theme on its
 * own container (landing.css `.landing-band`), so it is tinta with papel
 * letters on the light page and papel with tinta letters on the dark one.
 * ContextLex MX is the lead: its name on one line, at the largest size of the
 * page. The other three follow in a row from 960 px.
 */
export function SoonBand() {
    const t = useTranslations();
    return (
        <section
            id={SECTION_IDS.soon}
            aria-labelledby="landing-soon-title"
            className="landing-band bg-surface-desk py-[clamp(64px,9vw,128px)] text-foreground"
        >
            <div className="landing-wrap">
                <SectionHead
                    marker={t("landing.soon.marker")}
                    id="landing-soon-title"
                    title={t("landing.soon.title")}
                >
                    <p className="landing-pretty mt-4 max-w-[62ch] text-muted-foreground">
                        {t("landing.soon.intro")}
                    </p>
                </SectionHead>

                <div
                    className={`grid grid-cols-1 gap-[clamp(32px,5vw,64px)] border-b pb-[clamp(48px,7vw,88px)] min-[960px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] min-[960px]:items-start ${LANDING_RULE}`}
                >
                    <div className="min-[960px]:col-span-full -mb-[clamp(8px,2vw,24px)]">
                        <SoonTag />
                        <h3 lang="es" className="landing-contextlex mt-5">
                            {t("landing.cl.name")}
                        </h3>
                    </div>
                    <div>
                        <p className="max-w-[26ch] text-[clamp(1.25rem,1.1rem+0.7vw,1.625rem)]/[1.35] text-balance">
                            {t("landing.cl.line")}
                        </p>
                        <p className="landing-pretty mt-4 max-w-[46ch] text-muted-foreground">
                            {t("landing.cl.body")}
                        </p>
                    </div>
                    <LawCitationCard />
                </div>

                <div className="mt-[clamp(8px,2vw,16px)] grid grid-cols-1 min-[960px]:grid-cols-3 min-[960px]:gap-x-10">
                    <SoonItem title={t("landing.mcp.title")} body={t("landing.mcp.body")} />
                    <SoonItem title={t("landing.donna.title")} body={t("landing.donna.body")} />
                    <SoonItem title={t("landing.google.title")} body={t("landing.google.body")} />
                </div>
            </div>
        </section>
    );
}
