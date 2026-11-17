import { useLocale, useTranslations } from "next-intl";
import {
    LANDING_BUTTON_SECONDARY,
    LANDING_BUTTON_SIZE,
    LANDING_FOCUS,
    LANDING_RULE,
    LANDING_TAG,
} from "./landingStyles";
import { accessFormHref, SECTION_IDS, type AccessOrigin } from "./landingConstants";
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

/** "Me interesa": a small link to the questionnaire that says which card sent the visitor. */
function InterestLink({ origen, title }: { origen: AccessOrigin; title: string }) {
    const t = useTranslations();
    const locale = useLocale();
    return (
        <a
            href={accessFormHref(origen, locale)}
            rel="noopener noreferrer"
            className={`inline-flex min-h-11 w-fit items-center rounded-sm text-base text-foreground underline decoration-interactive-border underline-offset-4 ${LANDING_FOCUS}`}
        >
            {t("landing.soon.interest")}
            <span className="sr-only">: {title}</span>
        </a>
    );
}

function SoonItem({
    title,
    body,
    note,
    origen,
}: {
    title: string;
    body: string;
    note?: string;
    origen: AccessOrigin;
}) {
    return (
        <article
            className={`grid content-start gap-2.5 border-b py-7 last:border-b-0 min-[960px]:border-b-0 min-[960px]:pt-10 min-[960px]:pb-0 ${LANDING_RULE}`}
        >
            <SoonTag />
            <h3 className="landing-pretty text-2xl/[1.2] font-semibold text-balance">{title}</h3>
            <p className="landing-pretty text-muted-foreground">{body}</p>
            {note ? (
                <p className="landing-pretty text-[0.9375rem]/[1.5] text-muted-foreground">{note}</p>
            ) : null}
            <InterestLink origen={origen} title={title} />
        </article>
    );
}

/**
 * The second spotlight: intake for in-house legal teams. It has its own
 * surface (the sheet of the law citation) and its own button, because it is
 * not a feature of the firm's product but a track that opens when there is
 * demand: the button is the waitlist.
 */
function InhouseSpotlight() {
    const t = useTranslations();
    const locale = useLocale();
    return (
        <article
            aria-labelledby="landing-inhouse-title"
            className="mt-[clamp(32px,5vw,64px)] grid gap-6 rounded-2xl bg-surface-sheet p-[clamp(24px,4vw,48px)] shadow-elev-float min-[960px]:grid-cols-[minmax(0,1fr)_auto] min-[960px]:items-end"
        >
            <div className="grid content-start gap-3">
                <SoonTag />
                <h3
                    id="landing-inhouse-title"
                    className="landing-pretty max-w-[24ch] text-[clamp(1.75rem,1.3rem+1.6vw,2.75rem)]/[1.1] font-semibold text-balance"
                >
                    {t("landing.inhouse.title")}
                </h3>
                <p className="landing-pretty max-w-[52ch] text-muted-foreground">{t("landing.inhouse.body")}</p>
            </div>
            <a
                href={accessFormHref("inhouse", locale)}
                rel="noopener noreferrer"
                className={`${LANDING_BUTTON_SECONDARY} ${LANDING_BUTTON_SIZE} w-full min-[960px]:w-auto`}
            >
                {t("landing.inhouse.join")}
            </a>
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
 * page. MCP, Donna and the connectors follow in a row from 960 px, and the
 * in-house waitlist closes the band as its own card with its own button.
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
                        <div className="mt-1">
                            <InterestLink origen="soon-contextlex" title={t("landing.cl.name")} />
                        </div>
                    </div>
                    <LawCitationCard />
                </div>

                <div className="mt-[clamp(8px,2vw,16px)] grid grid-cols-1 min-[960px]:grid-cols-3 min-[960px]:gap-x-10">
                    <SoonItem
                        title={t("landing.mcp.title")}
                        body={t("landing.mcp.body")}
                        note={t("landing.mcp.note")}
                        origen="soon-mcp"
                    />
                    <SoonItem title={t("landing.donna.title")} body={t("landing.donna.body")} origen="soon-donna" />
                    <SoonItem
                        title={t("landing.connectors.title")}
                        body={t("landing.connectors.body")}
                        note={t("landing.connectors.note")}
                        origen="soon-conectores"
                    />
                </div>

                <InhouseSpotlight />
            </div>
        </section>
    );
}
