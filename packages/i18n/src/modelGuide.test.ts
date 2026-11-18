import { describe, expect, it } from "vitest";
import enUS from "../messages/en-US.json";
import esMX from "../messages/es-MX.json";

const LEVEL_KEYS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
// Older or deprecated: the guide recommends neither.
const MODELS_WITHOUT_RECOMMENDATION = ["claude-fable-5-1", "mistral-medium-3-5"] as const;

type Guide = {
    models: Record<string, { hint?: string; useFor?: string; notice?: string }>;
    levels: Record<string, string>;
    [key: string]: unknown;
};

// The keys the picker reads: «gpt-6.1-sol» is «gpt-6-1-sol» (modelGuideKey).
const RECOMMENDED = [
    "claude-fable-5-2",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
    "gemini-3-1-pro-preview",
    "gemini-3-8-flash",
    "gpt-6-1-sol",
    "gpt-6-astra",
    "gpt-6-luna",
    "mistral-large-4",
    "mistral-small-2603",
];

describe.each([
    ["es-MX", esMX.modelGuide as Guide],
    ["en-US", enUS.modelGuide as Guide],
])("modelGuide in %s", (_locale, guide) => {
    it("keeps each text within its length", () => {
        for (const [id, m] of Object.entries(guide.models)) {
            expect(m.hint?.length ?? 0, `${id}.hint`).toBeLessThanOrEqual(42);
            expect(m.useFor?.length ?? 0, `${id}.useFor`).toBeLessThanOrEqual(90);
            expect(m.notice?.length ?? 0, `${id}.notice`).toBeLessThanOrEqual(90);
        }
        for (const level of LEVEL_KEYS) {
            expect(guide.levels[level]?.length ?? 0, level).toBeGreaterThan(0);
            expect(guide.levels[level]!.length, level).toBeLessThanOrEqual(60);
        }
    });

    it("recommends the current models and none of the older ones", () => {
        for (const id of RECOMMENDED) expect(guide.models[id]?.hint, id).toBeTruthy();
        for (const id of MODELS_WITHOUT_RECOMMENDATION) {
            expect(guide.models[id]?.hint).toBeUndefined();
            expect(guide.models[id]?.useFor).toBeUndefined();
        }
        expect(Object.keys(guide.models).sort()).toEqual(
            [...RECOMMENDED, "claude-fable-5-1", "openrouter-z-ai-glm-5-3-flashx-legal"].sort(),
        );
    });

    it("warns about the 30-day retention of both Fable models", () => {
        expect(guide.models["claude-fable-5-2"]!.notice).toMatch(/30/);
        expect(guide.models["claude-fable-5-1"]!.notice).toMatch(/30/);
    });

    it("warns that GLM 5.3 FlashX Legal does not publish its jurisdictions", () => {
        const glm = guide.models["openrouter-z-ai-glm-5-3-flashx-legal"]!;
        expect(glm.notice).toMatch(/Mexican|mexicano/);
        expect(glm.useFor).toMatch(/OpenRouter/);
    });

    it("never promises verifiable sources", () => {
        expect(JSON.stringify(guide)).not.toMatch(/fuentes verificables|verifiable sources/i);
    });
});

describe("modelGuide recommendation (es-MX)", () => {
    it("starts from Sonnet 5.5 at Medium and says when to go up", () => {
        expect(esMX.modelGuide.recommended).toBe(
            "Para empezar: Claude Sonnet 5.5 en Medio para el trabajo diario; sube a Alto para análisis complejos.",
        );
    });
});
