// Token primitives. Tokens, codes and request ids are 256 random bits; only
// their SHA-256 reaches the database, so a database read never yields a
// usable credential.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newSecret(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

/** RFC 7636 §4.1: 43–128 characters from the unreserved set. */
const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** An S256 challenge is a 43-character base64url SHA-256. */
const CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

export function isWellFormedChallenge(value: string): boolean {
    return CHALLENGE_PATTERN.test(value);
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
    if (!VERIFIER_PATTERN.test(verifier)) return false;
    const computed = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
    const expected = Buffer.from(challenge);
    return computed.length === expected.length && timingSafeEqual(computed, expected);
}
