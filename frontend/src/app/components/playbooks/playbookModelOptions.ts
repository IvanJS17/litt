import {
    allRouterModelOptions,
    SETTINGS_MODELS,
    type ModelOption,
    type RouterSelections,
} from "@mike/client";
import { isModelAvailable } from "@/app/lib/modelAvailability";
import type {
    ApiKeyState,
    PlaybookConfiguration,
} from "@/app/lib/mikeApi";

/**
 * Every model a playbook menu can offer, from the same sources as the chat's
 * picker (docs/playbooks.md, "Model selection"): the built-in models, each
 * router's saved Model Selections (OpenRouter, Vercel, Bedrock, a custom
 * endpoint…), discovered local models and the deployment's configured models.
 * A configured model replaces a catalog row with the same id.
 */
export function playbookModelCatalog(sources: {
    routerSelections: Partial<RouterSelections>;
    ollama: readonly ModelOption[];
    configured: readonly ModelOption[];
}): ModelOption[] {
    const configuredIds = new Set(sources.configured.map((model) => model.id));
    return [
        ...[
            ...SETTINGS_MODELS,
            ...allRouterModelOptions(sources.routerSelections),
            ...sources.ollama,
        ].filter((model) => !configuredIds.has(model.id)),
        ...sources.configured,
    ];
}

export function buildPlaybookModelOptions(
    catalog: ModelOption[],
    configuration: PlaybookConfiguration | null,
    apiKeys?: ApiKeyState,
    /** The deployment's configured models, offered as the chat offers them. */
    configuredModelIds: readonly string[] = [],
): Array<{ value: string; label: string }> {
    if (!configuration) return [];
    const serverAvailable = new Set(configuration.availableModelIds);
    return catalog
        .filter(
            (model) =>
                serverAvailable.has(model.id) ||
                configuredModelIds.includes(model.id) ||
                (!!apiKeys && isModelAvailable(model.id, apiKeys)),
        )
        .map((model) => ({
            value: model.id,
            label: `${model.group} · ${model.label}`,
        }));
}
