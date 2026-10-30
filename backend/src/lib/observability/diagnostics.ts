/**
 * Diagnostic vocabulary for local, sanitized error logs. Adapted from
 * upstream's privacy boundary with the telemetry SDK removed: LiTT sends no
 * telemetry to third parties, so these helpers only decide which labels and
 * technical codes may appear in the server log (see ./report.ts).
 * Never infer whether arbitrary text is PII: keep only source-authored
 * labels, fixed protocol vocabulary and identifiers of known shape.
 */
type RecordValue = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Application-authored diagnostic labels. New labels need no registration.
 * Keep them static in source, never derive them from user/dependency data.
 * The source-contract test checks common violations; this format check is
 * defense in depth, not a claim that identifier-shaped text cannot be PII.
 */
export type Operation = string;
export type Stage = string;
export type ErrorKind = string;

export function isDiagnosticLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 100
    && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(value);
}

const APPLICATION_TAGS = new Set(['operation', 'error_kind', 'component', 'stage', 'job_kind']);
// Only our error constructor may supply a free-form kind. A dependency's
// arbitrary `kind` property must not become telemetry just because it fits.
const APPLICATION_KIND = Symbol.for('mike.diagnostic.errorKind');

/** Called by AppError, not with an upstream payload. No per-kind registry. */
export function identifyApplicationError(error: object, kind: ErrorKind): void {
  if (isDiagnosticLabel(kind)) Object.defineProperty(error, APPLICATION_KIND, { value: kind });
}

/** Fixed external protocol vocabulary; application labels use the source contract above. */
export const DIAGNOSTIC_VOCABULARY: Record<string, ReadonlySet<string>> = Object.fromEntries(Object.entries({
  service: 'mike-backend mike-frontend mike-word-addin',
  role: 'api worker worker-thread job',
  runtime: 'browser server edge',
  surface: 'taskpane commands dialog',
  install: 'community official',
  http_method: 'GET POST PUT PATCH DELETE HEAD OPTIONS',
  // Every code a server emits (frontend/src/shared/lib/userError.ts CODE_KINDS) plus the client's own two.
  error_code: 'internal_error network_error upstream_unavailable schema_out_of_date rate_limited upload_session_control_rate_limit upload_session_poll_rate_limit upload_session_rate_limit_exceeded request_too_large upload_file_too_large upload_batch_too_large validation_failed invalid_request invalid_json password_too_short password_too_long email_address_invalid upload_incomplete missing_api_key model_unavailable model_required authentication_failed session_expired cookie_session_required mfa_verification_required untrusted_origin review_running review_stale memory_revision_conflict upload_target_busy access_inherited ask_inputs_stale',
  capture_source: 'exception console unhandled message',
  diagnostics_version: '2',
  build_mode: 'development production test',
  failure_code: 'ECONNREFUSED ECONNRESET EADDRINUSE ETIMEDOUT ENOTFOUND EHOSTUNREACH ENETUNREACH EAI_AGAIN ENOENT EACCES EPERM ENOSPC EPIPE ERR_SERVER_NOT_RUNNING UND_ERR_CONNECT_TIMEOUT UND_ERR_HEADERS_TIMEOUT UND_ERR_SOCKET CERT_HAS_EXPIRED DEPTH_ZERO_SELF_SIGNED_CERT AccessDenied InvalidAccessKeyId SignatureDoesNotMatch NoSuchBucket NoSuchKey SlowDown ServiceUnavailable RequestTimeout 23505 23503 23514 22003 22P02 28P01 28000 42P10 42883 42501 42P01 42703 53300 57014 08006 PGRST100 PGRST116 PGRST200 PGRST201 PGRST202 PGRST203 PGRST204 PGRST205 configuration_invalid signing_key_invalid conversion_unavailable conversion_timeout conversion_failed fetch_failed',
  provider_error: 'invalid_api_key api_call retry_exhausted',
  network_state: 'online offline unknown',
  request_origin: 'same-origin cross-origin unknown',
  file_type: 'pdf doc docx odt rtf ppt pptx xls xlsx csv txt html',
  diagnostic_test: 'true',
  office_code: 'GeneralException InvalidArgument InvalidObjectPath ItemNotFound AccessDenied NotAllowed DocumentNotSaved UnsupportedOperation InvalidOperation InvalidReference',
  office_host: 'Word',
  office_platform: 'PC Mac OfficeOnline Universal iOS Android',
  storage: 'local cloud',
  storage_operation: 'HEAD copy upload download delete',
  // Node's own process warnings (reported by the backend's 'warning' listener).
  warning_name: 'Warning DeprecationWarning ExperimentalWarning MaxListenersExceededWarning TimeoutOverflowWarning TimeoutNegativeWarning UnsupportedWarning',
}).map(([key, values]) => [key, new Set(values.split(' '))]));
const ENUMS = DIAGNOSTIC_VOCABULARY;
const ROUTE_PARTS = new Set(('word-chat orgs single-documents tabular-review quick-actions workflow-addons audit manifest-signing-key api auth login logout refresh session user users projects directory people access memory ids filter-options folder-paths resolve folder documents versions files folders upload uploads upload-sessions parts complete abort content download preview source text conversion chats chat messages stream cancel assistant tabular tabular-reviews reviews rows columns cells run results export workflows playbooks templates library models configured ollama openrouter vercel opencode-go bedrock azure azure-foundry vertex xai custom settings profile organizations members permissions shares keys api-keys health observability').split(' '));
const ID_KEYS = new Set(('request_id requestId document_id documentId file_id fileId job_id jobId review_id reviewId row_id rowId session_id sessionId version_id versionId run_id import_id playbook_id').split(' '));
const CONFIGURATION_FIELDS = new Set('SUPABASE_URL SUPABASE_PUBLISHABLE_KEY SUPABASE_SECRET_KEY AUTH_HANDOFF_ENCRYPTION_SECRET FRONTEND_URL API_PUBLIC_URL WORD_ADDIN_URL GIT_SHA'.split(' '));

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

