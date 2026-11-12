import type { ProviderSettings } from "../llm";
import type { WebSearchBackend } from "../webSearch";
import type { OcrProvider } from "../ocr/provider";
export type ApiKeyProvider =
    | "claude"
    | "gemini"
    | "openai"
    | "mistral"
    | "openrouter"
    | "vercel"
    | "opencode-go"
    | "opencode-zen"
    | "bedrock"
    | "azure"
    | "azure-foundry"
    | "vertex"
    | "xai"
    | "custom"
    | WebSearchBackend
    | OcrProvider;
export type ApiKeySource = "user" | "org" | "env" | null;
/**
 * Whose key a row is. A person's keys and an organization's keys have the
 * same shape, encryption and rules, in two tables; everything below reads
 * and writes either through this, so there is one implementation of both.
 */
export type ApiKeyOwner =
    | { kind: "user"; id: string }
    | { kind: "org"; id: string };
/** Providers whose key is only usable together with a non-secret setting. */
export type SettingsApiKeyProvider = keyof ProviderSettings;
export type ApiKeyStatus = Record<ApiKeyProvider, boolean> & {
    sources: Record<ApiKeyProvider, ApiKeySource>;
    enabled: Partial<Record<ApiKeyProvider, boolean>>;
    /**
     * The settings saved with the user's own key. Deployment (env) settings
     * are not echoed back: an operator's Azure resource is not the user's
     * business.
     */
    settings: ProviderSettings;
};
