# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth. Dated history up to 2026-11-17 is in
> [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md).

**Last reconciled:** 2026-11-17<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike` (fetch-only; pin and intake in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md))

## In production

- **Service:** <https://litt.asteroitt.com>, closed beta by invitation.
- **Deploy:** `20261117g`, tag `prod-20261117g`, `RELEASE_SHA` `cca74bf67` (full SHA
  `cca74bf67a8d64bc1732957b1e23767221ab7a2d`, the merge of #240). Previous deploy:
  `20261117f` (`72ad773f3`). Earlier deploys: tags `prod-20261116a` to `prod-20261116i`,
  `prod-20261117a` to `prod-20261117f`. Each deploy is tagged `prod-YYYYMMDDx`; not every tag
  has a published GitHub release yet.
- **Contents:** every pull request up to #240, merged and deployed 2026-11-16/17. Shipped since
  `20261117d`:
  - `20261117e` (`aee9e77f9`): #234, upstream cycle 13 (pin `4cbf434e9b05`). Legal Data Hunter
    deferred, not rejected; the upstream support e-mail is rejected; dependency updates adapted
    without Sentry ([ledger §33](UPSTREAM_COMPATIBILITY_LEDGER.md)).
  - `20261117f` (`72ad773f3`): #238, OpenRouter keep-alive comments count as provider activity,
    and production sets `STREAM_CHUNK_TIMEOUT_MS=180000`. Incident of 2026-11-17 (21:37 UTC): a
    project chat with `openrouter/z-ai/glm-5.3-flashx-legal` was cut by the 60 s chunk timeout
    while drafting a long document. Root cause: the AI SDK dropped OpenRouter's SSE keep-alive
    comments. The reviewer reproduced it with real OpenRouter. #239: new-project and
    saved-documents UX (clearer fields, pending-uploads list, saved-documents tabs).
  - `20261117g` (`cca74bf67`, #240): a model must be chosen before a chat starts; a model and
    reasoning guide in the selector, checked line by line against the providers' official model
    pages; reasoning levels per provider.
  - `20261117d` (`1e11b983b`): #231 obligation rules catalog, 20 verified rules; the lawyer turns
    each on per retainer matter ([`obligation-rules.md`](obligation-rules.md)). #230 retainer
    30/60/90-day report, Word file; the lawyer records by hand that it was sent; never hours
    ([`retainer-report.md`](retainer-report.md)). #232 assisted extraction for the client profile,
    with the person's or firm's own key, never a LiTT key; quotes are verified and the lawyer
    confirms each fact ([`client-profile.md`](client-profile.md)). #233 dependency gate for
    GHSA-fc5q-39xc-vjpf (`picomatch`, no patched release): dev-only allowlist plus one
    `notInProductionImage` scope; deploy check `web-image-dev-only-paths=0`.
  - `20261117c` (`dbd70f908`): #229, the MCP tables get the `service_role` grants they lacked;
    the MCP server was switched on in this deploy.
- **Health:** eight long-lived containers are up (`db`, `auth`, `auth-edge`, `rest`, `gateway`,
  `backend`, `litt-web`, `litt-word`). Seven report `healthy`; `rest` shows `Up` with no health
  status. Edge checks (`/`, `/privacidad`, `/terminos`) return 200.
- **Migrations:** applied in production through `20261117_50_litt_radar_item_guard_due_on.sql`.
  No migration was added between `1e11b983b` and `cca74bf67`.
- **Access:** invitations are issued by platform administrators (`PLATFORM_ADMIN_EMAILS`).
  Beta statistics are for platform administrators only, counts only, audited
  ([`beta-stats.md`](beta-stats.md)).
- **Deploy and backup procedure:** [`deploy/prod/README.md`](../deploy/prod/README.md).

## What is on and off

| Capability | Production state | Notes |
| --- | --- | --- |
| Firm tenancy, matters, training, playbooks, document conversion and comparison | on | Layers 1 to 4. See [`training.md`](training.md), [`playbooks.md`](playbooks.md), [`document-conversion.md`](document-conversion.md), [`document-compare.md`](document-compare.md). |
| Scan reading (OCR) | on, optional | LandingAI with the person's or the firm's own key; no platform key. [`document-ocr.md`](document-ocr.md) |
| Split a case file | on | Layer 7. A browser run with a real case file is not done. [`document-split.md`](document-split.md) |
| Citation support check (TypeSafe Jev, silent) | on (`LITT_CITATION_CHECK=enabled`) | Web chat, project chats, Word cloud chat, tabular cells and tabular chat, playbook drafts. Each person can opt out. The lawyer sees no result. Legal wording for cells and drafts is not yet confirmed (TD-047). [`citation-support-check.md`](citation-support-check.md) |
| Client profile (with assisted extraction), matter requests, deadline radar, obligation rules, retainer report | on (no flag) | Client profile and radar since the 2026-11-16 release; assisted extraction, obligation rules and retainer report in `20261117d`. [`client-profile.md`](client-profile.md), [`matter-requests.md`](matter-requests.md), [`deadline-radar.md`](deadline-radar.md), [`obligation-rules.md`](obligation-rules.md), [`retainer-report.md`](retainer-report.md) |
| Model choice before a chat; model and reasoning guide in the selector | on (no flag) | Since `20261117g` (#240). The guide is checked against the providers' official model pages. The Fable 5.2 entry is under owner review (see open items). |
| OpenRouter streams with long pauses | on | `STREAM_CHUNK_TIMEOUT_MS=180000` in production since `20261117f` (#238). |
| Firm profile, settings map, managed accounts, text size, Light/Dark/Auto theme | on | [`firm-profile.md`](firm-profile.md), [`settings-map.md`](settings-map.md), [`managed-accounts.md`](managed-accounts.md), [`design-system.md`](design-system.md) |
| Notion and Airtable connectors (per person and per workspace) | on | Suggested one-click MCP presets. No firm-shared connector. [`connectors.md`](connectors.md) |
| LiTT MCP server (`/mcp`, OAuth) | **on** (`LITT_MCP_SERVER=enabled`, since 2026-11-17, release `20261117c`) | Host `https://mcp.litt.asteroitt.com`. Live checks pass: AS metadata (PKCE S256, CIMD), protected resource metadata, `401` with `resource_metadata` without a token, dynamic registration `201`, authorize `302` to the consent page, bad token `400`, other paths `404`. Registration first failed with `42501` (missing `service_role` grants), fixed by PR #229. **Real Claude/ChatGPT test pending** (owner account, login and a tool call not yet run). [`mcp-server.md`](mcp-server.md) |
| Chat subagents, web search | on (compose default `enabled`) | [`subagents.md`](subagents.md), [`web-search.md`](web-search.md) |
| Google Drive, Gmail, Calendar | **off** | No Google OAuth client exists; the owner postponed Google work. [`google-workspace.md`](google-workspace.md) |
| Microsoft 365 and Dropbox connectors | not built | Announced as in design. No code. |

