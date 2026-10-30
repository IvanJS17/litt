// Governed BYOK: the route a conversation runs on (LiTT sync 2026-10-23, S3;
// docs/UPSTREAM_SYNC_PLAN.md §5 "S3", ledger §16.3 "Provider catalog,
// credentials and model selection").
//
// A route is provider + model + credential, chosen when the conversation is
// created and stored on it (chats.model_provider / model / credential_ref).
// Every later turn, retry and server run uses exactly that route:
//
//   - a different model from the browser is refused (chat_route_pinned);
//   - the pinned credential must still exist, be enabled and be the same
//     version; a rotated, re-enabled, re-configured, disabled or deleted key
//     fails closed (chat_route_credential_unavailable) and never falls back to
//     another key, the deployment's key or another provider;
//   - the key bag handed to the provider layer holds ONLY the pinned
//     credential and marks every other provider as turned off, so a title,
//     helper or tool call cannot reach a second provider either.
//
// Credential references (never the secret):
//   user:<userId>:<provider>:v<n>   a person's saved key; usable only by them
//   org:<orgId>:<provider>:v<n>     an organization's saved key; chosen
//                                   explicitly, never resolved implicitly
//   env:<provider>                  the deployment's key for the provider
//   operator:<provider>             an operator-declared endpoint (Ollama,
//                                   MIKE_MODEL_CONFIG_JSON) with its own
//                                   operator-side authentication
//
// Versions are assigned by the database (assign_api_key_credential_ref,
// 20261023_15), so "read, then bump" never happens in the application.

import type { Db } from "../../lib/supabase";
import type { Provider, UserApiKeys } from "../../lib/llm";
import type { SubagentRoute, SubagentRoutes } from "@mike/contracts";
import { providerForModel, resolveModel } from "../../lib/llm/models";
import { getConfiguredModel } from "../../lib/llm/registry";
import { recordAudit } from "../../lib/audit";
import { resolveEffectiveChatModel } from "../../lib/modelSelection";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { checkProjectAccess, resolveStandaloneOrgId } from "../../lib/access";
import {
    OWNER_TABLE,
    decrypt,
    envApiKey,
    envApiKeys,
    isSettingsApiKeyProvider,
    loadOrgKeyScope,
    normalizeApiKeyProvider,
    normalizeProviderSettings,
    type ApiKeyOwner,
    type ApiKeyProvider,
    type EncryptedKeyRow,
} from "./user.apiKeyStore";

export type ChatRoute = {
    provider: Provider;
    model: string;
    credentialRef: string;
};

export type ChatRouteFailure = {
    ok: false;
    status: 409 | 422;
    code:
        | "chat_route_pinned"
        | "chat_route_credential_unavailable"
        | "chat_route_credential_required";
    detail: string;
};

export type ResolvedChatRoute = {
    ok: true;
    route: ChatRoute;
    /** Holds only the pinned credential; every other provider is off. */
    apiKeys: UserApiKeys;
};

const ALL_PROVIDERS: readonly Provider[] = [
    "claude",
    "gemini",
    "openai",
    "mistral",
    "openai-compatible",
    "openrouter",
    "vercel",
    "opencode-go",
    "bedrock",
    "azure",
    "azure-foundry",
    "vertex",
    "xai",
    "custom",
    "ollama",
];

const PINNED = "This conversation is fixed to the model it was started with. Start a new conversation to use a different model.";
const UNAVAILABLE = "The key this conversation was started with is no longer available. Start a new conversation with a key you can use.";

function unavailable(): ChatRouteFailure {
    return {
        ok: false,
        status: 409,
        code: "chat_route_credential_unavailable",
        detail: UNAVAILABLE,
    };
}

/**
 * The saved-key provider whose key a model runs on, or null when the model
 * authenticates on the operator's side (Ollama, a declared endpoint with its
 * own key or none).
 */
