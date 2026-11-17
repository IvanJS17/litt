// Types shared by the topic files of the MCP module (not exported through
// the facade).

export type OAuthFailure = {
    ok: false;
    /** RFC 6749 / 7591 error code. */
    error: string;
    description: string;
    /** HTTP status; defaults to 400. */
    status?: number;
};
export type OAuthResult<T> = { ok: true; data: T } | OAuthFailure;

export const oauthOk = <T>(data: T): OAuthResult<T> => ({ ok: true, data });
export const oauthFail = (
    error: string,
    description: string,
    status?: number,
): OAuthFailure => ({ ok: false, error, description, ...(status ? { status } : {}) });

export type McpClient = {
    clientId: string;
    kind: "dcr" | "cimd" | "preregistered";
    name: string;
    redirectUris: string[];
    clientUri: string | null;
    logoUri: string | null;
};

export type ClientRow = {
    client_id: string;
    kind: McpClient["kind"];
    client_name: string;
    redirect_uris: string[];
    client_uri: string | null;
    logo_uri: string | null;
    expires_at: string | null;
};

export function toClient(row: ClientRow): McpClient {
    return {
        clientId: row.client_id,
        kind: row.kind,
        name: row.client_name,
        redirectUris: row.redirect_uris,
        clientUri: row.client_uri,
        logoUri: row.logo_uri,
    };
}

export type GrantRow = {
    id: string;
    user_id: string;
    client_id: string;
    resource: string;
    scopes: string[];
    workspaces: string[];
    default_workspace: string;
    mfa_verified_at: string | null;
    created_at: string;
    last_used_at: string | null;
    expires_at: string;
    revoked_at: string | null;
};

export const nowIso = (offsetSeconds = 0): string =>
    new Date(Date.now() + offsetSeconds * 1000).toISOString();

/** Keep a person-visible label short and free of control characters. */
export function cleanLabel(value: unknown, max: number): string | null {
    if (typeof value !== "string") return null;
    const text = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
    return text ? text.slice(0, max) : null;
}