The repository defaults are `disabled` for `LITT_CITATION_CHECK` and `LITT_MCP_SERVER`
in `deploy/prod/.env.example` and `deploy/prod/compose.yaml`; production sets them
through its own `.env`.

## Open items

The authoritative list is [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) (debt with exit
criteria) and [`followups.md`](followups.md) (technical follow-ups). The ones that
matter now:

- Owner confirmation of the legal wording that covers citation checks on tabular
  cells and playbook drafts (TD-047). Those checks are already live.
- Real end-to-end test of the MCP server with Claude and ChatGPT, run by the owner
  (`LITT_MCP_SERVER=enabled` since 2026-11-17, host `https://mcp.litt.asteroitt.com`):
  login and a tool call not yet run. Mode B's run record does not name the reviewed version (TD-049).
- Legal sources through MCP (experimental, not started): adapt the deferred upstream Legal
  Data Hunter mechanism, with ContextLex MX as the first source. Legal Data Hunter itself
  comes later on the same mechanism.
- Model guide: the Fable 5.2 entry is under owner review and the correction is open. A
  follow-up pull request is in progress for the Anthropic ping liveness, the notice for
  previous models, the GLM reasoning fix and a guide text for the legal GLM model.
- Small follow-up: the latent `waitFor` pattern at `WorkspaceContext.test.tsx:433`.
- PostgREST memory grows slowly; contained by a 256 MiB limit with no swap. Re-measure
  by 2026-11-22 (TD-048).
- Picomatch dev-only allowlist (GHSA-fc5q-39xc-vjpf, `scripts/audit-allowlist.json`): review
  by 2026-12-17; remove when a picomatch release above 4.0.7 resolves the chains.
- Flaky backend and frontend tests seen in CI on 2026-11-14 (TD-050).
- Google: create the OAuth client and verify scopes before enabling any Google service.
- Not run yet: a browser flow of «Separar expediente» with a real case file.
- Owner-only checks: real iPhone test of the mobile menu; Word add-in install on
  Microsoft 365.

## Governance

Release gates: [`RELEASE_GATES.md`](RELEASE_GATES.md). Upstream rules and pin:
[`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md). Upstream cycle 13 (PR #234) is merged and deployed
in `20261117e`; Legal Data Hunter is deferred. The next weekly intake is Monday 2026-11-23,
09:00 (America/Mexico_City). Update this file when integration or production state changes.