function keyProviderFor(provider: Provider, model: string): ApiKeyProvider | null {
    if (provider === "ollama") return null;
    if (provider === "openai-compatible") {
        const configured = getConfiguredModel(model);
        if (!configured || configured.apiKey || configured.apiKeyEnv) return null;
        return configured.apiKeyProvider
            ? normalizeApiKeyProvider(String(configured.apiKeyProvider))
            : null;
    }
    return normalizeApiKeyProvider(provider);
}

/** A bag with one credential and every other provider turned off. */
function onlyBag(
    provider: Provider,
    keyProvider: ApiKeyProvider | null,
    key: string | null,
    settings: UserApiKeys["providerSettings"],
): UserApiKeys {
    const bag: UserApiKeys = {
        disabledProviders: ALL_PROVIDERS.filter(
            (candidate) => candidate !== provider && candidate !== keyProvider,
        ),
        providerSettings: settings ?? {},
    };
    if (keyProvider && key) {
        (bag as Record<string, unknown>)[keyProvider] = key;
    } else if (keyProvider) {
        // The provider layer falls back to the deployment's key when the bag
        // has none; marking it unusable closes that path.
        bag.unusableProviders = [keyProvider];
    }
    return bag;
}

type KeyRow = EncryptedKeyRow & { credential_ref?: string | null };

async function savedKey(
    db: Db,
    owner: ApiKeyOwner,
    keyProvider: ApiKeyProvider,
): Promise<KeyRow | null> {
    const { table, column } = OWNER_TABLE[owner.kind];
    const { data, error } = await db
        .from(table)
        .select("provider, encrypted_key, iv, auth_tag, settings, enabled, credential_ref")
        .eq(column, owner.id)
        .eq("provider", keyProvider)
        .maybeSingle();
    if (error) throw error;
    return (data as KeyRow | null) ?? null;
}

/** The usable secret and settings of a saved row, or null. */
function usableRow(
    row: KeyRow | null,
    keyProvider: ApiKeyProvider,
): { key: string; settings: UserApiKeys["providerSettings"]; ref: string } | null {
    if (!row || row.enabled === false || !row.credential_ref) return null;
    const key = decrypt(row)?.trim();
    if (!key) return null;
    let settings: UserApiKeys["providerSettings"] = {};
    if (isSettingsApiKeyProvider(keyProvider)) {
        const normalized = normalizeProviderSettings(keyProvider, row.settings);
        if (!normalized) return null;
        settings = normalized;
    }
    return { key, settings, ref: row.credential_ref };
}

function envCredential(keyProvider: ApiKeyProvider) {
    const key = envApiKey(keyProvider);
    if (!key) return null;
    const settings = envApiKeys().providerSettings ?? {};
    if (isSettingsApiKeyProvider(keyProvider) && !settings[keyProvider]) return null;
    return {
        key,
        settings: isSettingsApiKeyProvider(keyProvider)
            ? { [keyProvider]: settings[keyProvider] }
            : {},
    };
}

export type ChatCredentialOption = {
    credential_ref: string;
    /** Whose credential it is; never the secret. */
    source: "personal" | "organization" | "deployment" | "operator";
};

/**
 * The credentials a NEW conversation on `model` can be pinned to, for the
 * selector shown when the conversation is created. The same rules as
 * pinChatRoute: a person's key only if the organization allows personal
 * keys, an organization's key only for its members (offered, never chosen
 * implicitly), the deployment's key when configured, and an operator route
 * for models that authenticate on the operator's side. `default` is what
 * pinChatRoute picks without an explicit choice (null: the user must choose).
 * Returns null for a model the catalog does not know.
 */
