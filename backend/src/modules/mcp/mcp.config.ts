// Configuration of the LiTT MCP server (OAuth authorization server + /mcp).
//
// Everything is behind LITT_MCP_SERVER=enabled; the default is disabled, in
// which case no MCP route answers (404). The issuer and the resource are
// FIXED by configuration, never derived from the request's Host header: a
// token is only as good as the audience it names.

export const MCP_SCOPES = ["litt.read", "litt.run", "litt.write", "litt.chat"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const MCP_DEFAULT_SCOPE: McpScope = "litt.read";

export type McpConfig = {
    enabled: boolean;
    /** Origin that is both the OAuth issuer and the host of /mcp. */
    issuer: string;
    /** The exact URL clients pass as `resource` (RFC 8707). */
    resource: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    registrationEndpoint: string;
    revocationEndpoint: string;
    protectedResourceMetadataUrl: string;
    /** The web page that asks the person to approve a connection. */
    consentUrl: string;
    /** Origin of the web app: where a matter can be opened. */
    webUrl: string;
    cimdEnabled: boolean;
    allowedOrigins: Set<string>;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    grantMaxAgeSeconds: number;
    codeTtlSeconds: number;
    requestTtlSeconds: number;
    rateLimits: McpRateLimits;
};

/** Per-grant call budgets (design §7.3): reads, and everything that writes, runs or chats. */
export type McpRateLimits = {
    readMax: number;
    readWindowMs: number;
    writeMax: number;
    writeWindowMs: number;
};

function positiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function originOf(value: string | undefined): string | null {
    if (!value?.trim()) return null;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        return url.origin;
    } catch {
        return null;
    }
}

/** Why the server cannot run, or null. Only meaningful when enabled. */
export function mcpConfigurationProblem(env: NodeJS.ProcessEnv = process.env): string | null {
    if (env.LITT_MCP_SERVER?.trim().toLowerCase() !== "enabled") return null;
    const issuer = originOf(env.LITT_MCP_PUBLIC_URL);
    if (!issuer) {
        return env.NODE_ENV === "production"
            ? "LITT_MCP_PUBLIC_URL is required when LITT_MCP_SERVER=enabled"
            : null;
    }
    if (env.NODE_ENV === "production" && !issuer.startsWith("https://"))
        return "LITT_MCP_PUBLIC_URL must be an https origin in production";
    return null;
}

/** Read per call so a test (or an operator's restart) sees the environment. */
export function mcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
    const requested = env.LITT_MCP_SERVER?.trim().toLowerCase() === "enabled";
    const enabled = requested && mcpConfigurationProblem(env) === null;
    const issuer =
        originOf(env.LITT_MCP_PUBLIC_URL) ?? `http://127.0.0.1:${env.PORT?.trim() || "3001"}`;
    const web = originOf(env.FRONTEND_URL) ?? "http://localhost:3000";
    return {
        enabled,
        issuer,
        resource: `${issuer}/mcp`,
        authorizationEndpoint: `${issuer}/oauth/authorize`,
        tokenEndpoint: `${issuer}/oauth/token`,
        registrationEndpoint: `${issuer}/oauth/register`,
        revocationEndpoint: `${issuer}/oauth/revoke`,
        protectedResourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource/mcp`,
        consentUrl: `${originOf(env.LITT_MCP_CONSENT_URL) ?? web}/connect/authorize`,
        webUrl: originOf(env.LITT_MCP_CONSENT_URL) ?? web,
        cimdEnabled: env.LITT_MCP_CIMD?.trim().toLowerCase() !== "disabled",
        allowedOrigins: new Set(
            (env.LITT_MCP_ALLOWED_ORIGINS ?? "")
                .split(",")
                .map((o) => originOf(o))
                .filter((o): o is string => !!o),
        ),
        accessTtlSeconds: positiveInt(env.LITT_MCP_ACCESS_TTL_SECONDS, 3600),
        refreshTtlSeconds: positiveInt(env.LITT_MCP_REFRESH_TTL_DAYS, 30) * 86_400,
        grantMaxAgeSeconds: positiveInt(env.LITT_MCP_GRANT_MAX_DAYS, 90) * 86_400,
        codeTtlSeconds: 60,
        requestTtlSeconds: 600,
        rateLimits: {
            readMax: positiveInt(env.RATE_LIMIT_MCP_GRANT_READ_MAX, 120),
            readWindowMs: positiveInt(env.RATE_LIMIT_MCP_GRANT_READ_WINDOW_SECONDS, 60) * 1000,
            writeMax: positiveInt(env.RATE_LIMIT_MCP_GRANT_WRITE_MAX, 30),
            writeWindowMs:
                positiveInt(env.RATE_LIMIT_MCP_GRANT_WRITE_WINDOW_MINUTES, 15) * 60_000,
        },
    };
}
