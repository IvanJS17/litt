# LiTT MCP server — authorization server and `/mcp`

LiTT can be connected to an AI app that speaks the Model Context Protocol
(Claude, ChatGPT, Codex, Hermes). This page describes what the backend serves
today: the OAuth authorization server and the `/mcp` endpoint with its
per-call gate (live revalidation, scopes, per-connection limits, audit). The
tools that read and run LiTT work come in later changes; today `/mcp` offers
one, `whoami`, which already goes through all of it.

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
| `LITT_MCP_ACCESS_TTL_SECONDS` | 3600 | Access-token lifetime. |
| `LITT_MCP_REFRESH_TTL_DAYS` | 30 | Refresh-token lifetime (each refresh issues a new one). |
| `LITT_MCP_GRANT_MAX_DAYS` | 90 | Absolute life of a connection; after it the person connects again. |
| `RATE_LIMIT_MCP_GRANT_READ_MAX` / `RATE_LIMIT_MCP_GRANT_READ_WINDOW_SECONDS` | 120 / 60 | Read budget of one connection. |
| `RATE_LIMIT_MCP_GRANT_WRITE_MAX` / `RATE_LIMIT_MCP_GRANT_WRITE_WINDOW_MINUTES` | 30 / 15 | Budget of one connection for calls that write, run an engine, spend or chat. |

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
| `GET /mcp-connect/grants`, `DELETE /mcp-connect/grants/:id` | The person's connected apps: list and revoke. |

### Clients

* **Client metadata documents (CIMD).** A `client_id` that is an https URL is
  fetched. The fetch goes through the same guarded egress as MCP connectors
  (public https only, addresses validated at connect time, nothing internal or
  link-local), follows **no** redirect, and is capped at 5 s and 64 KB. The
  document must name the same `client_id`, must not carry a secret and must list
  valid redirect URIs. It is cached for an hour.
* **Dynamic registration.** Redirect URIs must be https, or http on
  `localhost` / `127.0.0.1` / `[::1]`, without fragments.
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

### Audit

`mcp_tool_calls` is insert-only too: one row per call with the tool, connection,
person, client, workspace, mode, outcome (`ok`, `error`, `denied`,
`rate_limited`), error code and latency. It has no column for arguments or
results, so no document text, key or token can reach it; refusals (scope, rate,
workspace, revalidation) are recorded as well. A tool declared `audit: "strict"`
(it writes, spends or takes document text out) first writes an `audit_events`
row with `surface = 'mcp'` and does not run if that insert fails. Like
`mcp_oauth_audit` it keeps no foreign key, so the history outlives the account.

`mcp_oauth_audit` is insert-only (the database refuses UPDATE and DELETE). It
records registrations, rejected metadata documents (with the reason), consent
granted and denied, token issue and refresh, reuse detection and revocation. It
never stores a token, code, PKCE value or state. Consent fails closed: with no
way to write the record there is no connection.

## Tables

`mcp_oauth_clients`, `mcp_oauth_requests`, `mcp_grants`, `mcp_oauth_codes`,
`mcp_oauth_tokens`, `mcp_oauth_audit` (migration
`20261116_20_litt_mcp_oauth.sql`), and `mcp_tool_calls` (migration
`20261116_40_litt_mcp_tool_calls.sql`). Row-level security is on with no policy and
anon/authenticated have no privileges: only the backend's service role reaches
them. The audit table has no foreign key to `auth.users`, so deleting an account
removes its connections and tokens and keeps the history.

## Tests

* `backend/src/__tests__/integration/mcp.oauth.routes.test.ts` — the whole
  flow over HTTP against an in-memory database.
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
  `hermes mcp test` (`tools/list`). The browser step is simulated and the web
  session is stubbed. By default Hermes registers through its public client
  metadata document (needs the internet); `LITT_MCP_E2E_CIMD=disabled` makes it
  register dynamically instead. Needs the `hermes` CLI; synthetic data only.