export async function listChatCredentialOptions(
    db: Db,
    args: { userId: string; orgId: string | null; model: string },
): Promise<{
    provider: Provider;
    options: ChatCredentialOption[];
    default: string | null;
} | null> {
    let provider: Provider;
    try {
        provider = providerForModel(args.model);
    } catch {
        return null;
    }
    const keyProvider = keyProviderFor(provider, args.model);
    if (!keyProvider) {
        const ref = `operator:${provider}`;
        return {
            provider,
            options: [{ credential_ref: ref, source: "operator" }],
            default: ref,
        };
    }
    const scope = args.orgId
        ? await loadOrgKeyScope(args.userId, args.orgId, db)
        : null;
    const options: ChatCredentialOption[] = [];
    let personal: string | null = null;
    if (!args.orgId || !scope || scope.allowPersonal) {
        const own = usableRow(
            await savedKey(db, { kind: "user", id: args.userId }, keyProvider),
            keyProvider,
        );
        if (own) {
            personal = `user:${args.userId}:${own.ref}`;
            options.push({ credential_ref: personal, source: "personal" });
        }
    }
    if (args.orgId && scope) {
        const firm = usableRow(
            await savedKey(db, { kind: "org", id: args.orgId }, keyProvider),
            keyProvider,
        );
        if (firm) {
            options.push({
                credential_ref: `org:${args.orgId}:${firm.ref}`,
                source: "organization",
            });
        }
    }
    const env = envCredential(keyProvider) ? `env:${keyProvider}` : null;
    if (env) options.push({ credential_ref: env, source: "deployment" });
    return { provider, options, default: personal ?? env };
}

/**
 * HTTP-facing form of listChatCredentialOptions: the organization is the one
 * the new conversation will belong to, resolved exactly as the first turn
 * resolves it (the project's, or the named workspace the caller belongs to).
 */
export async function chatCredentialChoices(
    db: Db,
    args: {
        userId: string;
        userEmail?: string;
        model: unknown;
        projectId: unknown;
        orgId: unknown;
    },
): Promise<
    | { ok: true; body: NonNullable<Awaited<ReturnType<typeof listChatCredentialOptions>>> }
    | { ok: false; status: 400 | 404; detail: string }
> {
    if (typeof args.model !== "string" || !args.model.trim())
        return { ok: false, status: 400, detail: "model is required" };
    let orgId: string | null;
    if (typeof args.projectId === "string" && args.projectId) {
        const access = await checkProjectAccess(args.projectId, args.userId, args.userEmail, db);
        if (!access.ok) return { ok: false, status: 404, detail: "Project not found" };
        orgId = access.project.org_id ?? null;
    } else {
        const standalone = await resolveStandaloneOrgId(db, {
            userId: args.userId,
            orgId: args.orgId,
        });
        if (!standalone.ok) return { ok: false, status: 400, detail: standalone.detail };
        orgId = standalone.orgId;
    }
    const listed = await listChatCredentialOptions(db, {
        userId: args.userId,
        orgId,
        model: args.model.trim(),
    });
    if (!listed) return { ok: false, status: 400, detail: "Unknown model" };
    return { ok: true, body: listed };
}

/**
 * Choose the route for a NEW conversation. `requestedCredentialRef` is the
 * user's explicit choice; without one, the person's own key is used, then the
 * deployment's. An organization's key is used only when chosen explicitly.
 */
export async function pinChatRoute(
    db: Db,
    args: {
        userId: string;
        orgId: string | null;
        model: string;
        requestedCredentialRef?: string | null;
    },
): Promise<ResolvedChatRoute | ChatRouteFailure> {
    const provider = providerForModel(args.model);
    const keyProvider = keyProviderFor(provider, args.model);
    const requested = args.requestedCredentialRef?.trim() || null;

    const route = (credentialRef: string): ChatRoute => ({
        provider,
        model: args.model,
        credentialRef,
    });

    if (!keyProvider) {
        const ref = `operator:${provider}`;
        if (requested && requested !== ref) return unavailable();
        return {
            ok: true,
            route: route(ref),
            apiKeys: onlyBag(provider, null, null, {}),
        };
    }

    if (requested) {
        const resolved = await loadPinnedChatRoute(db, {
            userId: args.userId,
            orgId: args.orgId,
            route: route(requested),
        });
        return resolved;
    }

    const scope = args.orgId
        ? await loadOrgKeyScope(args.userId, args.orgId, db)
        : null;
    const personalAllowed = !args.orgId || !scope || scope.allowPersonal;
    if (personalAllowed) {
        const own = usableRow(
            await savedKey(db, { kind: "user", id: args.userId }, keyProvider),
            keyProvider,
        );
        if (own) {
            return {
                ok: true,
                route: route(`user:${args.userId}:${own.ref}`),
                apiKeys: onlyBag(provider, keyProvider, own.key, own.settings),
            };
        }
    }
    const env = envCredential(keyProvider);
    if (env) {
        return {
            ok: true,
            route: route(`env:${keyProvider}`),
            apiKeys: onlyBag(provider, keyProvider, env.key, env.settings),
        };
    }
    return {
        ok: false,
        status: 422,
        code: "chat_route_credential_required",
        detail: "Choose which key this conversation should use for the selected model.",
    };
}

