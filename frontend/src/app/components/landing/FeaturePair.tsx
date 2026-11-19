import { useTranslations } from "next-intl";
import { LANDING_RULE } from "./landingStyles";

const CAPS = ["i1", "i2", "i3", "i4", "i5", "i6"] as const;

/**
 * «Además, para el cliente y desde tu IA»: Donna and LiTT from Claude or
 * ChatGPT, two cards after the four feature rows. Both are in production; the
 * capabilities of Donna are plain text, not pills.
 */
export function FeaturePair() {
    const t = useTranslations();
    return (
        <div className={`border-t pt-[clamp(32px,5vw,56px)] ${LANDING_RULE}`}>
            <h3 id="landing-pair-title" className="landing-h3">
                {t("landing.pair.title")}
            </h3>
            <div className="mt-8 grid grid-cols-1 gap-[clamp(24px,3vw,40px)] min-[960px]:grid-cols-2">
                <article
                    aria-labelledby="landing-pair-donna"
                    className="grid content-start gap-3 rounded-[20px] bg-surface-sheet p-[clamp(20px,3vw,36px)] shadow-elev-sheet"
                >
                    <h4 id="landing-pair-donna" className="text-2xl/[1.2] font-semibold text-balance">
                        {t("landing.pair.donna.title")}
                    </h4>
                    <p className="landing-pretty text-muted-foreground">{t("landing.pair.donna.body")}</p>
                    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-base">
                        {CAPS.map((cap) => (
                            <li key={cap}>{t(`landing.pair.donna.caps.${cap}`)}</li>
                        ))}
                    </ul>
                    <p className="landing-pretty text-[0.9375rem]/[1.5] text-muted-foreground">
                        {t("landing.pair.donna.note")}
                    </p>
                </article>
                <article
                    aria-labelledby="landing-pair-claude"
                    className="grid content-start gap-3 rounded-[20px] bg-surface-sheet p-[clamp(20px,3vw,36px)] shadow-elev-sheet"
                >
                    <h4 id="landing-pair-claude" className="text-2xl/[1.2] font-semibold text-balance">
                        {t("landing.pair.claude.title")}
                    </h4>
                    <p className="landing-pretty text-muted-foreground">{t("landing.pair.claude.body")}</p>
                    <p className="landing-pretty text-[0.9375rem]/[1.5] text-muted-foreground">
                        {t("landing.pair.claude.note")}
                    </p>
                </article>
            </div>
        </div>
    );
}
