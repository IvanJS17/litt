import Image from "next/image";
import { Plug, type LucideIcon } from "lucide-react";
import type { ApiKeyProvider } from "@/app/lib/mikeApi";
import type { Translate } from "@/i18n/Translate";
import type { ByokProvider } from "./ByokProviderModal";

// The model providers a key can be saved for, in the order they are listed.
// Shared by a person's Bring Your Own Keys page and an organization's Model
// Providers tab, so the two always offer the same providers under the same
// names.

export type ModelApiKeyField = {
    provider: ApiKeyProvider;
    name: string;
    /** A vendored provider logo, or a Lucide icon where there is no brand. */
    logo?: string;
    icon?: LucideIcon;
};

export const MODEL_API_KEY_FIELDS: readonly ModelApiKeyField[] = [
    {
        provider: "claude",
        name: "Anthropic (Claude)",
        logo: "anthropic",
    },
    {
        provider: "gemini",
        name: "Google (Gemini)",
        logo: "gemini-color",
    },
    {
        provider: "openai",
        name: "OpenAI",
        logo: "openai",
    },
    {
        provider: "mistral",
        name: "Mistral AI",
        logo: "mistral-color",
    },
    {
        provider: "xai",
        name: "xAI",
        logo: "xai",
    },
    {
        provider: "bedrock",
        name: "Amazon Bedrock",
        logo: "bedrock-color",
    },
    {
        provider: "azure",
        name: "Azure OpenAI",
        logo: "azure-color",
    },
    {
        provider: "azure-foundry",
        name: "Azure AI Foundry",
        logo: "azureai-color",
    },
    {
        provider: "vertex",
        name: "Google Vertex AI",
        logo: "vertexai-color",
    },
    {
        provider: "openrouter",
        name: "OpenRouter",
        logo: "openrouter-color",
    },
    {
        provider: "vercel",
        name: "Vercel AI Gateway",
        logo: "vercel",
    },
    {
        provider: "opencode-go",
        name: "OpenCode Go",
        logo: "opencode",
    },
    {
        provider: "custom",
        name: "OpenAI-compatible endpoint",
        icon: Plug,
    },
];

/** The provider as the interface names it. Most are brand names; the custom endpoint is a description, so it is translated. */
export function providerName(t: Translate, field: ModelApiKeyField): string {
    return field.provider === "custom" ? t("settings.modelProviders.customEndpoint") : field.name;
}

/** The provider as the key dialog labels it. */
export function byokProvider(t: Translate, field: ModelApiKeyField): ByokProvider {
    const name = providerName(t, field);
    const vertex = field.provider === "vertex";
    return {
        provider: field.provider,
        name,
        label: t(vertex ? "settings.modelProviders.serviceAccountKey" : "settings.modelProviders.apiKey", { name }),
        keyLabel: vertex ? t("settings.modelProviders.serviceAccountKeyJson") : undefined,
    };
}

/** A provider's logo, or a pulsing stand-in while its state is loading. */
export function ModelProviderIcon({
    field,
    loading = false,
}: {
    field: ModelApiKeyField;
    loading?: boolean;
}) {
    if (loading)
        return <span className="h-7 w-7 animate-pulse rounded-lg bg-gray-200" />;
    const Icon = field.icon;
    if (Icon)
        return <Icon aria-hidden="true" className="h-6 w-6 text-gray-500" />;
    return (
        <Image
            src={`/icons/providers/${field.logo}.svg`}
            alt=""
            width={28}
            height={28}
            className={field.logo?.endsWith("-color") ? "" : "dark:invert"}
        />
    );
}