/**
 * Load the credential a conversation is pinned to. Fails closed on any
 * mismatch; never substitutes another credential.
 */
export async function loadPinnedChatRoute(
    db: Db,
    args: {
        userId: string;
        orgId: string | null;
        route: ChatRoute;
        requestedModel?: string | null;
    },
): Promise<ResolvedChatRoute | ChatRouteFailure> {
    const { route } = args;
    if (args.requestedModel && args.requestedModel !== route.model) {
        return { ok: false, status: 409, code: "chat_route_pinned", detail: PINNED };
    }
    let provider: Provider;
    try {
        provider = providerForModel(route.model);
    } catch {
        return unavailable();
    }
    if (provider !== route.provider) return unavailable();
    const keyProvider = keyProviderFor(provider, route.model);
    const parts = route.credentialRef.split(":");

    if (parts[0] === "operator") {
        if (keyProvider || parts.length !== 2 || parts[1] !== provider) return unavailable();
        return { ok: true, route, apiKeys: onlyBag(provider, null, null, {}) };
    }
    if (!keyProvider) return unavailable();

    if (parts[0] === "env") {
        if (parts.length !== 2 || parts[1] !== keyProvider) return unavailable();
        // An organization that refuses personal keys still runs on the
        // deployment's; nothing about the env route depends on the actor.
        const env = envCredential(keyProvider);
        if (!env) return unavailable();
        return {
            ok: true,
            route,
            apiKeys: onlyBag(provider, keyProvider, env.key, env.settings),
        };
    }

    // user:<userId>:<provider>:v<n> | org:<orgId>:<provider>:v<n>
    if (parts.length !== 4 || parts[2] !== keyProvider) return unavailable();
    const [kind, ownerId] = parts;
    const savedRef = `${parts[2]}:${parts[3]}`;
    let owner: ApiKeyOwner;
    if (kind === "user") {
        // A person's key serves only that person, even in a shared chat.
        if (ownerId !== args.userId) return unavailable();
        if (args.orgId) {
            const scope = await loadOrgKeyScope(args.userId, args.orgId, db);
            if (scope && !scope.allowPersonal) return unavailable();
        }
        owner = { kind: "user", id: ownerId };
    } else if (kind === "org") {
        if (!args.orgId || ownerId !== args.orgId) return unavailable();
        // Membership is re-checked on every turn: the key is the firm's.
        if (!(await loadOrgKeyScope(args.userId, args.orgId, db))) return unavailable();
        owner = { kind: "org", id: ownerId };
    } else {
        return unavailable();
    }
    const row = usableRow(await savedKey(db, owner, keyProvider), keyProvider);
    if (!row || row.ref !== savedRef) return unavailable();
    return {
        ok: true,
        route,
        apiKeys: onlyBag(provider, keyProvider, row.key, row.settings),
    };
}

/**
 * The route for one turn of a `chats` conversation. A pinned chat loads its
 * route (refusing another model); a new chat, or one stored before routes
 * were pinned, gets one now and `pinNow` tells the caller to persist it.
 */
