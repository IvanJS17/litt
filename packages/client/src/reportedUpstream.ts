import { SOURCE_MESSAGES } from "@litt/i18n";
import { clientTranslator, sourceTranslator } from "./locale";

/** Ownership is explicit; a status or display code never establishes it. */
export const BACKEND_REPORTING_OWNER = "backend";

/*
 * Fixed public messages for upstream failure codes. Reporting ownership is
 * carried separately by reporting_owner; a known code never proves handling.
 */

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
 * The fixed user-facing message for a known upstream failure code, in the
 * configured locale, or null for any other code. The codes are the keys of
 * the catalog's `errors.upstream`.
 */
export function reportedUpstreamMessage(
    code: string | null | undefined,
): string | null {
    if (!code || !Object.hasOwn(SOURCE_MESSAGES.errors.upstream, code)) return null;
    return clientTranslator()(`errors.upstream.${code as ReportedUpstreamCode}`);
}
