/**
 * 5xx codes the server side has already reported in its own log, and what
 * each tells the user.
 *
 * The backend (`schema_out_of_date`, and `upstream_unavailable` when GoTrue is
 * unreachable) and the Next gateway (`upstream_unavailable` when the backend
 * is unreachable) each log one report per failure, with detail a client
 * cannot see. A client copy would be one more report per endpoint per page
 * view for the same incident, so every client that reports 5xx answers (the
 * web app's mikeApi and authApi, the Word add-in's API client) checks this
 * table first: these codes are only marked handled, and show their own
 * sentence instead of the generic server-failure one.
 */
import { SOURCE_MESSAGES } from "@litt/i18n";
import { clientTranslator, sourceTranslator } from "./locale";

/**
 * The backend's answer when its database is missing a migration (PGRST202/
 * 203/204/205, 42P01, 42703). Unlike other 5xx it tells the user something actionable
 * (contact whoever runs the server).
 */
export const SCHEMA_OUT_OF_DATE_CODE = "schema_out_of_date";
/** The sentence in the source language; reportedUpstreamMessage translates it. */
export const SCHEMA_OUT_OF_DATE_MESSAGE = sourceTranslator("errors.upstream.schema_out_of_date");
/**
 * A dependency is unreachable: the gateway cannot reach the backend, or the
 * backend cannot reach GoTrue (503). Whoever saw it reports it once per
 * outage; the user can only wait and retry.
 */
export const UPSTREAM_UNAVAILABLE_CODE = "upstream_unavailable";
/** The sentence in the source language; reportedUpstreamMessage translates it. */
export const UPSTREAM_UNAVAILABLE_MESSAGE = sourceTranslator("errors.upstream.upstream_unavailable");

type ReportedUpstreamCode = keyof typeof SOURCE_MESSAGES.errors.upstream;

/**
 * The fixed user-facing message for a code the server side already
 * reported, in the configured locale, or null for any other code (report it
 * as usual). The codes are the keys of the catalog's `errors.upstream`.
 */
export function reportedUpstreamMessage(
    code: string | null | undefined,
): string | null {
    if (!code || !Object.hasOwn(SOURCE_MESSAGES.errors.upstream, code)) return null;
    return clientTranslator()(`errors.upstream.${code as ReportedUpstreamCode}`);
}
