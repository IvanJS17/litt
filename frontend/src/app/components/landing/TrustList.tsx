import { useTranslations } from "next-intl";
import { LANDING_RULE } from "./landingStyles";

const ITEMS = [1, 2, 3] as const;

/**
 * CUARTO · Confianza: three facts about how LiTT is built, each one something
 * the code shows (README, Principles). No icons, three columns from 760 px. The
 * model and the code, which used to be here, now have their place in SEGUNDO.
 */
export function TrustList() {
    const t = useTranslations();
    return (
        <ul className="grid grid-cols-1 min-[760px]:grid-cols-3 min-[760px]:gap-x-12">
            {ITEMS.map((n) => (
                <li key={n} className={`grid content-start gap-2 border-t py-6 ${LANDING_RULE}`}>
                    <h3 className="text-xl/[1.3] font-semibold">{t(`landing.trust.i${n}.title`)}</h3>
                    <p className="landing-pretty max-w-[46ch] text-muted-foreground">{t(`landing.trust.i${n}.body`)}</p>
                </li>
            ))}
        </ul>
    );
}