export async function governChatRoute(
    db: Db,
    args: {
        userId: string;
        orgId: string | null;
        chat: {
            model?: string | null;
            model_provider?: string | null;
            credential_ref?: string | null;
        } | null;
        requestedModel?: string | null;
        /** The model the shared selection resolved for this turn. */
        selectedModel: string;
        requestedCredentialRef?: string | null;
    },
): Promise<(ResolvedChatRoute & { pinNow: boolean }) | ChatRouteFailure> {
    const pinned = args.chat ? chatRouteOf(args.chat) : null;
    if (pinned) {
        if (
            args.requestedCredentialRef &&
            args.requestedCredentialRef !== pinned.credentialRef
        ) {
            return { ok: false, status: 409, code: "chat_route_pinned", detail: PINNED };
        }
        const loaded = await loadPinnedChatRoute(db, {
            userId: args.userId,
            orgId: args.orgId,
            route: pinned,
            requestedModel: args.requestedModel,
        });
        return loaded.ok ? { ...loaded, pinNow: false } : loaded;
    }
    const fresh = await pinChatRoute(db, {
        userId: args.userId,
        orgId: args.orgId,
        model: args.selectedModel,
        requestedCredentialRef: args.requestedCredentialRef,
    });
    return fresh.ok ? { ...fresh, pinNow: true } : fresh;
}

/**
 * A saved title-model preference applies only when it runs on the route's own
 * provider (and so on the same credential); otherwise the title is made with
 * the route's provider default.
 */
export function titleModelForRoute(
    route: ChatRoute,
    override: string | null | undefined,
): string | null {
    if (!override) return null;
    try {
        return providerForModel(override) === route.provider ? override : null;
    } catch {
        return null;
    }
}

const CREDENTIAL_REF_RE = /^(user|org|env|operator):[A-Za-z0-9._:-]{1,190}$/;

/** Request input: an optional credential reference for a new conversation. */
export function parseCredentialRef(
    value: unknown,
): { ok: true; value: string | null } | { ok: false; detail: string } {
    if (value === undefined || value === null || value === "") {
        return { ok: true, value: null };
    }
    if (typeof value !== "string" || !CREDENTIAL_REF_RE.test(value)) {
        return { ok: false, detail: "credential_ref is invalid" };
    }
    return { ok: true, value };
}

/** The values to store on a chats row for a route. */
export function chatRouteColumns(route: ChatRoute) {
    return {
        model_provider: route.provider,
        model: route.model,
        credential_ref: route.credentialRef,
    };
}

/** The route stored on a chats row, or null when it predates pinning. */
export function chatRouteOf(row: {
    model?: string | null;
    model_provider?: string | null;
    credential_ref?: string | null;
}): ChatRoute | null {
    if (!row.model || !row.model_provider || !row.credential_ref) return null;
    return {
        provider: row.model_provider as Provider,
        model: row.model,
        credentialRef: row.credential_ref,
    };
}

const FIXED_HOSTS: Partial<Record<Provider, string>> = {
    claude: "api.anthropic.com",
    gemini: "generativelanguage.googleapis.com",
    openai: "api.openai.com",
    mistral: "api.mistral.ai",
    openrouter: "openrouter.ai",
    vercel: "ai-gateway.vercel.sh",
    "opencode-go": "opencode.ai",
    xai: "api.x.ai",
};

function hostOf(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
        return new URL(url).host || null;
    } catch {
        return null;
    }
}

/** Where a route's requests go: recorded with every turn's egress. */
export function chatRouteHost(route: ChatRoute, apiKeys: UserApiKeys): string {
    const settings = apiKeys.providerSettings ?? {};
    switch (route.provider) {
        case "custom":
            return hostOf(settings.custom?.baseUrl) ?? "unknown";
        case "azure":
            return hostOf(settings.azure?.endpoint) ?? "unknown";
        case "azure-foundry":
            return hostOf(settings["azure-foundry"]?.endpoint) ?? "unknown";
        case "bedrock":
            return settings.bedrock?.region
                ? `bedrock-runtime.${settings.bedrock.region}.amazonaws.com`
                : "unknown";
        case "vertex": {
            const location = settings.vertex?.location;
            if (!location) return "unknown";
            return location === "global"
                ? "aiplatform.googleapis.com"
                : `${location}-aiplatform.googleapis.com`;
        }
        case "openai-compatible":
            return hostOf(getConfiguredModel(route.model)?.baseUrl) ?? "unknown";
        case "ollama":
            return (
                hostOf(process.env.OLLAMA_BASE_URL?.trim()) ?? "localhost:11434"
            );
        default:
            return FIXED_HOSTS[route.provider] ?? "unknown";
    }
}

