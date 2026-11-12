/**
 * One table of auth failure sentences.
 *
 * Every auth screen used to carry its own `code → sentence` map. Twenty-one
 * codes appeared in two or more of them, and three had drifted: the same
 * `user_not_found`, `same_password` and `signup_disabled` failure read
 * differently depending on which form the user was standing in front of.
 * Sentences are a product surface; they belong in one place.
 *
 * The codes are GoTrue's, normalised by `backend/src/modules/auth/
 * auth.messages.ts`, which also owns the sentence a non-browser client
 * (the Word add-in) receives as `detail`.
 *
 * The sentences live in the catalog (`auth.errors` in packages/i18n/messages)
 * and this file maps each code to one of them. The tables translate when a
 * sentence is read, not when the table is built, so a table a screen builds
 * at module scope still follows the locale the app configured.
 *
 * A screen passes `authMessages({ ... })` when its wording genuinely has to
 * change with the context — "log in again before changing your email" is
 * not the same instruction as "before changing your password" — and the
 * override sits next to the call so the delta is visible.
 */

import { clientTranslator, sourceTranslator, type ClientTranslator } from "@mike/client";
import type { Messages } from "@litt/i18n";
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
} from "@/app/components/auth/passwordPolicy";

type AuthSentence = keyof Messages["auth"]["errors"];

/** The sentence in `t`'s locale, with the password policy's numbers. */
function say(t: ClientTranslator, sentence: AuthSentence): string {
    // A sentence ignores the numbers it does not name.
    return t(`auth.errors.${sentence}`, {
        min: MIN_PASSWORD_LENGTH,
        max: MAX_PASSWORD_LENGTH,
    } as never);
}

/** The catalog sentence each code shows. */
export const AUTH_ERROR_SENTENCES = {
    // Credentials
    invalid_credentials: "invalidCredentials",
    // GoTrue reports a missing account as a dead session, not as "no such
    // user"; the login screen deliberately says something else (see there).
    user_not_found: "sessionExpired",
    email_not_confirmed: "emailNotConfirmed",
    user_banned: "userBanned",

    // Account creation
    user_already_exists: "accountExists",
    email_exists: "accountExists",
    signup_disabled: "signupDisabled",
    signup_invite_only: "signupInviteOnly",
    email_address_invalid: "emailInvalid",
    email_address_not_authorized: "emailNotAuthorized",

    // Passwords
    weak_password: "weakPassword",
    same_password: "samePassword",
    password_too_short: "passwordTooShort",
    password_too_long: "passwordTooLong",

    // Input this form can fix
    validation_failed: "invalidInput",
    invalid_request: "invalidInput",

    // Sessions and step-up
    session_expired: "sessionExpired",
    session_not_found: "sessionExpired",
    cookie_session_required: "sessionExpired",
    bad_jwt: "sessionExpired",
    no_authorization: "sessionExpired",
    refresh_token_not_found: "sessionExpired",
    refresh_token_already_used: "sessionExpired",
    reauthentication_needed: "reauthenticationNeeded",
    reauthentication_not_valid: "mfaCodeIncorrect",
    insufficient_aal: "insufficientAal",

    // Authenticator apps
    mfa_verification_failed: "mfaCodeIncorrect",
    mfa_verification_rejected: "mfaCodeRejected",
    mfa_challenge_expired: "mfaCodeExpired",
    mfa_factor_not_found: "mfaFactorNotFound",
    mfa_ip_address_mismatch: "mfaNetworkChanged",
    too_many_enrolled_mfa_factors: "mfaTooManyFactors",
    mfa_totp_enroll_not_enabled: "mfaTotpDisabled",

    // Links and one-time codes
    otp_expired: "otpExpired",
    flow_state_expired: "linkSpent",
    flow_state_not_found: "linkSpent",
    bad_code_verifier: "otherBrowser",
    bad_oauth_state: "signInIncomplete",
    bad_oauth_callback: "signInIncomplete",

    // Sign-in methods
    email_provider_disabled: "passwordLoginDisabled",
    provider_disabled: "providerDisabled",
    oauth_provider_not_supported: "providerDisabled",
    sso_disabled: "ssoDisabled",
    sso_domain_not_allowed: "ssoDomainNotAllowed",
    sso_unavailable: "ssoUnavailable",
    sso_provider_not_found: "ssoNotSetUp",
    saml_provider_disabled: "samlDisabled",

    // Throttling and checks
    over_request_rate_limit: "tooManyAttempts",
    over_email_send_rate_limit: "emailRateLimit",
    captcha_failed: "captchaFailed",
    request_timeout: "requestTimeout",
} as const satisfies Record<string, AuthSentence>;

export type AuthErrorCode = keyof typeof AUTH_ERROR_SENTENCES;

/**
 * The shared table with `fixed` entries (a screen's own wording, returned
 * as given) in place of the shared sentence for their codes. The shared
 * sentences are read in the configured locale at the moment of use.
 */
function liveTable(
    fixed: Readonly<Record<string, AuthOverride>> = {},
): Readonly<Record<string, string>> {
    const table: Record<string, string> = {};
    for (const [code, sentence] of Object.entries(AUTH_ERROR_SENTENCES)) {
        if (Object.hasOwn(fixed, code)) continue;
        Object.defineProperty(table, code, {
            enumerable: true,
            get: () => say(clientTranslator(), sentence),
        });
    }
    for (const [code, override] of Object.entries(fixed)) {
        if (typeof override === "function") {
            Object.defineProperty(table, code, {
                enumerable: true,
                get: override,
            });
        } else {
            Object.defineProperty(table, code, {
                enumerable: true,
                value: override,
            });
        }
    }
    return Object.freeze(table);
}

/**
 * A screen's own wording for a code: the text itself, or a function that
 * reads it from the catalog. A table built at module scope must use the
 * function form, because the locale is not known until the app configures it;
 * the function runs each time the sentence is read.
 */
export type AuthOverride = string | (() => string);

/** The shared table, in the configured locale. */
export const AUTH_ERROR_MESSAGES = liveTable() as Readonly<Record<AuthErrorCode, string>>;

/**
 * The shared table with this screen's deltas applied. Overrides are typed
 * loosely on purpose: a screen may add a code only its own route emits.
 */
export function authMessages(
    overrides: Readonly<Record<string, AuthOverride>> = {},
): Readonly<Record<string, string>> {
    return liveTable(overrides);
}

/** The shared sentence in the configured locale, read now. */
export function authSentenceText(sentence: AuthSentence): string {
    return say(clientTranslator(), sentence);
}

/** The shared sentence as an override: read when the table is used. */
export function authSentence(sentence: AuthSentence): () => string {
    return () => authSentenceText(sentence);
}

// Sentences screens reuse as their own overrides. They are the source
// (en-US) wording, fixed when the module loads; a screen moved to the
// catalog (cards 0D1 and 0D2) reads the tables above or its own t() instead.
export const TOO_MANY_ATTEMPTS_MESSAGE = say(sourceTranslator, "tooManyAttempts");
export const PASSWORD_LENGTH_MESSAGE = say(sourceTranslator, "passwordLength");
/** Wording for a link that has been used, tampered with, or has expired. */
export const LINK_SPENT_MESSAGE = say(sourceTranslator, "linkSpent");
