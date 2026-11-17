import { MODELS } from "@mike/client";

/**
 * The model names the page shows in its examples. The ones the app offers with
 * the firm's own key are read from the app's catalog (`@mike/client`), so the
 * page cannot drift from the picker; `landingModels.test.ts` fails if an id
 * leaves the catalog. GLM-Legal (Z.ai, closed weights: OpenRouter only) and the
 * open model the firm installs itself are not in the static catalog.
 */
export const CATALOG_MODEL_IDS = [
    "claude-sonnet-5-5",
    "gpt-6.1-sol",
    "gemini-3.1-pro-preview",
    "mistral-large-4",
] as const;

export function catalogModelName(id: (typeof CATALOG_MODEL_IDS)[number]): string {
    return MODELS.find((model) => model.id === id)?.label ?? id;
}

/**
 * Through OpenRouter: the legal model of Z.ai. Its weights are closed, so it is
 * never offered as something the firm installs. The names are in the catalog
 * (`landing.why.names.*`): they are proper nouns, but the page's i18n guard
 * keeps every visible string out of the code.
 */
export const OPENROUTER_MODEL = { name: "glmlegal", maker: "zai" } as const;

/** On the firm's own server: an open model (Qwen, GLM and DeepSeek are the documented ones). */
export const LOCAL_MODEL = { name: "qwen" } as const;

/** Providers of the keys example (Settings › My AI keys). */
export const KEY_PROVIDERS = [
    { name: "anthropic", saved: true },
    { name: "openai", saved: true },
    { name: "google", saved: false },
    { name: "openrouter", saved: true },
] as const;
