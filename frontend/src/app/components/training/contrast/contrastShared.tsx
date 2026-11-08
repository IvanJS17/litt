"use client";

import { useTranslations } from "next-intl";
import type { TrainingCriteriaContrastRoute } from "@/app/lib/mikeApi";

// Pieces shared by the criteria contrast page and the mentor's section
// (LiTT training layer 3, docs/training.md). The two analyses, the person's
// explanation and the comparison are shown as the server sends them and never
// translated; only the labels around them are. State is carried by words,
// never by color.

export type ComparisonParts = { coincide: string[]; noCoincide: string[]; falto: string[] };

/** The bullets of a stored comparison, per section; «Nada» is no bullet. */
export function comparisonParts(comparison: string): ComparisonParts {
    const parts: ComparisonParts = { coincide: [], noCoincide: [], falto: [] };
    let current: keyof ComparisonParts | null = null;
    for (const raw of comparison.split(/\r?\n/)) {
        const heading = raw.replace(/[#*_:>]/g, "").trim().toLowerCase();
        if (heading === "coincide") { current = "coincide"; continue; }
        if (heading === "no coincide") { current = "noCoincide"; continue; }
        if (heading === "faltó" || heading === "falto") { current = "falto"; continue; }
        const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
        if (!current || !line || /^nada\.?$/i.test(line)) continue;
        parts[current].push(line);
    }
    return parts;
}

/** «Coincide / No coincide / Faltó» of the person's explanation against the AI's, as text under headings. */
export function ComparisonSections({ comparison, idPrefix }: { comparison: string; idPrefix: string }) {
    const t = useTranslations("training.criterion.contrast.card");
    const parts = comparisonParts(comparison);
    const groups: [keyof ComparisonParts, string][] = [
        ["coincide", t("coincide")],
        ["noCoincide", t("noCoincide")],
        ["falto", t("falto")],
    ];
    return (
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
            {groups.map(([key, title]) => (
                <section key={key} className="min-w-0 space-y-1" aria-labelledby={`${idPrefix}-${key}`}>
                    <h5 id={`${idPrefix}-${key}`} className="text-sm font-medium text-gray-900">
                        {title}
                    </h5>
                    {parts[key].length === 0 ? (
                        <p className="text-sm text-gray-500">{t("none")}</p>
                    ) : (
                        <ul className="min-w-0 list-disc space-y-1 pl-5 text-sm text-gray-800">
                            {parts[key].map((line, index) => (
                                <li key={index} className="break-words">
                                    {line}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            ))}
        </div>
    );
}

/** What an analysis ran on: its route, or its neutral approach, and the model. Identifiers the server recorded. */
export function RouteCaption({ route }: { route: TrainingCriteriaContrastRoute | undefined }) {
    const t = useTranslations("training.criterion.contrast.card");
    if (!route) return null;
    return (
        <p className="min-w-0 break-words text-xs text-gray-500">
            {route.name ? t("route", { name: route.name }) : route.approach ? t(`approach.${route.approach}`) : null}
            {route.model ? <>{route.name || route.approach ? " · " : ""}{t("model", { model: route.model })}</> : null}
        </p>
    );
}
