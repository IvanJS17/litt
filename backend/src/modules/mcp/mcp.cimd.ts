// Client ID Metadata Documents (CIMD): the client_id is an https URL and the
// document behind it describes the client. LiTT fetches that URL on behalf of
// an unauthenticated visitor, so the fetch goes through the guarded egress
// helper (public https only, connect-time address validation, no internal
// or metadata addresses), follows NO redirect, and is capped in time and
// size.

import { guardedFetch } from "../../lib/mcp/client";
import { isBlockedDestinationError } from "../../lib/blockedDestination";
import { cleanLabel } from "./mcp.shared";
import { validRedirectUris } from "./mcp.redirects";

const MAX_DOCUMENT_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_CLIENT_ID_LENGTH = 512;

export type CimdDocument = {
    clientName: string;
    redirectUris: string[];
    clientUri: string | null;
    logoUri: string | null;
};

export type CimdRejection =
    | "not_a_metadata_url"
    | "blocked_destination"
    | "fetch_failed"
    | "redirected"
    | "bad_status"
    | "bad_content_type"
    | "too_large"
    | "invalid_json"
    | "client_id_mismatch"
    | "invalid_redirect_uris"
    | "client_secret_present";

export type CimdResult =
    | { ok: true; document: CimdDocument }
    | { ok: false; reason: CimdRejection };

export type CimdTransport = (
    url: string,
) => Promise<{ status: number; contentType: string | null; body: string | "too_large" }>;

/** A client_id that names a metadata document: canonical https URL with a path. */
export function isMetadataDocumentUrl(clientId: string): boolean {
    if (clientId.length > MAX_CLIENT_ID_LENGTH || !clientId.startsWith("https://")) return false;
    let url: URL;
    try {
        url = new URL(clientId);
    } catch {
        return false;
    }
    return (
        url.href === clientId &&
        !url.hash &&
        !url.username &&
        !url.password &&
        url.pathname.length > 1
    );
}

async function readCapped(response: Response): Promise<string | "too_large"> {
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_DOCUMENT_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return "too_large";
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_DOCUMENT_BYTES) {
            await reader.cancel().catch(() => undefined);
            return "too_large";
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
}

export const guardedCimdTransport: CimdTransport = async (url) => {
    const response = await guardedFetch(
        url,
        {
            method: "GET",
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
        { label: "Client metadata URL", followRedirects: false },
    );
    return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: response.status === 200 ? await readCapped(response) : "",
    };
};

export async function fetchClientMetadataDocument(
    clientId: string,
    transport: CimdTransport = guardedCimdTransport,
): Promise<CimdResult> {
    if (!isMetadataDocumentUrl(clientId)) return { ok: false, reason: "not_a_metadata_url" };

    let fetched: Awaited<ReturnType<CimdTransport>>;
    try {
        fetched = await transport(clientId);
    } catch (error) {
        return {
            ok: false,
            reason: isBlockedDestinationError(error) ? "blocked_destination" : "fetch_failed",
        };
    }
    if (fetched.status >= 300 && fetched.status < 400) return { ok: false, reason: "redirected" };
    if (fetched.status !== 200) return { ok: false, reason: "bad_status" };
    if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(fetched.contentType ?? ""))
        return { ok: false, reason: "bad_content_type" };
    if (fetched.body === "too_large") return { ok: false, reason: "too_large" };

    let parsed: unknown;
    try {
        parsed = JSON.parse(fetched.body);
    } catch {
        return { ok: false, reason: "invalid_json" };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return { ok: false, reason: "invalid_json" };
    const doc = parsed as Record<string, unknown>;

    if (doc.client_id !== clientId) return { ok: false, reason: "client_id_mismatch" };
    // A metadata document describes a public client; it must not carry a secret.
    if ("client_secret" in doc || "client_secret_expires_at" in doc)
        return { ok: false, reason: "client_secret_present" };
    const redirectUris = validRedirectUris(doc.redirect_uris);
    if (!redirectUris) return { ok: false, reason: "invalid_redirect_uris" };

    const https = (value: unknown): string | null => {
        if (typeof value !== "string" || value.length > 2048) return null;
        try {
            return new URL(value).protocol === "https:" ? value : null;
        } catch {
            return null;
        }
    };
    return {
        ok: true,
        document: {
            clientName: cleanLabel(doc.client_name, 100) ?? new URL(clientId).hostname,
            redirectUris,
            clientUri: https(doc.client_uri),
            logoUri: https(doc.logo_uri),
        },
    };
}
