import { useTranslations } from "next-intl";
import { LANDING_RULE } from "./landingStyles";

const ITEMS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/** The eleven features that have no sheet of their own: a numbered index in two columns. */
export function FeatureIndex() {
    const t = useTranslations();
    return (
        <ol
            aria-label={t("landing.index.label")}
            className="mt-[clamp(40px,6vw,72px)] grid grid-cols-1 min-[760px]:grid-cols-2 min-[760px]:gap-x-12"
        >
            {ITEMS.map((n) => (
                <li
                    key={n}
                    className={`grid grid-cols-[2.25rem_1fr] gap-x-2 gap-y-1 border-t py-[18px] ${LANDING_RULE}`}
                >
                    <span className="pt-[0.45em] text-muted-foreground tabular-nums">{n}</span>
                    <h3 className="text-[1.125rem]/[1.35] font-semibold">
                        {t(`landing.index.i${n}.title`)}
                    </h3>
                    <p className="landing-pretty col-start-2 text-[1.0625rem]/[1.5] text-muted-foreground">
                        {t(`landing.index.i${n}.body`)}
                    </p>
                </li>
            ))}
        </ol>
    );
}
