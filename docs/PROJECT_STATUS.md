# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth. Dated history up to 2026-11-16 is in
> [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md).

**Last reconciled:** 2026-11-17<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike` (fetch-only; pin and intake in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md))

## In production

- **Service:** <https://litt.asteroitt.com>, closed beta by invitation.
- **Deploy:** `20261117d`, tag `prod-20261117d` (pushed 2026-11-17 14:07 CST),
  `RELEASE_SHA` `1e11b983b` (full SHA `1e11b983b08024214c8123f4481786b8b652f4e7`).
  Previous deploy: `20261117c` (`dbd70f908`). Earlier deploys: tags `prod-20261116a`
  to `prod-20261116i`, `prod-20261117a`, `prod-20261117b`, `prod-20261117c`. Each deploy is tagged
  `prod-YYYYMMDDx`; not every tag has a published GitHub release yet.
- **Contents:** every pull request up to #233, merged and deployed 2026-11-16/17.
  Shipped in `20261117d`:
  - #229: MCP tables get the `service_role` grants they lacked.
  - #231: obligation rules catalog, 20 verified rules; the lawyer turns each on per retainer matter ([`obligation-rules.md`](obligation-rules.md)).
  - #230: retainer 30/60/90-day report, Word file; the lawyer records by hand that it was sent; never hours ([`retainer-report.md`](retainer-report.md)).
  - #232: assisted extraction for the client profile, with the person's or firm's own key, never a LiTT key; quotes are verified and the lawyer confirms each fact ([`client-profile.md`](client-profile.md)).
  - #233: dependency gate for GHSA-fc5q-39xc-vjpf (`picomatch`, no patched release): dev-only allowlist plus one `notInProductionImage` scope; deploy check `web-image-dev-only-paths=0`.
- **Health:** all 7 services healthy; all edge domains unchanged.
- **Migrations:** applied in production through `20261117_50_litt_radar_item_guard_due_on.sql`
  (`20261117_30`, `_40` and `_50` are new in this deploy).
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
- A third-party legal sources connector from upstream is deferred until the planned work finishes.
- Upstream cycle 13 is pending.
- Small follow-up: the latent `waitFor` pattern at `WorkspaceContext.test.tsx:433`.
- PostgREST memory grows slowly; contained by a 256 MiB limit with no swap. Re-measure
  by 2026-11-22 (TD-048).
- Flaky backend and frontend tests seen in CI on 2026-11-14 (TD-050).
- Google: create the OAuth client and verify scopes before enabling any Google service.
- Not run yet: a browser flow of «Separar expediente» with a real case file.
- Owner-only checks: real iPhone test of the mobile menu; Word add-in install on
  Microsoft 365.

## Governance

Release gates: [`RELEASE_GATES.md`](RELEASE_GATES.md). Upstream rules and pin:
[`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md). Upstream cycle 12 (PR #205) is merged;
the next weekly intake is Monday 2026-11-23, 09:00 (America/Mexico_City). Update this
file when integration or production state changes.