/**
 * Egress provenance for one turn: which provider, model, credential reference
 * and host the conversation's text is about to be sent to. Written to the
 * insert-only audit log before the provider is called; never the secret.
 */
export async function recordChatEgress(
    db: Db,
    args: {
        userId: string;
        orgId: string | null;
        /** Null for a conversation with no server record (local Word chat). */
        chatId: string | null;
        projectId?: string | null;
        surface: string;
        resolved: ResolvedChatRoute;
        /** Identifiers of the work this egress belongs to (never content). */
        extra?: Record<string, string>;
    },
): Promise<void> {
    const { route, apiKeys } = args.resolved;
    await recordAudit(db, {
        userId: args.userId,
        orgId: args.orgId,
        action: "llm.egress",
        surface: args.surface,
        projectId: args.projectId ?? null,
        chatId: args.chatId,
        model: route.model,
        detail: {
            provider: route.provider,
            credential_ref: route.credentialRef,
            host: chatRouteHost(route, apiKeys),
            ...(args.extra ?? {}),
        },
    });
}

/**
 * LiTT: how a conversation's subagents run on the user's named routes. A
 * route gets the checks a conversation's own model gets — its credential
 * (the conversation's own when the provider is the same), the
 * organization's key policy and model lists — and its egress is recorded
 * before any text is sent. It never falls back to another model: a route
 * that cannot run returns why.
 */
export function subagentRoutePlan(
    db: Db,
    routes: SubagentRoutes | null | undefined,
    scope: Parameters<typeof subagentRouteGovernor>[1],
) {
    return routes?.routes.length
        ? { routes, govern: subagentRouteGovernor(db, scope) }
        : null;
}

export function subagentRouteGovernor(
    db: Db,
    scope: {
        userId: string;
        orgId: string | null;
        chatId: string | null;
        projectId?: string | null;
        surface: string;
        /** The conversation's own pinned route. */
        conversation: ChatRoute;
    },
): (
    route: SubagentRoute,
) => Promise<
    | { ok: true; model: string; provider: Provider; apiKeys: UserApiKeys }
    | { ok: false; detail: string }
> {
    return async (subagentRoute) => {
        const model = resolveModel(subagentRoute.model, "");
        if (!model) {
            return { ok: false, detail: `The model of the route "${subagentRoute.name}" is no longer available.` };
        }
        try {
            const sameProvider = providerForModel(model) === scope.conversation.provider;
            const resolved = await pinChatRoute(db, {
                userId: scope.userId,
                orgId: scope.orgId,
                model,
                requestedCredentialRef: sameProvider ? scope.conversation.credentialRef : null,
            });
            // The conversation's own wording ("start a new conversation") does not fit a route.
            if (!resolved.ok) {
                return {
                    ok: false,
                    detail: `No key you can use for ${model} is available. Add one in Settings > Bring Your Own Keys, or change the route in Settings > Subagents.`,
                };
            }
            const checked = await resolveEffectiveChatModel({
                requested: model,
                apiKeys: resolved.apiKeys,
                userId: scope.userId,
                db,
                orgId: scope.orgId,
            });
            if (!checked.ok) return { ok: false, detail: checked.detail };
            await recordChatEgress(db, {
                userId: scope.userId,
                orgId: scope.orgId,
                chatId: scope.chatId,
                projectId: scope.projectId,
                surface: scope.surface,
                resolved,
                extra: { subagent_route: subagentRoute.name },
            });
            return {
                ok: true,
                model: checked.model,
                provider: resolved.route.provider,
                apiKeys: resolved.apiKeys,
            };
        } catch (error) {
            reportError(
                new AppError("chat.context_failed", "Subagent route check failed", { cause: error }),
                { tags: { component: "chat-stream", operation: "chat.subagent" } },
            );
            return { ok: false, detail: "The route could not be checked. Try again later." };
        }
    };
}
