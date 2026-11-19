"use client";

import { useCallback, useMemo } from "react";
import { useTranslations } from "use-intl";
import { modelGuideKey, type ModelToggleOption } from "@mike/client";
import { REASONING_LEVELS, type ReasoningLevel } from "./ModelToggleUI";

/** What the guide says about one model; every text comes from `modelGuide`. */
export interface ModelGuideEntry {
    /** One line for the picker; absent for a model with no recommendation. */
    hint?: string;
    useFor?: string;
    /** A data-retention notice the provider requires us to show. */
    notice?: string;
}

/**
 * Reads the model guide from the catalog (`modelGuide.*` in @litt/i18n). A
 * model with no entry there, such as one a firm configured itself, has no
 * guide text and the picker shows its name alone. Shared by the web and the
 * Word add-in so both say the same thing.
 */
export function useModelGuide() {
    const typed = useTranslations();
    // Model ids make the key at run time, so the typed key check cannot
    // apply; every key read here is pinned by the catalog tests.
    const t = typed as unknown as ((
        key: string,
        values?: Record<string, string>,
    ) => string) & { has: (key: string) => boolean };
    const entryFor = useCallback(
        (modelId: string): ModelGuideEntry | null => {
            const key = `modelGuide.models.${modelGuideKey(modelId)}`;
            const read = (field: string) =>
                t.has(`${key}.${field}`) ? t(`${key}.${field}`) : undefined;
            const entry = {
                hint: read("hint"),
                useFor: read("useFor"),
                notice: read("notice"),
            };
            return entry.hint || entry.useFor || entry.notice ? entry : null;
        },
        [t],
    );
    /** The models with the guide's one-line hint added where there is one. */
    const withHints = useCallback(
        <M extends ModelToggleOption>(models: readonly M[]): M[] =>
            models.map((model) => {
                const hint = entryFor(model.id)?.hint;
                return hint ? { ...model, hint } : model;
            }),
        [entryFor],
    );
    const levelHints = useMemo(
        () =>
            Object.fromEntries(
                REASONING_LEVELS.map((level) => [
                    level,
                    t(`modelGuide.levels.${level}`),
                ]),
            ) as Record<ReasoningLevel, string>,
        [t],
    );
    return {
        entryFor,
        withHints,
        levelHints,
        recommended: t("modelGuide.recommended"),
        intro: t("modelGuide.intro"),
        availability: t("modelGuide.availability"),
        retention: t("modelGuide.retention"),
        disclaimer: t("modelGuide.disclaimer"),
        updated: t("modelGuide.updated"),
    };
}
