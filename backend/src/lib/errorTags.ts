/**
 * Structured classification for a failure, used by product logic that has to
 * branch on WHY a dependency call failed (document search maps a
 * `failure_code` to a user-facing message) and by the server log.
 *
 * Only fixed vocabulary leaves this module: codes, operation names, provider
 * error classes, HTTP status numbers and configuration field NAMES. Error
 * messages, SQL details, storage keys, URLs and arbitrary properties are
 * never copied — never infer whether free text carries a secret.
 */
type RecordValue = Record<string, unknown>;

// Errno, S3, Postgres and PostgREST codes, plus the codes this backend sets
// on its own errors. Anything not listed could be free text, so it is dropped.
const FAILURE_CODES = new Set(
  (
    "ECONNREFUSED ECONNRESET EADDRINUSE ETIMEDOUT ENOTFOUND EHOSTUNREACH " +
    "ENETUNREACH EAI_AGAIN ENOENT EACCES EPERM ENOSPC EPIPE " +
    "ERR_SERVER_NOT_RUNNING UND_ERR_CONNECT_TIMEOUT UND_ERR_HEADERS_TIMEOUT " +
    "UND_ERR_SOCKET CERT_HAS_EXPIRED DEPTH_ZERO_SELF_SIGNED_CERT " +
    "AccessDenied InvalidAccessKeyId SignatureDoesNotMatch NoSuchBucket " +
    "NoSuchKey SlowDown ServiceUnavailable RequestTimeout 23505 23503 23514 " +
    "22003 22P02 28P01 28000 42P10 42883 42501 42P01 42703 53300 57014 08006 " +
    "PGRST100 PGRST116 PGRST200 PGRST201 PGRST202 PGRST203 PGRST204 PGRST205 " +
    "configuration_invalid signing_key_invalid conversion_unavailable " +
    "conversion_timeout conversion_failed fetch_failed"
  ).split(" "),
);

const STORAGE_OPERATIONS = new Set(
  "HEAD copy upload download delete".split(" "),
);

const CONFIGURATION_FIELDS = new Set(
  (
    "SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY " +
    "AUTH_HANDOFF_ENCRYPTION_SECRET FRONTEND_URL API_PUBLIC_URL WORD_ADDIN_URL"
  ).split(" "),
);

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

/**
 * Extract only finite diagnostic vocabulary, including wrapped/AggregateError
 * causes. Never copy error messages, SQL details, storage keys, URLs or SDK
 * metadata.
 */
export function diagnosticErrorTags(
  error: unknown,
): Record<string, string | number> {
  const tags: Record<string, string | number> = {};
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  for (let n = 0; pending.length && n < 12; n++) {
    const candidate = pending.shift();
    if (!candidate || typeof candidate !== "object" || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    try {
      const item = candidate as RecordValue;
      if (
        typeof item.operation === "string" &&
        STORAGE_OPERATIONS.has(item.operation)
      ) {
        tags.storage_operation = item.operation;
      }
      if (Array.isArray(item.configurationFields)) {
        const fields = [
          ...new Set(
            item.configurationFields
              .slice(0, 10)
              .filter(
                (field) =>
                  typeof field === "string" && CONFIGURATION_FIELDS.has(field),
              ),
          ),
        ];
        if (fields.length) tags.configuration_fields = fields.sort().join(",");
      }
      const providerError =
        item.name === "InvalidApiKeyError"
          ? "invalid_api_key"
          : item.name === "AI_APICallError"
            ? "api_call"
            : item.name === "AI_RetryError"
              ? "retry_exhausted"
              : undefined;
      if (providerError && tags.provider_error === undefined) {
        tags.provider_error = providerError;
      }
      for (const code of [item.code, item.name]) {
        if (
          typeof code === "string" &&
          FAILURE_CODES.has(code) &&
          tags.failure_code === undefined
        ) {
          tags.failure_code = code;
        }
      }
      const status =
        item.status ?? item.statusCode ?? record(item.$metadata).httpStatusCode;
      if (
        Number.isInteger(status) &&
        Number(status) >= 400 &&
        Number(status) <= 599 &&
        tags.dependency_status === undefined
      ) {
        tags.dependency_status = Number(status);
      }
      if (item.cause) pending.push(item.cause);
      if (item.lastError) pending.push(item.lastError);
      if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 5));
    } catch {
      // Host objects/proxies may have throwing accessors. Reporting must not throw.
    }
  }
  if (tags.failure_code === undefined) {
    try {
      // Compare entire fixed runtime messages; never retain any of their text.
      const message = record(error).message;
      const fetchFailures = [
        "Failed to fetch",
        "fetch failed",
        "Load failed",
        "NetworkError when attempting to fetch resource.",
      ];
      if (typeof message === "string" && fetchFailures.includes(message)) {
        tags.failure_code = "fetch_failed";
      }
    } catch {
      /* Exotic errors must not break reporting. */
    }
  }
  return tags;
}
