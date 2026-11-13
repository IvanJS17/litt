import { isWebSearchBackend } from "../webSearch/settings";
import { isOcrProvider } from "../ocr/provider";
import type { ApiKeyProvider } from "./types";

/**
 * What a saved key is for. An organization decides, for each of these
 * separately, whether its members may bring their own key into the firm's
 * workspace (organizations.allow_personal_*_keys).
 *
 *   ai          the model providers: chat, tabular review, titles, helpers
 *   web_search  Brave, Tavily and DeepSeek search
 *   scan        scan reading and case-file splitting (LandingAI)
 */
export const KEY_CAPABILITIES = ["ai", "web_search", "scan"] as const;
export type KeyCapability = (typeof KEY_CAPABILITIES)[number];

export const isKeyCapability = (value: unknown): value is KeyCapability =>
    typeof value === "string" &&
    (KEY_CAPABILITIES as readonly string[]).includes(value);

/** Per capability: may a member's own key sit beneath the organization's. */
export type PersonalKeyPolicy = Record<KeyCapability, boolean>;

/** The organizations column that holds each capability's switch. */
export const POLICY_COLUMN: Record<KeyCapability, string> = {
    ai: "allow_personal_ai_keys",
    web_search: "allow_personal_web_search_keys",
    scan: "allow_personal_scan_keys",
};

export function capabilityOfProvider(provider: ApiKeyProvider): KeyCapability {
    if (isWebSearchBackend(provider)) return "web_search";
    if (isOcrProvider(provider)) return "scan";
    return "ai";
}

/** Whether a personal key for `provider` may be used under `policy`. */
export const personalKeyAllowed = (
    policy: PersonalKeyPolicy,
    provider: ApiKeyProvider,
): boolean => policy[capabilityOfProvider(provider)];
