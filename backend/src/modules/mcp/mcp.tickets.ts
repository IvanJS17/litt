// Tickets for the two-step tools of mode B (design §2.3): `prepare_*` hands the
// client's AI what it needs and a ticket; `submit_*` brings the result back
// with that ticket. A ticket is signed (HMAC-SHA256) and expires; it carries no
// session on the server, so it works for every client. It fixes WHAT was
// prepared (the playbook's rules by hash, the document version by id and
// content hash), WHO asked (user and connection) and WHERE (workspace). Nothing
// in it is a permission: `submit_*` checks access again, as a new request.
//
// The signing key is derived from the server's download-signing secret with a
// label of its own, so a ticket can never be read as a download token or the
// other way round.

import { createHmac, timingSafeEqual } from "node:crypto";

export const TICKET_TTL_SECONDS = 2 * 60 * 60;

export type McpTicketKind = "playbook_review";

export type McpTicketClaims = {
    kind: McpTicketKind;
    /** user id */
    u: string;
    /** grant id */
    g: string;
    /** workspace */
    w: string;
    /** what was prepared, by id/hash; the shape depends on the kind */
    d: Record<string, string>;
    /** expiry, seconds since the epoch */
    exp: number;
};

function key(): Buffer {
    const secret = process.env.DOWNLOAD_SIGNING_SECRET;
    if (!secret) throw new Error("DOWNLOAD_SIGNING_SECRET must be set to sign MCP tickets.");
    return createHmac("sha256", secret).update("litt-mcp-ticket-v1").digest();
}

const sign = (body: string): string => createHmac("sha256", key()).update(body).digest("base64url");

export function signTicket(
    claims: Omit<McpTicketClaims, "exp">,
    now = Date.now(),
    ttlSeconds = TICKET_TTL_SECONDS,
): { ticket: string; expiresAt: string } {
    const exp = Math.floor(now / 1000) + ttlSeconds;
    const body = Buffer.from(JSON.stringify({ ...claims, exp }), "utf8").toString("base64url");
    return { ticket: `${body}.${sign(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export type TicketCheck =
    | { ok: true; claims: McpTicketClaims }
    | { ok: false; reason: "invalid" | "expired" };

/** The claims of a ticket that is ours, unaltered and still valid. */
export function verifyTicket(ticket: string, kind: McpTicketKind, now = Date.now()): TicketCheck {
    const parts = ticket.split(".");
    if (parts.length !== 2) return { ok: false, reason: "invalid" };
    const [body, signature] = parts;
    const expected = Buffer.from(sign(body));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
        return { ok: false, reason: "invalid" };
    let claims: McpTicketClaims;
    try {
        claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as McpTicketClaims;
    } catch {
        return { ok: false, reason: "invalid" };
    }
    if (claims.kind !== kind || typeof claims.exp !== "number" || typeof claims.u !== "string")
        return { ok: false, reason: "invalid" };
    if (claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
    return { ok: true, claims };
}
