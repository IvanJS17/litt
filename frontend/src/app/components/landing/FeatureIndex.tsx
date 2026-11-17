import { useTranslations } from "next-intl";
import { LANDING_RULE } from "./landingStyles";

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

/**
 * «Hecho para la práctica mexicana»: what LiTT adds for a firm in Mexico, a
 * numbered index in two columns from 760 px (an h3 for the block, an h4 per
 * item).
 */
export function FeatureIndex() {
    const t = useTranslations();
    return (
        <div className="mt-[clamp(48px,7vw,88px)]">
            <h3 id="landing-own-title" className="landing-h3">
                {t("landing.own.title")}
            </h3>
            <p className="landing-pretty mt-2 max-w-[62ch] text-muted-foreground">{t("landing.own.intro")}</p>
            <ol
                aria-labelledby="landing-own-title"
                className="mt-6 grid grid-cols-1 min-[760px]:grid-cols-2 min-[760px]:gap-x-12"
            >
                {ITEMS.map((n) => (
                    <li
                        key={n}
                        className={`grid grid-cols-[2.25rem_1fr] gap-x-2 gap-y-1 border-t py-[18px] ${LANDING_RULE}`}
                    >
                        <span className="pt-[0.45em] text-muted-foreground tabular-nums">{n}</span>
                        <h4 className="text-[1.125rem]/[1.35] font-semibold">{t(`landing.own.o${n}.title`)}</h4>
                        <p className="landing-pretty col-start-2 text-[1.0625rem]/[1.5] text-muted-foreground">
                            {t(`landing.own.o${n}.body`)}
                        </p>
                    </li>
                ))}
            </ol>
        </div>
    );
}
