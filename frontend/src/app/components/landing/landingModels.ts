import { MODELS, routerModelOptions, type ModelToggleOption } from "@mike/client";

/**
 * The model names the page shows in its examples. The ones the app offers with
 * the firm's own key are read from the app's catalog (`@mike/client`), so the
 * page cannot drift from the picker; `landingModels.test.ts` fails if an id
 * leaves the catalog. GLM-Legal (Z.ai, closed weights: OpenRouter only) and the
 * open model the firm installs itself are not in the static catalog.
 *
 * The OpenRouter models of the hero's model menu are not in it either: a firm
 * adds them in Settings, so they are not part of the direct-provider list
 * (`docs/direct-provider-models.md`). Their names are made by the app's own
 * function from the ids, the way the picker does for any saved selection.
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

/** The four Anthropic models the menu counts (names hidden: the group is collapsed). */
export const PICKER_ANTHROPIC_IDS = [
    "claude-fable-5-2",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-sonnet-5-5",
] as const;

/** Model selections a firm saved under OpenRouter (Settings › Models), as OpenRouter writes them. */
export const PICKER_OPENROUTER_IDS = ["deepseek/deepseek-v4-1-flash-1017", "z-ai/glm-5-3-flashx-legal"] as const;

/** The model the menu shows as chosen: the second OpenRouter row, with its app-level id. */
export const PICKER_SELECTED_ID = `openrouter/${PICKER_OPENROUTER_IDS[1]}`;

/** The rows of the hero's open model menu, as the composer's picker builds them. */
export const PICKER_MODELS: readonly ModelToggleOption[] = [
    ...MODELS.filter((model) => (PICKER_ANTHROPIC_IDS as readonly string[]).includes(model.id)),
    ...routerModelOptions("openrouter", PICKER_OPENROUTER_IDS),
];
