# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth. Dated history up to 2026-11-17 (deploy `20261117i`) is in
> [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md).

**Last reconciled:** 2026-11-19<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike` (fetch-only; pin and intake in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md))

## In production

- **Service:** <https://litt.asteroitt.com>, closed beta by invitation.
- **Deploy:** `20261118e`, tag `prod-20261118e`, `RELEASE_SHA` `51aa6997c` (full SHA
  `51aa6997c728cdaf3942a3724cc304c05db531b3`, the merge of #254). Previous deploy: `20261118d`
  (`6a33f21dc`). Earlier deploys: `prod-20261118a` to `prod-20261118c`, and `prod-20261117a` to
  `prod-20261117i` (see [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md)). Each deploy is
  tagged `prod-YYYYMMDDx`.
- **Contents:** every merged pull request up to #254. Shipped since `20261117i`:
  - `20261118a` (`0112c4a60`): #247, the password recovery link works in any browser.
  - `20261118b` (`59f30a854`): #248, a guide in Settings to connect LiTT from Claude and ChatGPT.
  - `20261118c` (`448bae645`): #249, the sign-up confirmation and e-mail change links work in any
    browser; #250, MCP tools `create_matter` and `create_note_document`, and the LiTT server icon in
    the MCP `initialize` result; #251, batch review of proposed facts in the client profile
    (`POST /facts/batch`; each item still records its own decision).
  - `20261118d` (`6a33f21dc`): #252, redesign of the connected apps settings.
  - `20261118e` (`51aa6997c`): #253, the landing presents Formación (layers 1 to 4, including the
    gym) and the guides inside the app; #254, review notes for the connected apps settings.
- **Health:** `verify.txt` of `20261118e` (`artifacts/deploy-20261118e`): `litt / 200` and the
  release endpoint reports `51aa6997c`. Container health was not re-read for this update [VERIFICAR].
- **Migrations:** applied in production through `20261117_50_litt_radar_item_guard_due_on.sql`.
  No `.sql` file changed between `8f25fc8e0` and `51aa6997c` (empty `git diff`, verified).
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
| Client profile (with assisted extraction and batch review), matter requests, deadline radar, obligation rules, retainer report | on (no flag) | Client profile and radar since the 2026-11-16 release; assisted extraction, obligation rules and retainer report in `20261117d`; batch review of proposed facts in `20261118c` (#251). [`client-profile.md`](client-profile.md), [`matter-requests.md`](matter-requests.md), [`deadline-radar.md`](deadline-radar.md), [`obligation-rules.md`](obligation-rules.md), [`retainer-report.md`](retainer-report.md) |
| Model choice before a chat; model and reasoning guide in the selector | on (no flag) | Since `20261117g` (#240). The guide is checked against the providers' official model pages. Anthropic liveness, the previous-model notice and GLM reasoning levels since `20261117h` (#242). The Fable 5.2 entry is under owner review (see open items). |
| OpenRouter streams with long pauses | on | `STREAM_CHUNK_TIMEOUT_MS=180000` in production since `20261117f` (#238). |
| Firm profile, settings map, managed accounts, text size, Light/Dark/Auto theme | on | [`firm-profile.md`](firm-profile.md), [`settings-map.md`](settings-map.md), [`managed-accounts.md`](managed-accounts.md), [`design-system.md`](design-system.md) |
| Notion and Airtable connectors (per person and per workspace) | on | Suggested one-click MCP presets. No firm-shared connector. [`connectors.md`](connectors.md) |
| LiTT MCP server (`/mcp`, OAuth) | **on** (`LITT_MCP_SERVER=enabled`, since 2026-11-17, release `20261117c`) | Host `https://mcp.litt.asteroitt.com`. Tools `create_matter` and `create_note_document` since `20261118c` (#250); the server icon is in `initialize`. Live checks pass: AS metadata (PKCE S256, CIMD), protected resource metadata, `401` with `resource_metadata` without a token, dynamic registration `201`, authorize `302` to the consent page, bad token `400`, other paths `404`. Registration first failed with `42501` (missing `service_role` grants), fixed by PR #229. **Real Claude/ChatGPT test pending** (owner account, login and a tool call not yet run). [`mcp-server.md`](mcp-server.md) |
| Chat subagents, web search | on (compose default `enabled`) | [`subagents.md`](subagents.md), [`web-search.md`](web-search.md) |
| Account links (sign-up confirmation, e-mail change, password recovery) | on | Work in any browser since `20261118a` (#247) and `20261118c` (#249). |
| Connected apps (Settings) | on | Redesigned in `20261118d` (#252); review notes in `20261118e` (#254). |
| Public landing | on | Formación (layers 1 to 4, including the gym) and the guides inside the app since `20261118e` (#253). |
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
- Model guide: the Fable 5.2 entry is still under owner review and the correction is open.
  The verified contents of `20261117h` and `20261117i` do not include a change to it.
- Small follow-up: the latent `waitFor` pattern at `WorkspaceContext.test.tsx:433`.
- PostgREST memory grows slowly; contained by a 256 MiB limit with no swap. Re-measure
  by 2026-11-22 (TD-048).
- Picomatch dev-only allowlist (GHSA-fc5q-39xc-vjpf, `scripts/audit-allowlist.json`): review
  by 2026-12-17; remove when a picomatch release above 4.0.7 resolves the chains.
- Flaky backend and frontend tests seen in CI on 2026-11-14 (TD-050): the root fixes are in
  #245; the ledger row stays open until the CI runs confirm them.
- Dependabot pull requests open and not merged: #235, #236, #237 and #207.
- Connector icon in Claude's connector list: it comes from the root domain's favicon, and
  `asteroitt.com` has none there, so a letter is shown. Open.
- Google: create the OAuth client and verify scopes before enabling any Google service.
- Not run yet: a browser flow of «Separar expediente» with a real case file.
- Owner-only checks: real iPhone test of the mobile menu; Word add-in install on
  Microsoft 365.
- Owner or legal decisions: legal review of the English names of the obligation rules; the
  1,400-character context cap of the citation check ([`citation-support-check.md`](citation-support-check.md)).

## Governance

Release gates: [`RELEASE_GATES.md`](RELEASE_GATES.md). Upstream rules and pin:
[`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md). Upstream cycle 13 (PR #234) is merged and deployed
in `20261117e`; Legal Data Hunter is deferred. The next weekly intake is Monday 2026-11-23,
09:00 (America/Mexico_City). Update this file when integration or production state changes.
