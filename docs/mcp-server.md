# LiTT MCP server — authorization server and `/mcp`

**Status:** On in production since 2026-11-17 (release `20261117c`, `LITT_MCP_SERVER=enabled`, `LITT_MCP_PUBLIC_URL=https://mcp.litt.asteroitt.com`). Live checks pass (metadata, `401` with `resource_metadata`, registration `201`, authorize `302` to consent). Registration first failed with `42501` (the MCP tables had no `service_role` grant), fixed by PR #229. Real Claude/ChatGPT login and tool call: pending (owner account).

LiTT can be connected to an AI app that speaks the Model Context Protocol
(Claude, ChatGPT, Codex, Hermes). This page describes what the backend serves
today: the OAuth authorization server and the `/mcp` endpoint with its
per-call gate (live revalidation, scopes, per-connection limits, audit) and
the real tools: workspaces, matters, documents, uploads, playbooks, tabular
review, the assistant's chat, workflows and quick actions, and compare and
convert (see [Tools](#tools)).

Everything is behind `LITT_MCP_SERVER`. With the default (`disabled`) no MCP
route answers: the requests fall through to the normal 404.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `LITT_MCP_SERVER` | `disabled` | `enabled` turns the whole surface on. |
| `LITT_MCP_PUBLIC_URL` | `http://127.0.0.1:$PORT` outside production | Origin of the MCP host. It is the OAuth issuer; the resource clients name is `<origin>/mcp`. Required in production, and must be https there; without it the server stays off and the backend logs why. |
| `LITT_MCP_CONSENT_URL` | `FRONTEND_URL` | Origin of the web app whose `/connect/authorize` page asks the person to approve. |
| `LITT_MCP_ALLOWED_ORIGINS` | none | Browser origins that may call `/mcp` (comma separated). Callers without an `Origin` header (Claude, ChatGPT, Hermes) need nothing. |
| `LITT_MCP_CIMD` | enabled | `disabled` stops advertising and fetching client metadata documents, so clients register dynamically. |
| `LITT_MCP_RUN_WAIT_MS` / `LITT_MCP_RUN_POLL_MS` | 45000 / 1000 | How long `run_*` tools wait for their work before answering `running`, and how often they look (wait is capped at 120 000). |
| `LITT_MCP_ACCESS_TTL_SECONDS` | 3600 | Access-token lifetime. |
| `LITT_MCP_REFRESH_TTL_DAYS` | 30 | Refresh-token lifetime (each refresh issues a new one). |
| `LITT_MCP_GRANT_MAX_DAYS` | 90 | Absolute life of a connection; after it the person connects again. |
| `RATE_LIMIT_MCP_GRANT_READ_MAX` / `RATE_LIMIT_MCP_GRANT_READ_WINDOW_SECONDS` | 120 / 60 | Read budget of one connection. |
| `LITT_MCP_HEAVY_PER_USER` / `LITT_MCP_HEAVY_GLOBAL` | 2 / 4 | Heavy jobs started from MCP that may run at once per person and in the whole process (design §9.4; see «Heavy-job cap»). |
| `RATE_LIMIT_MCP_GRANT_WRITE_MAX` / `RATE_LIMIT_MCP_GRANT_WRITE_WINDOW_MINUTES` | 30 / 15 | Budget of one connection for calls that write, run an engine, spend or chat. |
| `LITT_MCP_UNAPPROVED_CLIENTS_MAX` | 10000 | Cap on client rows (registered or metadata-document) that no connection refers to now (nobody approved them, or their last connection expired or was revoked more than 30 days ago and the clean-up removed it). See «Limits on unapproved clients». |
| `RATE_LIMIT_MCP_REGISTER_MAX` / `RATE_LIMIT_MCP_REGISTER_WINDOW_HOURS` | 60 / 1 | Registrations from one address. |
| `RATE_LIMIT_MCP_AUTHORIZE_MAX` / `RATE_LIMIT_MCP_AUTHORIZE_WINDOW_HOURS` | 120 / 1 | `GET /oauth/authorize` requests from one address. The consent page and the token endpoints are not counted. |

Every numeric setting above (and every `RATE_LIMIT_*` setting of the backend) is taken only when written
as a whole number in plain digits, from 1 up (from 0 for `LITT_MCP_RUN_WAIT_MS` and `LITT_MCP_RUN_POLL_MS`),
with at most 15 digits and no leading zero (`10000`, not `10,000`, `10k`, `1e4` or `010`; spaces around
the number are ignored); any other value uses the default and the backend writes one line naming the setting
(never its value) the first time it is read. `LITT_MCP_ACCESS_TTL_SECONDS` has a ceiling of 31 536 000
(one year) and `LITT_MCP_REFRESH_TTL_DAYS` and `LITT_MCP_GRANT_MAX_DAYS` of 36 500: a larger value is the
ceiling, and the same line says so.

The proxy that makes the backend reachable at the MCP host, its DNS name and
its Caddy block are infrastructure and are not part of the backend.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` and `…/mcp` | Protected resource metadata (RFC 9728). |
| `GET /.well-known/oauth-authorization-server` | Authorization server metadata (RFC 8414): PKCE `S256` only, public clients (`none`), `client_id_metadata_document_supported`, `authorization_response_iss_parameter_supported`. |
| `POST /oauth/register` | Dynamic client registration (RFC 7591), public clients only. Unused registrations are purged. |
| `GET /oauth/authorize` | Validates client, `redirect_uri`, PKCE and `resource`, stores the request and redirects to the web consent page. Every answer to the client carries `iss` (RFC 9207), errors included. |
| `POST /oauth/token` | `authorization_code` with PKCE, and `refresh_token` with rotation. |
| `POST /oauth/revoke` | RFC 7009. Revoking any token of a connection revokes the connection. |
| `ALL /mcp` | Streamable HTTP MCP endpoint (both 2025-11-25 and 2026-07-28 revisions, stateless). |
| `GET/POST /mcp-connect/authorizations/:id[/decision]` | What the consent page calls, under the person's web session. |
| `GET /mcp-connect/grants`, `DELETE /mcp-connect/grants/:id` | The person's connected apps: list and revoke. Each grant carries `app` (`claude`, `chatgpt` or `null`), derived only from the host of its OAuth `client_id` (exact host `claude.ai`/`anthropic.com` or `openai.com`/`chatgpt.com`, https), never from the self-declared `client_name`; the screen shows a brand logo only for a non-null `app`. |

### Clients

* **Client metadata documents (CIMD).** A `client_id` that is an https URL is
  fetched. The fetch goes through the same guarded egress as MCP connectors
  (public https only, addresses validated at connect time, nothing internal or
  link-local), follows **no** redirect, and is capped at 5 s and 64 KB. The
  document must name the same `client_id`, must not carry a secret and must list
  valid redirect URIs. It is cached for an hour.
* **Dynamic registration.** Redirect URIs must be https, or http on
  `localhost` / `127.0.0.1` / `[::1]`, without fragments.
* **Limits on unapproved clients.** Registration and the first sight of a
  metadata-document client create a client row without any person's consent.
  When the clients that no connection refers to reach
  `LITT_MCP_UNAPPROVED_CLIENTS_MAX`, a request that would create another one is
  refused before anything is fetched or written: registration answers `429`
  `temporarily_unavailable`, and `/oauth/authorize` shows the same error on the
  page. A client that already has a row (approved or not, including the refresh
  of an expired metadata document) keeps working, approving a client takes it
  out of the count, and nothing is deleted by the cap. While the count stays at
  the number no new client can be created: it goes down when a client is
  approved, when the existing clean-up removes unapproved clients idle for
  seven days (it runs at every registration and, at most once a minute per
  process, when a first-seen metadata-document client meets the number; the
  request is refused only if the number is still met afterwards), or when the
  operator raises the
  number. A signed-in person opening the approval screen of a request marks
  its client as in use, which keeps the client, and so its open request, from
  the clean-up; `GET /oauth/authorize` never marks a client. The refusal is written
  to the server log once per process and kind, without the client or the
  address. The token endpoints never create a client: a first-seen client
  there is unknown (`invalid_client`), with nothing fetched or written. So per
  address and hour, at the defaults, registration writes at most 60
  `client_registered` audit rows and `/oauth/authorize` at most 240 audit rows
  (`cimd_rejected`, or `cimd_fetched` plus `authorization_requested`), and
  those are the only paths that create a client.
* **Redirect matching.** Exact, except a loopback redirect may use any port
  (RFC 8252 §7.3), with host and path still exact.

### Consent

`/oauth/authorize` sends the browser to `/connect/authorize?request=<id>` in the
web app. The person must be signed in (the login page returns to the request)
and, when they have two-step verification enrolled, must have verified it
(`aal2`); the consent records that. The page shows the app, the address it will
return to (with a warning when the app runs on the person's own machine), the
permissions asked and the workspaces the person may choose (Personal, unless
their firm manages the account, and each firm they belong to). One connection
may cover several workspaces.

### Tokens

Opaque 256-bit values; the database holds only SHA-256. An access token lasts an
hour. A refresh token is single use: the response to a refresh carries the new
one, and presenting a used one revokes the whole connection (as does replaying an
authorization code). A token works only at this server's resource, for a live
connection, for an account that is not being deleted; the check reads the
database on every call, so revoking takes effect on the next one.

Signing out everywhere (`POST /auth/logout` with `scope: "global"`) and setting a
new password with the sign-out option (the account-recovery page) also end the
person's connections: `user_profiles.sessions_ended_at` is stamped once the
sessions are revoked (if it cannot be written the sessions still end and the request answers `500`), and a connection made at or before it is refused as
`401 invalid_token` / `invalid_grant` at the token check, the refresh, the code
exchange and the per-call gate, so its access and refresh tokens and any
unredeemed code stop working; the connections are then also revoked in the
records (`revoked_reason` `signed_out_everywhere` or `password_recovery_sign_out`, one `grant_revoked` audit event
each), best effort: the stamp is what ends them. A connection is dated from the arrival of its approval request, so one whose request arrived before the sign-out is ended by it; one approved afterwards works. A sign-out
on one device, or a password change without the sign-out option, does not end them.

`/mcp` without a token answers `401` with
`WWW-Authenticate: Bearer resource_metadata="…", scope="litt.read litt.run litt.write litt.chat"`.

Two properties of the token paths worth knowing:

* **Claim, then validate.** An authorization code and a refresh token are marked
  used *before* the checks that can still refuse them (client, redirect, PKCE,
  expiry). A request that fails those checks has therefore already spent the
  credential. That is deliberate: it makes a replayed credential impossible to
  race, and a spent one is only ever presented again by someone who holds a
  copy, which is what revokes the connection. The cost is that a legitimate
  client that sends a wrong `code_verifier` must start the authorization again.
* **`/oauth/authorize` writes before a session exists.** It stores the pending
  request (short-lived, hash of its id only) before the person has signed in; the
  consent page, under the person's own session, is what turns it into a
  connection. Abandoned requests are purged by the registration housekeeping.

### The gate on every call to `/mcp`

Each request to `/mcp` is judged on the database as it is now, not on what the
connection said when it was approved (`mcp.principal.ts`, `mcp.endpoint.ts`):

| Check | Refusal |
| --- | --- |
| Token is a live access token bound to this resource | `401 invalid_token` |
| Connection not revoked, not past its absolute life (read again) | `401 invalid_token` |
| Account not being deleted | `401 invalid_token` |
| Firm-managed account: `personal` is dropped from the workspaces; if that leaves none | `403 personal_workspace_disabled` |
| Active membership (firm not deleted) in each firm of the grant: workspaces the person left are dropped; if none is left | `403 workspace_not_found` |
| Each firm's authorization epoch read for the call (`McpWorkspace.authorizationEpoch`; queued work carries it) | read failure → sanitized `500`, never an open workspace |
| Training stage: any stage in a firm makes that workspace mode **A**; the principal's `mode` is `A` if any live workspace is | tools that run the client's own AI (`mode: "B"`) answer `mode_not_available` there |
| The tool's scope is in the grant | `403 insufficient_scope` with `WWW-Authenticate … scope="<missing>"`; tools the grant has no scope for are not listed |
| The connection's budget for the tool's lane | `429 rate_limited` with `Retry-After` |

The result is a typed principal `{ userId, grantId, clientId, scopes,
workspaces (live), defaultWorkspace, mode, personalWorkspaceDisabled }`. The
email is **not** part of it yet (email-keyed grants match nothing); tools that
need it will read it confirmed. The request also binds the managed-account
principal that the rest of the backend asks (`bindRequestPrincipal`).

Tools are declared with `defineMcpTool` (`mcp.tools.ts`, listed in
`mcp.catalog.ts`): the scope they need, their lane (`read` or `write`), whether
they take a `workspace`, the mode they run in, and whether the call is audited
`strict`ly. The wrapper then gives every tool the scope re-check, the live
workspace check, the mode rule, the audit and sanitized errors. A tool throws
`McpToolError(code, detail, suggestedAction)` for an expected failure; anything
else reaches the client only as `internal_error`.

**Rate limits.** Per connection, not per IP (all of a vendor's clients share a
few addresses). Two lanes: `read` (120 per minute; also the protocol's own
requests) and `write` (30 per 15 minutes: writes, engine runs, spending, chat).
In-memory, per process, like the API's other limiters. `/mcp` also passes the
generous IP lane in `app.ts`.

**Heavy-job cap** (`mcp.heavy.ts`; design §9.4). The host has 2 CPU and 3.7 GB, so
the risk is not the call rate but several heavy jobs at once. A person may have
**2** heavy jobs started from MCP running, and the process **4**
(`LITT_MCP_HEAVY_PER_USER` / `LITT_MCP_HEAVY_GLOBAL`). The call that would pass
either is refused with `heavy_jobs_busy` (`retryable: true`,
`retry_after_seconds: 30`, a `suggested_action` naming the tools that follow the
running jobs, «Nothing was started»). The check runs in `runTool`
(`mcp.tools.ts`) after the scope, workspace, mode and cost-confirmation checks
and **before** the strict audit row and the handler, so a refused call writes no
`audit_events` row and starts nothing; `mcp_tool_calls` records it as
`rate_limited` / `heavy_jobs_busy`. The code is in `CODE_KINDS` (`rate_limited`
kind, so clients offer Retry) with en-US and es-MX sentences.

Every tool that writes declares whether it is heavy (a catalog test fails for a
new write tool that is neither heavy nor listed as a light write):

| Class | Tools |
| --- | --- |
| `background` (the work outlives the call; the slot stays until it ends) | `run_playbook_review`, `run_tabular_review`, `start_chat`, `send_chat_message`, `start_project_chat`, `send_project_chat_message`, `send_tabular_chat_message`, `run_workflow`, `run_quick_action`, `read_scanned_document` |
| `sync` (the work is the call; the slot is released when the handler settles, whether it succeeds, fails or aborts) | `compare_documents`, `convert_document`, `propose_case_file_split`, `create_split_documents` |
| light (no slot) | every read, and `create_matter`, `create_note_document`, `request_document_upload`, `complete_document_upload` (extraction has its own worker, concurrency 3), `submit_playbook_review`, `create_tabular_review` (only sets the grid up), `stop_*` |

A background tool tells the wrapper its job is running with
`call.heavy.hold(probe)`; the probe reads state that already exists: the chat,
project-chat, review-chat or tabular run's `finished` flag, `playbook_runs.status`
(`running`), `document_version_ocr.status` (`processing`). A probe that fails
counts as running until 4 hours (the longest run), so a database blip never
frees capacity by mistake. Acquisition is atomic (count and insert with no
`await` between), so concurrent calls cannot both take the last slot.

**Limits of the mechanism.** (1) It assumes **one backend replica**, as the
design does: the table of slots is in memory like the grant budgets, so two
replicas would each cap on their own. (2) It counts only what MCP started: web
UI work is **not** capped here and does not take or wait for slots (out of scope;
the web has its own guards: one turn per chat, `review_running`, the queue's
concurrency, the worker pools). (3) After a restart the table is empty: a job
the queue resumes is not counted until a new call. (4) The `run_*` tools still
wait up to 45 s for their job, so one call can hold a request for that long.
Memory is not measured by this mechanism; that stays an operations task.

### Audit

`mcp_tool_calls` is insert-only too: one row per call with the tool, connection,
person, client, workspace, mode, outcome (`ok`, `error`, `denied`,
`rate_limited`), error code and latency. It has no column for arguments or
results, so no document text, key or token can reach it; refusals (scope, rate,
workspace, revalidation) are recorded as well. A tool declared `audit: "strict"`
(it writes, spends or takes document text out) first writes an `audit_events`
row with `surface = 'mcp'` and does not run if that insert fails. The row is
filed under the workspace the call runs in and names a matter, a document or a
conversation only when the person may open it, the connection covers its
workspace and it lies in that workspace (`authoriseAuditRefs`, mcp.auditRefs.ts);
any other reference is left out of the row, which notes only its kind
(`refs_dropped`), never its id. Like
`mcp_oauth_audit` it keeps no foreign key, so the history outlives the account.

`mcp_oauth_audit` is insert-only (the database refuses UPDATE and DELETE). It
records registrations, rejected metadata documents (with the reason), consent
granted and denied, token issue and refresh, reuse detection and revocation. It
never stores a token, code, PKCE value or state. Consent fails closed: with no
way to write the record there is no connection.

## Tools

All tools are declared with `defineMcpTool` in `backend/src/modules/mcp/mcp.tools.<topic>.ts`
and listed in `mcp.catalog.ts`. A connection sees only the tools its scopes allow.
Names are at most 64 characters; reads and writes are separate tools.

| Tool | Scope | Annotations | What it does |
| --- | --- | --- | --- |
| `whoami` | `litt.read` | read-only | Who the connection is, its workspaces and modes. |
| `list_workspaces` | `litt.read` | read-only | The workspaces of the connection with name, the person's role and mode. |
| `find_matters` | `litt.read` | read-only | Lists or searches matters in one workspace (default: the connection's), newest activity first, with `match_score` and `ambiguous` when a query is given. Cursor pagination. |
| `get_matter` | `litt.read` | read-only | One matter: details, role, folders, document count, participants (display name and role only, no addresses). |
| `list_matter_documents` | `litt.read` | read-only | Documents and sub-folders of one folder level, with current version, status, `has_scan_pages`, `training_held`. Cursor pagination. |
| `search_documents` | `litt.read` | read-only, strict audit | Literal phrase search in the stored text of a matter, one document or the person's library; located excerpts (version id and character offsets). |
| `read_document` | `litt.read` | read-only, strict audit | A window of a version's stored text (`offset`, `limit_chars` ≤ 60 000, default 30 000) with `next_offset` and `total_chars`. |
| `list_document_versions` | `litt.read` | read-only | Versions of a document: number, source, size, `training_held`. |
| `create_matter` | `litt.write` | additive (`destructiveHint: false`), strict audit | Creates an empty matter with `createProject`, the service behind `POST /projects`: `name` (required, ≤ 300), optional `workspace` (default: the connection's), `matter_number` (the web's `cm_number`, ≤ 100), `practice` (≤ 100) and `visibility` (`private` default, or `organization`, firms only). Returns `id`, `name`, `matter_number`, `practice`, `workspace`, `visibility` and `url` to open it. Membership of the firm, Personal closed to managed accounts and who may open a matter to the firm are the web's rules. |
| `create_note_document` | `litt.write` | additive, strict audit | Creates a NEW Markdown document (`.md`, version 1, `source = 'generated'`) at the top level of a matter from `title` (≤ 120 characters, becomes the file name; a taken name gets ` (2)`…) and `markdown` (≤ 100 000 characters, stored byte for byte). `createNoteDocument` in the documents module: same permission as opening an upload into the matter (edit rights; a viewer gets `forbidden`, anyone who cannot open the matter or whose connection does not cover it gets `not_found`); a pasante's note is sealed like any of their versions. Never changes or deletes a document. Returns `document_id`, `version_id`, `filename`, `matter_id` and `url` (the matter). |
| `get_upload_status` | `litt.read` | read-only | State of an upload, and the new document's id once it is done. |
| `request_document_upload` | `litt.write` | additive (`destructiveHint: false`), strict audit | Opens the web's upload session for one file in a matter and returns a one-time signed `PUT` URL. |
| `complete_document_upload` | `litt.write` | additive, strict audit | After the `PUT`, asks LiTT to seal, verify and process the file. Safe to repeat. |
| `find_playbooks` | `litt.read` | read-only | Ready playbooks the person can use in one workspace (drafts are left out), with `match_score` and `ambiguous`. Cursor pagination. |
| `get_playbook` | `litt.read` | read-only, strict audit | A playbook's rules (ids and names) and its content, a window at a time, as untrusted data. `origin` is `own`, `firm` or `shared`; for `shared` (another account's playbook shared with the person) `shared_by` is that account's display name, cut to one short line, or null. |
| `run_playbook_review` | `litt.run` | additive, strict audit | **Mode A.** LiTT reviews one document against one ready playbook with the person's own governed AI route (`queuePlaybookReview`, the web's engine). Waits up to ~45 s (`LITT_MCP_RUN_WAIT_MS`), else answers `status: running` + `poll_after_s`. Tracked changes only with `apply_tracked_changes: true` (Word files). |
| `get_playbook_run` | `litt.read` | read-only, strict audit | Status, summary and findings of one of the person's runs, a page at a time; the quote, analysis and suggested wording come as untrusted data. |
| `list_playbook_runs` | `litt.read` | read-only | The person's runs in a workspace (optionally one playbook), without findings. |
| `prepare_playbook_review` | `litt.read` | read-only, strict audit, mode B | **Mode B.** The engine's review instructions with the playbook, the rule ids, a window of the document's text (untrusted, egress recorded) and a signed ticket valid for 2 h. Refused with `mode_not_available` in an apprentice's firm. |
| `submit_playbook_review` | `litt.write` | additive, strict audit, mode B | **Mode B.** Takes the client's findings with the ticket, checks rule ids and looks each quote up in the document text (`quote_verified`), and records a completed run with `model = "client_ai"`. Changes no document. |
| `list_tabular_reviews` | `litt.read` | read-only | Tabular reviews of a workspace or matter with columns, document count, `is_running`. Cursor pagination. |
| `create_tabular_review` | `litt.write` | additive, strict audit | `createTabularReview`, the web's service: title, documents, columns `{name, prompt, format?}`, optional matter. Model: the one named or the person's saved tabular model; with neither, `model_required` (nothing picks one). Fills nothing. |
| `get_tabular_review` | `litt.read` | read-only | Columns, rows (a page), progress, `is_running`, `active_generation`. |
| `read_tabular_cells` | `litt.read` | read-only, strict audit | Cells a page at a time with answer, reasoning, citations and their checks as untrusted data; egress recorded per document. |
| `run_tabular_review` | `litt.run` | additive, strict audit | **Mode A.** `startTabularGeneration` (shared with `POST /tabular-review/:id/generate`) on the review's own model and the person's keys; waits ~45 s, else `running`. A second start answers `review_running`. |
| `get_tabular_run_status` | `litt.read` | read-only | Cells done / failed / pending and whether a run is in progress. |
| `stop_tabular_run` | `litt.run` | additive, strict audit | `stopTabularGeneration`, shared with `POST …/generate/stop`. |
| `start_chat` | `litt.chat` | additive, strict audit | Starts a conversation with LiTT's own assistant (optionally in a matter, else in a workspace) and sends its first message. The model and key are governed BYOK and pinned for the conversation: no fallback, `missing_api_key` refuses the call before anything is created. The conversation is marked as coming from the app (`origin = 'mcp'`). Apprentices pass `attempt`/`confidence` ("Tu turno primero"). Waits ~45 s, else `status: generating`. |
| `send_chat_message` | `litt.chat` | additive, strict audit | A message in an existing conversation, continuing from its stored history on its pinned route; `turn_in_progress` (409) while an answer is being written. Same waiting rule. |
| `get_chat_turn` | `litt.chat` | read-only | Polls an answer: `status` (`generating`, `completed`, `needs_input`, `stopped`, `failed`, `interrupted`), the text a window at a time as untrusted data, citations (quotes as untrusted data) and a count of what the assistant did. `wait: true` waits a short while. |
| `stop_chat_turn` | `litt.chat` | additive, strict audit | Stops an answer being written (same standing as sending); what was written is kept. |
| `list_chats` | `litt.chat` | read-only | The person's conversations in a workspace (the web's list), with `origin` / `origin_label`; filter by matter or origin. |
| `get_chat` | `litt.chat` | read-only | A conversation's details and a page of messages (newest page first, cursor for older), as untrusted data; `active_turn` when an answer is being written. |
| `list_retainer_requests` | `litt.read` | read-only | Donna. The requests of one retainer matter (`listMatterRequests`, the web's service), newest received first: title, type, complexity, status, `assignee_level`, dates, `round_count` (never hours). Optional `status` (or `open`), cursor pagination (≤ 50 per page), `total`, `url`. |
| `get_client_profile` | `litt.read` | read-only, strict audit | Donna. The client profile (`getClientProfile`): **only facts a lawyer confirmed and whose source text is unchanged**, each with its citation (document, version, offsets, quote as untrusted data). Pending, rejected and stale facts are only counted (`pending_count`, `stale_count`): the web lists them all, but a proposal is not yet a fact, and the radar and the report use confirmed facts alone. ≤ 100 facts (`truncated`). Quotes of a held pasante version are withheld; the quotes leaving are recorded as `mcp.client_ai_egress`. |
| `get_deadline_radar` | `litt.read` | read-only | Donna. With `matter_id`: the open radar items of that matter (`getMatterRadar`): overdue, within `window_days` (1–90, default 30) or to review. Without it: the person's «Hoy» (`getRadarToday`, the web's `/orgs/:orgId/radar/today`) over every firm workspace of the connection (or one `workspace`), at most 30 days ahead like the web. ≤ 100 items (`truncated`). Citations are pointers (document, version, offsets), not text. |
| `get_retainer_report` | `litt.read` | read-only | Donna. The 30/60/90-day report as the web's JSON preview (`getRetainerReport`, default 90, `locale` es-MX/en-US); lists capped at 50 rows with complete counts. Owner or editor of the matter only (a viewer gets `forbidden`, as the web's 403). Downloads no Word file and marks nothing as sent. |
| `list_workflows` | `litt.read` | read-only | The workflows the person can use in one workspace (the web's Workflows list): title, type (`assistant`/`tabular`), practice, language, role, `url`. Filters `type` and `query`; cursor pagination. |
| `get_workflow` | `litt.read` | read-only, strict audit | One workflow (`getWorkflowDetail`, the web's `GET /workflows/:id`): its instructions a window at a time as untrusted data (the text leaves LiTT, so the audit is strict), and for a tabular workflow its columns; for an assistant workflow the files it carries. Also an MCP prompt: **not yet** (the server declares tools only; a prompt would need its own capability and per-connection registration, so the tool is the one way in this slice). |
| `run_workflow` | `litt.run` (+ `litt.chat` for an assistant workflow, `litt.write` for a tabular one) | additive, strict audit | **Mode A.** An assistant workflow opens a conversation of LiTT's assistant with the workflow picked on the message (`lastUser.workflow`) and the documents attached, through the chat tools' own turn (`runTurn`): the governed BYOK route is pinned, no fallback, "Tu turno primero" for apprentices; returns `chat_id` / `turn_id`, waits ~45 s, else `status: generating` (follow with `get_chat_turn`). A tabular workflow creates a review from the workflow's columns over `document_ids` (`createTabularReview`, with the `workflow_id`) and starts it (`startTabularGeneration`); returns the review and its progress. Needs the workflow usable in the workspace it runs in (`canUseWorkflowInWorkspace`, as the web's pickers). |
| `list_quick_actions` | `litt.read` | read-only | The person's own quick actions (`listQuickActions`, the web's `GET /quick-actions`): name, workflow, `enabled`, `expects_document`, surface `app` or `word`; the request text as untrusted data. |
| `run_quick_action` | `litt.run` (+ `litt.chat`) | additive, strict audit | **Mode A.** Runs one of the person's quick actions as `run_workflow` does for an assistant workflow: the action's own request (plus optional `inputs`) with its workflow and an optional `document_id`. An action that is turned off answers `quick_action_disabled`. |
| `compare_documents` | `litt.write` | additive, strict audit | `compareDocuments`, behind `POST /single-documents/:id/compare`: a NEW Word document with the differences as tracked changes (`source = 'compared'`) next to the original. Both documents must be downloadable by the person (a pasante's unapproved draft is `training_approval_required`), edit rights where the original lives (`forbidden` for a viewer), both Word files in the same matter (`compare_not_supported` otherwise). No model. |
| `preview_document_conversion` | `litt.read` | read-only | `previewDocumentConversion` (`GET …/convert/preview`): what converting to `markdown`, `docx` or `pdf` would lose (a code and a sentence each), the counts inside a Word file and the new name. Creates nothing. |
| `convert_document` | `litt.write` | additive, strict audit | `convertDocument` (`POST …/convert`): a NEW document in the original's matter and folder (`source = 'converted'`); the original does not change. A retained pasante version is `training_approval_required` (409 on the web). No model. |
| `get_scan_reading_state` | `litt.read` | read-only | `getScanReadingState` (`GET /single-documents/:id/ocr`): whether a PDF has pages without text, the reading's status (`none`, `processing`, `ready`, `failed`), the **estimated cost in USD**, `key_available`, `can_edit`. Sends nothing. Same access as opening the document. |
| `read_scanned_document` | `litt.write` | additive, strict audit | `requestScanReading` (`POST …/ocr`, 202): queues the background reading of the scanned pages with LandingAI and answers `status: processing`; follow it with `get_scan_reading_state`. **Needs `acknowledge_cost: true`.** Edit rights (`forbidden`), key (`ocr_key_missing`), a PDF with scans (`ocr_not_supported`), size cap (`ocr_too_large`), a version held for training (`training_approval_required`). |
| `get_case_file_split_state` | `litt.read` | read-only | `getSplitState` (`GET …/split`): pages, characters, **estimated cost**, unread scanned pages, `too_large`, `key_available`, the document types (names). Computed inside LiTT: nothing is sent to LandingAI. A held pasante version is `training_approval_required`, as on the web. |
| `propose_case_file_split` | `litt.write` | additive, strict audit | `proposeSplit` (`POST …/split`): **sends the document's text to LandingAI** with the person's key and returns the proposed groups `{pages, type, identifier}` (identifier as untrusted data). Stores and creates nothing. **Needs `acknowledge_cost: true`.** `split_needs_scan_reading` while scanned pages are unread; LandingAI's refusals as `ocr_key_invalid` / `ocr_no_credits` / `ocr_unavailable`. One synchronous call (≈9 s for 34 pages, 120 s timeout). |
| `create_split_documents` | `litt.write` | additive, strict audit | `createSplitDocuments` (`POST …/split/create`, 201): one NEW PDF per confirmed group `{pages, name, type}` in the original's folder (`source = 'split'`, version 1); the original does not change; any reading already paid for is copied at no cost. `version_id` must be the one proposed on: otherwise `document_version_conflict`. `split_invalid_groups` for bad pages, names or types. Nothing is sent. |

**Workflows, quick actions, compare and convert** (`mcp.tools.workflows.ts`, `mcp.tools.documentOps.ts`; design §4.6, layer 2a). Same permission rules as the web, through the same facades: `workflows.service`, `quickActions.service`, `documents.service` (`compareDocuments`, `previewDocumentConversion`, `convertDocument`), `chat.turn` (via the chat tools' `runTurn`) and the tabular tools' `createReviewFor` / `runReviewFor`. `modules/mcp` queries no table. Only the connection's fence is added: a workflow, document or matter outside the workspaces the connection covers is `not_found`. Scopes: running is `litt.run`, like the playbook and tabular runs; because a run also does what a chat or a review creation does, an assistant workflow also needs `litt.chat` and a tabular one `litt.write`, so `run_workflow` never reaches what `start_chat` or `create_tabular_review` could not (`insufficient_scope` as a tool error, nothing created). Compare and convert write a new document: `litt.write`, write lane, strict audit before running. None of the eight has a mode B, so apprentices may use them: the runs go through "Tu turno primero" (`attempt`, `confidence`) and the sealed-draft rules like any chat. None sits on a route with `requireMfaIfEnrolled` (checked in the catalog test), so no tool of this slice is withheld for MFA. OCR and split are layer 2b, below.

**Scanned pages and case-file split** (`mcp.tools.scans.ts`; design §4.6, layer 2b). Neither has a mode (no model is involved), so apprentices may use all five: the web has no rule of its own for them beyond the training hold, and the tools mirror it (a pasante's unapproved version is `training_approval_required` for the split state, read, propose and create tools alike, to the owner too (`get_scan_reading_state` is not held, as `GET …/ocr` is not on the web); a released one is open to them with edit rights). Same facades as the web (`documents.service`: `getScanReadingState`, `requestScanReading`, `getSplitState`, `proposeSplit`, `createSplitDocuments`) and the same key (`resolveScanKey`: the firm's, then the person's own where the firm allows it; there is no platform key). **Cost confirmation (design §6.4 rule 3).** `read_scanned_document` and `propose_case_file_split` send pages or text to LandingAI and spend the person's credits, so they refuse unless the call says `acknowledge_cost: true`: `cost_not_acknowledged` is answered from `resolveWorkspace`, before the strict audit row, the key lookup, the queue or LandingAI are touched, so nothing is recorded as an action and nothing is sent. The client's AI is told (tool description and error) to say `true` only after showing the person the `estimated_cost_usd` of the matching `get_*_state` and having their go-ahead. It may also pass that `estimated_cost_usd`: if the current estimate is higher by more than half a cent, the call is refused as `cost_changed` and nothing is sent. It is optional on purpose: a client that omits it still has to say `acknowledge_cost: true`, and the check only protects those that pass it; making it mandatory is left to the owner as a product decision. Scope: all three that act are `litt.write` (write lane, strict audit before running), like `compare_documents` and `convert_document`: reading a scan merges text into the document, the split creates documents, and the proposal is the step of that flow that spends; `litt.run` is left for LiTT's own engines (playbook, tabular and chat runs); a `litt.write`-only connection can therefore start spending on the firm's LandingAI key, and `acknowledge_cost` is the control for that, not the scope. The two state tools are `litt.read` (counts, a status and the names of the person's own document types; no document text leaves). Long work: the reading is a durable job (`document_version_ocr.status`), polled with `get_scan_reading_state`; the split is one synchronous call. `read_scanned_document` (background) and `propose_case_file_split` / `create_split_documents` (sync) take a heavy-job slot (see «Heavy-job cap»); besides it, the job's `dedupeKey` (one live reading per version) and the isolated parser's own busy answer (`ocr_unavailable`, "try again") bound the work. None of the five sits on a route with `requireMfaIfEnrolled` (checked in the catalog test).

**Donna tools** (`mcp.tools.donna.ts`). `matter_id` is the id `find_matters` returns; the matter row's id the facades also need comes from the project detail the web page reads. Same rules as the web routes: project access (private matters closed to non-members), an **active matter membership** (an organization owner or admin without one gets `not_found`), a matter outside the connection's workspaces is `not_found`, a viewer reads requests, profile and radar, and only an owner or editor reads the report (`forbidden`). A public or non-retainer matter answers `matter_not_retainer` (the web answers an empty `retainer: false`, or 404 for the report). Apprentices (pasantes) may call them: they are read tools and need no mode B; quotes of their held versions are withheld. Results carry LiTT `url`s, cap their lists and mark titles and labels as data.

**What the assistant may do in a turn a connection starts.** `litt.chat` lets an application talk to LiTT's assistant; it does not hand the assistant more than the connection holds. Every turn started or continued from a connection (`start_chat`, `send_chat_message`, `start_project_chat`, `send_project_chat_message`, `send_tabular_chat_message`, and the conversations `run_workflow` and `run_quick_action` open) carries the connection's capabilities into the engine, and the assistant's tools are decided there, once, for the turn and for the subagents it spawns: it can always read and search the person's documents, write documents and versions (`edit_document`, `replicate_document`, `generate_docx`, `generate_excel`, `generate_ppt`) only with `litt.write`, run a playbook review (`run_playbook`) only with `litt.run` and `litt.write`, and never use the person's connected third-party services (remote MCP servers, Google tools): no scope names them. A tool the connection may not use is not offered to the model and is refused if the model names it anyway ("Tool is not available"); nothing is written or called. Each tool declares what it does in `toolCapabilities.ts`, and a tool nobody declared is refused for these turns by default. A turn started in LiTT's web app or the Word add-in is not narrowed. The assistant does not ask the person questions (`ask_inputs`) in these turns, so a turn a connection starts never ends as `needs_input`; `needs_input` is the state of a turn the person started in the web app, which the application may still poll, and it is answered there.

**Chat tools need `litt.chat`, reads included.** `list_chats`, `get_chat` and `get_chat_turn` also require `litt.chat`, not `litt.read`: a read-only connection must not expose chat history. A chat's `origin_label` (the app's registered name, free text) is returned as untrusted data like titles; `origin_grant_id` is never returned.

**Same permissions as the web.** A tool calls the service functions the web
routes call (`getProjectsOverview`, `getProjectDetail`, `getProjectDirectoryLevel`,
`getDocument`, `listVersions`, `readStoredDocumentText`, `findDocumentText`,
`openUploadSession`, ...), with the person's id and confirmed address, so project
roles, private-matter membership, training locks and managed accounts are decided
by the same code; `modules/mcp` never queries a table (a test enforces it). The
connection adds one fence: a matter or document outside the workspaces the
connection covers (and the person can open right now) does not exist for it. Every
refusal reads as `not_found`, except a viewer asking to upload (`forbidden`, as the
web's 403). `backend/src/__tests__/integration/mcp.tools.routes.test.ts` runs a
matrix (owner, editor, viewer, admin outside a private matter, apprentice, other
firm, a person whose connection does not cover the firm) over a public and a
private matter and compares every tool with its web route.

The fence also applies to what a result is built from. A tabular review made
through `create_tabular_review` holds only documents of its own workspace, and a
document outside the workspaces the connection covers answers `not_found` (a
covered document of another workspace, `document_workspace_mismatch`). When a
review built in the web holds files of a workspace the connection does not
cover, or a single-document row whose document no longer exists,
`get_tabular_review`,
`read_tabular_cells`, `get_tabular_run_status` and the review's other tools leave
those rows out. `get_playbook_run` and `list_playbook_runs` do not name a run's
document (id, file name, edit version, error text, finding counts) when it lies
outside the connection's workspaces or is gone; the run answers
`document_withheld: true`.

A conversation's answers are text derived from the documents the assistant read,
found, cited, edited, created or copied, and from those of every earlier message
of the same conversation, because a later answer can repeat an earlier one. An
answer, its citations and the names of its documents leave through a connection
only if all of those documents lie inside the workspaces it covers; otherwise
the turn (or the message in a transcript) comes back with
`code: content_outside_connection` and `withheld_outside_connection: true`, and
no text, citation or file name. An answer whose documents cannot be identified is
withheld the same way. This applies to `start_chat`, `send_chat_message`,
`get_chat_turn`, `get_chat`, the project chat tools, `run_workflow` and
`run_quick_action`. What the person typed is not withheld. The documents a
search returned are recorded with the answer, so a search counts like a read. A
read that names no document cannot be placed and is unknown; so is a search
stored before its documents were recorded (unless it found nothing or failed):
the answer that holds one, and every later answer of that conversation, is
withheld. A workflow's own file is a document of its workflow, judged where the
workflow lives; a read of one stored before its document was recorded names no
document and is withheld the same way. When the connection itself lets an answer
out but the person can no longer read it, the reason is its own:
`code: content_no_access` (`withheld_no_access: true`) when they lost access to
a document that still exists, and `code: content_source_unknown`
(`withheld_source_unknown: true`) when the documents it was built from can no
longer be identified or no longer exist. The conversations a connection reads are
the assistant's own; the live document of the Word pane is never stored in them.

A conversation's title is written from what the person typed (or renamed it
to) and the names of the files attached to their messages; it never carries an
answer or a document's text. `list_chats` and `get_chat` therefore return it
only when every file attached to a person's message in that conversation (in a
shared conversation, any participant's) may leave: inside the connection's workspaces, not an unapproved trainee draft,
and naming a document (an attachment with no document is withheld too).
Otherwise it is `null`. Only those attachments are read, in batches of
conversations and without any message text, so the cost of a page of
`list_chats` does not grow with the length of the conversations. What an answer
drew on does not hold the title.

Every decision about an answer reads the conversation completely (past the
database's row limit) and an error while reading is an error for the caller,
never a release. A turn is reported from its stored message and judged with that
message's own sources; a message the complete read does not find is withheld as
unknown provenance.

A tabular review's conversation is answered from every row the person can read,
not from what the connection covers. So a review that holds any document outside
the connection's workspaces, or a single-document row whose document is gone, is
not chatted with
through that connection: `send_tabular_chat_message` and `list_tabular_chats`
answer `content_outside_connection` before anything starts, and
`get_tabular_chat_turn` withholds the stored answer. The hold below is judged on
all the documents of the review, not on the rows the connection covers. A stored
answer is judged by both what the review holds now and what the answer itself was
built from: the thread records the documents behind each message, cumulative over
the thread, so removing a row or replacing a draft afterwards does not release an
answer written over it, and an answer whose sources are unknown is withheld.

**Text from documents is data.** `read_document` and the excerpts of
`search_documents` are wrapped in `<<<LITT_UNTRUSTED_DOCUMENT_TEXT token>>> … <<<END_… token>>>`
with a random token per call and a fixed notice that the text is not instructions.
A pasante's draft that a mentor has not approved is not returned
(`training_approval_required`, and withheld from search results). What is built
from it is withheld too, within the limits stated below: the findings of a
playbook run, the cells of a tabular review and the answers of a conversation
come back as `withheld_until_approved: true` (a turn also carries
`code: training_approval_required`) until the mentor approves it. For a
conversation that covers every document its answer drew on, including those it
only searched in, edited, created or copied, and those of earlier messages of the
conversation.

A review's cell records when it was made but not the version it was made from. It
can be made again later (keeping that date) from whichever version is current
then, and a replaced version can become current again when the later one is
deleted. So no version is inferred: a cell is withheld when any version of its
document that was not deleted before the cell's date (not deleted, or deleted at
or after it; versions made later included) is an unapproved draft. A stored
answer of a review's conversation is composed from the cells as they were when
it was written, which may since have been replaced, so no date is knowable: it
is withheld when any version its documents have ever had, deleted or not, is an
unapproved draft (besides what the review holds now and the workspaces the
connection covers). A cell with no date, a document with no versions or no row,
an unreadable date and a failed read are withheld.

What this costs a firm: while a trainee's unapproved draft remains in a
document's history, the cells of that document (those made before the draft
existed included, unless the draft was deleted before the cell was made) and the
answers of review conversations about that document do not leave through a
connection.
They come back when a mentor approves that draft. A draft that is not the
current version can still be approved: the approval accepts any version of the
document that is not deleted, and the version list offers it to a lawyer of the
matter or the trainee's mentor. A deleted draft cannot be approved. For cells,
deleting the draft and then removing and adding the document again to the review
makes its cells anew, dated after the deletion, and they leave. A review
conversation's answers about the document stay withheld after the draft is
deleted (deleted versions count), the new ones too; approve the draft before
deleting it.

Limits of the hold on cells and review answers. A cell and a review answer do
not record the documents, versions or bytes they were made from, so two cases
are judged by what exists now rather than by what the text was made from: a
cell of a row that groups several documents is judged by the documents the row
holds now, and a version whose content was changed in place is judged by its
current content and approval. Recording what each cell and answer was made from
is the planned change that makes the hold exact and removes the cost above.

`get_playbook_run` and `list_playbook_runs` label a run over text the person
pasted (no document and no name) `document_source: "pasted_text"`; a run that
lost its document but kept a name is still `document_withheld: true`. Both
review tools (`run_playbook_review`, `prepare_playbook_review`) need a stored
document, so a connection never starts a run over pasted text; such a run is one
the person made in the web, and it never carried findings or a summary here.
Offsets count Unicode characters, the unit of the database's search offsets, so a
passage is cited as `version_id` + `start_char`/`end_char`.

**Size.** Listings page by cursor (≤ 50 rows; opaque `next_cursor`). No result may
exceed 100 000 characters (`result_too_large` otherwise), under Claude Code's
25 000-token ceiling.

**Which key work started by a connected app runs on.** When an app asks LiTT to run
model work (`start_chat`, `start_project_chat`, `send_tabular_chat_message` for a new
thread, `run_workflow`, `run_quick_action`, `run_playbook_review`) and names no
`credential_ref`, LiTT chooses one in `mcp.defaultKey.ts`, from the keys the web's key
selector lists for that person, model and workspace (`listChatCredentialOptions`, so
membership, the firm's personal-keys setting, managed accounts and key versions decide
what is usable at all). In a firm's workspace or a firm's matter the firm's key runs
the work; if the firm has none for that provider, the person's own key (listed only
where the firm allows personal keys); then the deployment's. In the personal workspace:
the person's own key, then the deployment's. The reference is handed to the service
exactly as a named one would be, so every check on it still runs (a firm's key runs
only that firm's content, the model rule, one route per conversation). With no usable
key nothing is chosen and the call is refused as before. A `credential_ref` the app
names always wins, and a conversation that already exists keeps its own key. The
organization asked about is the one the work belongs to (the matter's, the review's,
otherwise the call's workspace). `run_playbook_review` asks about the playbook's
organization only when the document's workspace is that organization (a firm's playbook
on that firm's document runs on the firm's key); a playbook on a document of another
workspace names no reference, and the document's firm decides which keys may run it: the
person's own key only where that firm allows personal keys, otherwise the deployment's. A
document an app attaches to a conversation or a run must belong to the workspace of the
call, otherwise the call is refused. `run_tabular_review` and the tabular
workflow take no reference: generation uses the web's key bag, which already prefers the
firm's key. Scanned-page reading and the case-file split use the saved LandingAI key
(the firm's first). The web screens' own preselection is unchanged.

**Playbooks and tabular: who runs the work.** *Mode A* (`run_*`) is LiTT's engine
with the person's governed BYOK route: the model is the one named or the person's
default, the route is pinned when the run is recorded, and a missing key or default
refuses the call (`byok_not_configured`, `missing_api_key`; the answer says LiTT does
not switch models). Apprentices (Formación) may use mode A only: `prepare_playbook_review` and
`submit_playbook_review` answer `mode_not_available` in their firm. *Mode B*
(`prepare_*` + `submit_*`) lets the client's AI reason: the document text and the
playbook leave LiTT as untrusted data with an egress record, and what comes back is
validated with the engine's own rules (`normalizeFindings`: rule ids must exist,
quotes must be found in the text; a quote that is not found is dropped and reported as
`quote_verified: false`). A ticket is an HMAC-signed claim (user, connection,
workspace, playbook hash, document version and its content hash) derived from
`DOWNLOAD_SIGNING_SECRET`; `submit_*` re-checks every permission as a new request, and a
changed playbook (`playbook_changed`) refuses it. A document is refused with
`document_changed` only when the prepared version's `content_sha256` changed; a newer
version does not refuse it, and the findings are checked against the ticket's version
(the run does not store which version it reviewed). A saved run also writes the same
`playbook.run` audit row the engine's own reviews write, with `executor` `client_ai`
and counts per status, never text.
Long work is start + poll: `run_*` waits `LITT_MCP_RUN_WAIT_MS` (default 45 000),
then answers `running`; `get_playbook_run` / `get_tabular_run_status` follow it.
Findings and cells are paged by cursor with a text budget per page.

**Shared services.** `startTabularGeneration` / `runTabularGeneration` /
`stopTabularGeneration` (`modules/tabular/tabular.generation.ts`) were extracted
from the generate route, which now calls them for the synchronous path (the async
queue path keeps its handler); `getPlaybookRun`, `preparePlaybookClientReview` and
`savePlaybookClientReview` are new playbook services; `PlaybookReviewRequest.applyEdits`
(default true, the web's behaviour) lets a caller review without tracked changes.

**Uploads.** An MCP call cannot carry file bytes. `request_document_upload` runs the
web's own manifest validation (types, 100 MB, destination authorization) and returns
the signed storage URL; the client sends the file with `PUT` (from its code
sandbox, or the person's browser), then `complete_document_upload`; the upload
worker creates the document through the documents module. Claude needs «code
execution» enabled and the LiTT domain allowed in its capabilities (not yet tried
with a real Claude). No base64 upload yet.

**Audit.** Each call writes `mcp_tool_calls` (no arguments, no content). Tools that
take document text out (`read_document`, `search_documents`) or add content (the
upload tools, `create_matter`, `create_note_document`) also write `audit_events` (`surface = 'mcp'`, with the matter or
document id the call was authorised to act on, never a name or text) before running. `create_matter` writes a second row,
`mcp.create_matter.created`, with the new matter's id (best effort: the matter already exists). Document text additionally
writes `mcp.client_ai_egress` (document, version, characters, client) before it is
returned; if that cannot be written the text is not returned.

**Chat with the assistant (always mode A).** The reply is LiTT's assistant's, not the
client's own reasoning. A tool starts the web's own turn (`startChatTurn` / `runChatTurn`
in `modules/chat/chat.turn.ts`), so access, the pinned BYOK route, the citation checks,
memory, training rules and audit are the web's. Nobody holds a socket: the turn runs on its
server-owned run, writes its frames to an MCP sink (`mcp.chatSink.ts`, which only keeps the
reason of an error that was not saved) and saves the answer to the conversation; the tools
read the stored message. The answer and the quotes it cites are returned as untrusted data
and recorded as `mcp.chat_egress` (chat, message, characters) before they go out.
Conversations live in the person's history like any other; the web list shows "Desde <app>"
from `chats.origin` / `origin_label` (migration `20261117_10_litt_chat_origin.sql`).
A restart of the backend turns a running answer into `interrupted`.

**Sessions.** `GET /mcp-connect/grants/:id/activity` (the «Aplicaciones conectadas» tab)
lists a connection's recent calls (tool, time, workspace, outcome: `mcp_tool_calls` holds
nothing else) and the conversations it started that the person can still open, with links.

**Server identity.** The `initialize` result carries `serverInfo` `{ name: "litt", title: "LiTT",
websiteUrl: <LITT_MCP_PUBLIC_URL>, icons }` so Claude shows the LiTT mark instead of a letter tile
(Claude's «Declare an app icon» guideline). `icons` holds one inline `data:image/png;base64,…`
128×128 (about 150 bytes; Claude never fetches icon URLs, and requires PNG/JPEG under 10 KB):
LiTT's small-size mark, the 16 px variant (`#u16`, the one the SVG shows below 32 px) of `frontend/src/app/icon.svg`. It lives in
`backend/src/modules/mcp/mcp.icon.ts` (a module, so the build needs no extra file; how to regenerate
it is in the file's header; `assets/litt-icon-128.png` is the same image). No other mechanism is used.

## Tables

`mcp_oauth_clients`, `mcp_oauth_requests`, `mcp_grants`, `mcp_oauth_codes`,
`mcp_oauth_tokens`, `mcp_oauth_audit` (migration
`20261116_20_litt_mcp_oauth.sql`), and `mcp_tool_calls` (migration
`20261116_40_litt_mcp_tool_calls.sql`). `chats` gets `origin`, `origin_grant_id` and
`origin_label` (migration `20261117_10_litt_chat_origin.sql`; the grant link is
`on delete set null`, so conversations outlive the connection). Row-level security is on with no policy and
anon/authenticated have no privileges: only the backend's service role reaches
them. The audit table has no foreign key to `auth.users`, so deleting an account
removes its connections and tokens and keeps the history.

## Tests

* `backend/src/modules/mcp/__tests__/mcp.heavy.test.ts` — the heavy-job cap: per
  person and global limits, atomic acquisition, release after success, failure and
  abort, background slots held by their probe, read tools untouched, the error
  shape and the `CODE_KINDS` / i18n / diagnostics entries; the catalog test
  classifies every tool.
* `backend/src/__tests__/integration/mcp.oauth.routes.test.ts` — the whole
  flow over HTTP against an in-memory database.
* `backend/src/__tests__/integration/mcp.tools.routes.test.ts` — the real tools
  through `/mcp` JSON-RPC against an in-memory firm (`helpers/mcpToolsWorld.ts`):
  the parity matrix with the web routes, tools/list per scope and annotations,
  pagination, size caps, untrusted wrapping, training locks, audit rows, uploads.
* `backend/src/__tests__/integration/mcp.tools.playbooksTabular.routes.test.ts` — the playbook
  and tabular tools through `/mcp`: the parity matrix against the playbook and tabular
  routes, mode A start + poll, BYOK fail-closed, mode B tickets and validation,
  apprentices, audit and egress rows.
* `backend/src/__tests__/integration/mcp.tools.chat.routes.test.ts` — the chat tools
  through `/mcp`: the parity matrix against `GET /chat`, `GET /chat/:id` and `POST /chat`,
  start + poll, stop, BYOK fail-closed, untrusted answers, egress and audit rows, origin in
  the web list, and the sessions endpoint. The model itself is stood in for at the
  `startChatTurn` / `runChatTurn` seam; the real turn is pinned by the golden recordings
  of the web route (`chatTurn.golden.routes.test.ts`).
* `backend/src/__tests__/integration/mcp.tools.create.routes.test.ts` — `create_matter` and
  `create_note_document` through `/mcp`: the matrix against the web's upload permission
  (owner, editor, viewer, admin outside a private matter, apprentice, outsider, a connection
  that does not cover the firm), managed accounts and Personal, validation, size caps, strict
  audit and fail-closed, sanitized failures, cleanup, and the write lane.
* `backend/src/__tests__/integration/mcp.tools.donna.routes.test.ts` — the Donna tools through `/mcp`: the matrix against the web routes (owner, editor, viewer, apprentice, firm admin without membership, outsider, workspace not in the grant, private matter non-member), a non-retainer matter, caps, «Hoy», confirmed-only profile, egress and audit.
* `backend/src/__tests__/integration/mcp.tools.workflowsDocuments.routes.test.ts` — the layer 2a tools through `/mcp`: the parity matrices against `GET /workflows`, `GET /quick-actions` and the compare and convert routes (owner, editor, viewer, admin, apprentice, outsider, a connection that does not cover the firm), private matter, scopes, apprentice rules, compare across matters, 409 for a retained pasante version, strict audit and fail-closed, write lane (429), sanitized errors. The model, the tabular lease and the isolated parser are stood in for at the seams the web routes use.
* `backend/src/__tests__/integration/mcp.tools.defaultKey.routes.test.ts` — which key each model-running tool uses in a firm workspace (firm key only; own key and firm key; own key only; personal keys off) and in the personal workspace, with real key rows; a named reference wins, no key refuses, a firm's key does not run another firm's document, and documents of another workspace are refused. `modules/mcp/__tests__/mcp.defaultKey.test.ts` fails when a registered tool has no key class in its table, when the table names a tool that is not registered, or when a tool file passes a reference without the helper.
* `backend/src/modules/mcp/__tests__/mcp.toolkit.test.ts` — cursors, text
  windows, the untrusted wrapper, matter matching, and the rule that tool files
  do not query tables.
* `backend/src/__tests__/integration/mcp.principal.routes.test.ts` — the gate:
  revoked membership, managed account, apprentice, erased account, expired or
  revoked connection, scopes, rate limits, the call record, sanitized errors.
* `frontend/src/app/connect/authorize/page.test.tsx` — the consent page.
* `frontend/src/app/components/settings/ConnectedAppsSection.test.tsx` — the
  «Aplicaciones conectadas» tab (`/settings/connected-apps`): list, revoke, empty
  state, and the explanation shown when `LITT_MCP_SERVER` is disabled (the
  backend answers 404 to `/mcp-connect/grants`).
* `backend/scripts/mcp-e2e-hermes.sh` — end to end with **Hermes** as a real MCP
  client: starts the real app on a random loopback port, points an isolated Hermes
  home at it, runs `hermes mcp login` (discovery → OAuth with PKCE) and
  `hermes mcp test` (`tools/list`, which must show the real tools), then calls
  `find_matters` and `get_matter` with the access token Hermes obtained, against
  the synthetic firm. The browser step is simulated and the web session is stubbed. By default Hermes registers through its public client
  metadata document (needs the internet); `LITT_MCP_E2E_CIMD=disabled` makes it
  register dynamically instead. Needs the `hermes` CLI; synthetic data only.

## Layer 2c: prompts, resources and the chats of a matter and of a review

The server now declares `tools`, `prompts` and `resources`: what Claude supports. It declares **no resource subscriptions and no `listChanged`** (Claude does not support them, and a request is its own server, so nothing is ever announced). Tasks and progress are not in this slice: they need a real Claude test and stay documented as pending (design §8, layer 2 summary).

### Prompts and resources (`mcp.context.ts`, `mcp.prompts.ts`, `mcp.resources.ts`)

They carry the inputs of a piece of work (design §2.3): a workflow's instructions, a playbook's rules, the firm's profile and a retainer matter's client profile.

| Kind | Name / URI | Same text as the tool |
|---|---|---|
| prompt | `workflow:<id>` | `get_workflow` |
| prompt | `playbook:<id>` | `get_playbook` |
| resource | `litt://workflows/{id}`, `litt://playbooks/{id}` | `get_workflow`, `get_playbook` |
| resource | `litt://workspaces/{id}/firm-profile` | `get_firm_profile` (new, read-only, `litt.read`, strict audit) |
| resource | `litt://matters/{id}/client-profile` | `get_client_profile` (template only: a person has many matters) |

**Whose text it is.** `get_workflow` and `get_playbook` (so the prompt and the resource) say where the text comes from: `origin` is `own` (the person made it), `firm` (it lives in the firm's workspace) or `shared` (another account shared it with the person, outside any firm's workspace), with `shared_by` the sharer's display name for a shared text, null when there is none. The name is reduced to one plain line: line breaks become spaces; control characters, zero-width and joiner characters, bidirectional controls and Unicode tag characters are removed; it is cut at 80 characters (never in the middle of one); a name with no letter or digit counts as no name. In the resource and the tool it is a JSON field, i.e. data.

**What the prompt says outside the fence.** Only words this server wrote: the fixed sentences, a count of rules, a tool's name and an id. The sentence about whose text it is is one of three fixed ones: the own and firm text is described as the firm's own, as before; a shared text as shared with the person by another account, not the person's or the firm's own, with who shared it stated in the data below. It never contains a name. Everything a person typed goes inside the one fenced block as labelled fields ahead of the text: the workflow's title, practice and language (and its columns' names and questions after the instructions), the playbook's name, description, rule names and content, and, for a shared text, `shared_by`. The fenced block is data that never overrides the person's request.

**No second authorization path.** A prompt or a resource is read by running the tool that returns the same thing through `runMcpTool` (`mcp.tools.ts`), which is what `tools/call` runs: arguments, the grant's scope, the live workspace fence, the person's own access, the strict audit row (and, for the client profile, the egress record of the quotes written *before* they are returned), the handler and the call record. `mcp.context.ts`, `mcp.prompts.ts` and `mcp.resources.ts` query no table and check no access themselves (the catalog test pins it). A thing that does not exist, one the person cannot open and one outside the connection's workspaces answer the same (`That prompt was not found.` / `That resource was not found.`), so existence does not leak. The text is the author's: it keeps the tools' untrusted-data fence, and the prompt's own framing says it never overrides the person's request.

**Listing is bounded and paged.** `prompts/list` and `resources/list` show the connection's **default workspace**: workflows first, then playbooks (what `list_workflows` / `find_playbooks` list for that person), at most 25 per page, with an opaque cursor. `resources/list` adds, on its first page, the firm profile of each firm workspace of the connection (Personal has none). A prompt or resource of another workspace of the same connection is read by name or URI all the same; it just is not in the menu. The apprentice rules are the tools': these are reads, mode A.

### Chats of a matter and of a review

| Tool | What it starts / does | Same turn as the web |
|---|---|---|
| `start_project_chat`, `send_project_chat_message` | the matter's conversation (all the matter's documents, its tools, its workflows) | `POST /projects/:id/chat` |
| `send_tabular_chat_message`, `get_tabular_chat_turn`, `stop_tabular_chat_turn`, `list_tabular_chats` | the review panel's thread (the model reads the grid and cites cells) | `POST /tabular-review/:id/chat`, its `chats`, `messages`, `turn/:id/stop` routes |

Both web turns used to live inside their route handler. They now run behind `startProjectChatTurn` / `runProjectChatTurn` (`project-chat/projectChat.turn.ts`) and `startTabularChatTurn` / `runTabularChatTurn` (`tabular/tabular.chatTurn.ts`), the way `chat.turn.ts` does for `POST /chat`: the route parses, starts the turn, attaches the run to the response and runs it, and the tools call the very same functions through the module facades. Nothing about frames, ordering or persistence changed (the golden recording and the route tests pass untouched).

* **Same rules.** Access (a matter or review the person cannot open is `not_found`), write standing (`forbidden` for a viewer), one answer at a time (`turn_in_progress`, checked before anything is written), the BYOK route pinned to the conversation (no fallback; `missing_api_key` fails closed) and the training rules (mode A only: a pasante or junior brings `attempt` and `confidence` first, "Tu turno primero"; there is no mode B here).
* **Review threads are written by their author** (as the web's rename and delete): another member reads a thread (provenance filter included: a message built from a document the reader cannot open is withheld, as in the web's messages route) but writing to it is `chat_write_forbidden`; they start their own.
* **Scope.** `litt.chat`, write lane, strict audit before running (the spend and the thread), like `start_chat`. What leaves LiTT is recorded as a chat egress before it is returned (`mcp.chat_egress`), by the same code as the assistant chat.
* **Session «Sesión desde Claude».** A new matter conversation is a `chats` row with `origin = 'mcp'`, so the web's history and the connection's activity list it like any chat started from Claude. A review thread has no origin column (the tool calls, which carry the review and thread ids, are the session's record); adding one is a migration left out of this slice.
* **Following a turn.** A matter conversation is followed and stopped with `get_chat_turn`, `stop_chat_turn` and `get_chat` (same table, same run registry). `get_chat_turn` now also reports `generating` for a live turn whose answer is not saved yet (the matter's engine saves it when it ends; the assistant chat reserves its row first). Review threads have their own `get_tabular_chat_turn` / `stop_tabular_chat_turn` because their messages live in their own table.
* **Why new tools instead of `start_chat(matter_id)`.** That tool runs the assistant chat's engine with a `project_id`, which attaches only the documents named on the message; the web's matter page uses the matter engine. `start_chat` is unchanged. `run_workflow` / `run_quick_action` with a `matter_id` still use the assistant chat's engine too.

None of the new tools sits on a route with `requireMfaIfEnrolled` (the firm profile's read route has none; only its write does): checked in the catalog test, so none is withheld for MFA.

### Tests of layer 2c

* `backend/src/__tests__/integration/mcp.promptsResources.routes.test.ts` — capabilities (no subscriptions), `prompts/list|get`, `resources/list|templates/list|read`: paging and bounds, the workspace fence, the person's own access, "not found" without leaking existence, strict audit, the read budget, apprentice reads, and a per-person matrix against the tools (`get_workflow`, `get_playbook`, `get_firm_profile`, `list_workflows`).
* `backend/src/__tests__/integration/mcp.tools.donna.routes.test.ts` (new describe) — the client profile as a resource: same facts, egress and audit as the tool, fail-closed.
* `backend/src/__tests__/integration/mcp.tools.projectChats.routes.test.ts` and `mcp.tools.tabularChats.routes.test.ts` — the matrices against `POST /projects/:id/chat` and the review chat routes (owner, editor, viewer, admin outside a private matter, apprentice, outsider, a connection that does not cover the firm), origin and sessions, generating / stop / error, creator-write, provenance, strict audit and fail-closed. The model is stood in for at the seam both the route and the tool call.
* `projectChat.routes.test.ts` (origin of a new matter chat), `chat.history.test.ts` (a live turn with no row), `mcp.catalog.test.ts` (classification, the prompts' and resources' tools, MFA guard).
