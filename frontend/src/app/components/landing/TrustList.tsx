import { useTranslations } from "next-intl";
import { SOURCE_REPOSITORY_URL } from "./landingConstants";
import { LANDING_FOCUS, LANDING_RULE } from "./landingStyles";

const ITEMS = [1, 2, 3, 4, 5] as const;

/**
 * TERCERO · Confianza: five facts about how LiTT is built, each one something
 * the code shows (README, Principles). No icons, two columns from 760 px.
 */
export function TrustList() {
    const t = useTranslations();
    return (
        <ul className="grid grid-cols-1 min-[760px]:grid-cols-2 min-[760px]:gap-x-12">
            {ITEMS.map((n) => (
                <li key={n} className={`grid gap-2 border-t py-6 ${LANDING_RULE}`}>
                    <h3 className="text-xl/[1.3] font-semibold">{t(`landing.s3.t${n}.title`)}</h3>
                    <p className="landing-pretty max-w-[46ch] text-muted-foreground">
                        {n === 5
                            ? t.rich("landing.s3.t5.body", {
                                  source: (chunks) => (
                                      <a
                                          href={SOURCE_REPOSITORY_URL}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className={`rounded-sm text-foreground underline underline-offset-2 ${LANDING_FOCUS}`}
                                      >
                                          {chunks}
                                      </a>
                                  ),
                              })
                            : t(`landing.s3.t${n}.body` as "landing.s3.t1.body")}
                    </p>
                </li>
            ))}
        </ul>
    );
}
