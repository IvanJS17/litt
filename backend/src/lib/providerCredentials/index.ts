// Shared, owner-aware credentials. Callers authorize owner-scoped writes.
export {
    getUserApiKeys,
    getEffectiveApiKeys,
    getApiKeyStatusFor,
    getEffectiveApiKeyStatus,
    normalizeApiKeyProvider,
    orgKeyOwner,
    userKeyOwner,
    getUserApiKeyStatus,
    // LiTT governed BYOK (user.chatRoute): the pinned credential is resolved
    // and decrypted from its own owner's row, and an organization's scope
    // decides whether personal keys may sit beneath its own.
    OWNER_TABLE,
    decrypt,
    envApiKey,
    envApiKeys,
    isSettingsApiKeyProvider,
    loadOrgKeyScope,
    normalizeProviderSettings,
} from "./store";
export type { ApiKeyProvider, ApiKeyStatus, ApiKeyOwner } from "./types";
export type { EncryptedKeyRow } from "./store";
export { saveApiKeyForOwner, REENTER_KEY_FOR_ENDPOINT } from "./settings";
export type { SaveApiKeyResult } from "./settings";
export { setApiKeyEnabledFor } from "./enabled";