/** Only fixed route vocabulary survives; names, ids, queries and fragments do not. */
export function diagnosticRoute(value: string): string {
  return (value.replace(/^(?:https?:)?\/\/[^/]+/i, '').split(/[?#]/)[0] || '/')
    .split('/').slice(0, 16).map(part => !part || ROUTE_PARTS.has(part) ? part : ':id').join('/');
}

/** Keep only allowlisted diagnostic tags; everything else is dropped. */
export function diagnosticTags(value: unknown): RecordValue {
  const out: RecordValue = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (APPLICATION_TAGS.has(key) && isDiagnosticLabel(entry)) out[key] = entry;
    else if (typeof entry === 'string' && Object.hasOwn(ENUMS, key) && ENUMS[key]!.has(entry)) out[key] = entry;
    else if (ID_KEYS.has(key) && typeof entry === 'string' && UUID.test(entry)) out[key] = entry;
    else if (key === 'configuration_fields' && typeof entry === 'string' && entry.length < 250 && entry.split(',').every(field => CONFIGURATION_FIELDS.has(field))) out[key] = entry;
    else if (key === 'office_version' && typeof entry === 'string' && /^\d+(?:\.\d+){1,4}$/.test(entry) && entry.length < 30) out[key] = entry;
    else if (key === 'warning_code' && typeof entry === 'string' && /^DEP\d{4}$/.test(entry)) out[key] = entry;
    else if (key === 'what' && isDiagnosticLabel(entry)) out.stage = entry;
    else if (key === 'http_route' && typeof entry === 'string') out[key] = diagnosticRoute(entry);
    else if ((key === 'http_status' || key === 'dependency_status') && /^\d{3}$/.test(String(entry)) && Number(entry) >= 100 && Number(entry) <= 599) out[key] = Number(entry);
    else if (key === 'network_failure_count' && Number.isInteger(entry) && Number(entry) >= 1 && Number(entry) <= 100000) out[key] = Number(entry);
    else if ((key === 'network' || key === 'project') && (entry === true || entry === false || entry === 'true' || entry === 'false')) out[key] = entry;
  }
  return out;
}

/** Extract application kinds and fixed technical codes from wrapped/AggregateError causes.
 * Never copy error messages, SQL details, storage keys, URLs or SDK metadata.
 */
export function diagnosticErrorTags(error: unknown): Record<string, string | number> {
  const tags: Record<string, string | number> = {};
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  for (let n = 0; pending.length && n < 12; n++) {
    const candidate = pending.shift();
    if (!candidate || typeof candidate !== 'object' || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      const item = candidate as RecordValue;
      if (typeof item.operation === 'string' && ENUMS.storage_operation!.has(item.operation)) tags.storage_operation = item.operation;
      if (Array.isArray(item.configurationFields)) {
        const fields = [...new Set(item.configurationFields.slice(0, 10).filter(field => typeof field === 'string' && CONFIGURATION_FIELDS.has(field)))];
        if (fields.length) tags.configuration_fields = fields.sort().join(',');
      }
      const providerError = item.name === 'InvalidApiKeyError' ? 'invalid_api_key'
        : item.name === 'AI_APICallError' ? 'api_call'
          : item.name === 'AI_RetryError' ? 'retry_exhausted' : undefined;
      if (providerError && tags.provider_error === undefined) tags.provider_error = providerError;
      // AppError identity: the thrower's own static label, never a dependency property.
      // The deepest kind wins: a wrapper names the operation that failed, the
      // cause names why (breadth-first, so a later visit is never shallower).
      const applicationKind = (candidate as Record<symbol, unknown>)[APPLICATION_KIND];
      if (isDiagnosticLabel(applicationKind)) tags.error_kind = applicationKind;
      for (const code of [item.code, item.name]) {
        if (typeof code === 'string' && ENUMS.failure_code!.has(code) && tags.failure_code === undefined) tags.failure_code = code;
      }
      const status = item.status ?? item.statusCode ?? record(item.$metadata).httpStatusCode;
      if (Number.isInteger(status) && Number(status) >= 400 && Number(status) <= 599 && tags.dependency_status === undefined) tags.dependency_status = Number(status);
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
      if (typeof message === 'string' && ['Failed to fetch', 'fetch failed', 'Load failed', 'NetworkError when attempting to fetch resource.'].includes(message)) tags.failure_code = 'fetch_failed';
    } catch { /* Exotic errors must not break reporting. */ }
  }
  return tags;
}
