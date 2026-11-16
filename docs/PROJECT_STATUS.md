# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth. Dated history up to 2026-11-13 is in
> [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md).

**Last reconciled:** 2026-11-16<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike` (fetch-only; policy in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md))

## In production

- **Service:** <https://litt.asteroitt.com>, closed beta by invitation. Deploy
  `20261116a` (release `prod-20261116a`), `RELEASE_SHA` `a0b6e6d38`, with every
  pull request up to #200. Each deploy is published as a GitHub release.
- **Access:** invitations are issued by platform administrators
  (`PLATFORM_ADMIN_EMAILS`); only they create firms. Beta statistics are for
  platform administrators only, counts only, audited ([`beta-stats.md`](beta-stats.md)).
- **Managed accounts:** a firm setting; accounts created by the firm's
  invitation have no personal space, existing accounts keep theirs
  ([`managed-accounts.md`](managed-accounts.md)).
- **Layers 1 to 7:** firm tenancy and private matters, training, playbooks,
  document conversion and comparison, scanned-PDF reading with LandingAI
  (optional; the person's or the firm's own key, never a platform key,
  [`document-ocr.md`](document-ocr.md)) and «Separar expediente»
  ([`document-split.md`](document-split.md)). See
  [`training.md`](training.md), [`playbooks.md`](playbooks.md),
  [`document-conversion.md`](document-conversion.md),
  [`document-compare.md`](document-compare.md).
- **Firm profile** (#191): a description the assistant reads in the firm's chats
  ([`firm-profile.md`](firm-profile.md)).
- **Settings** (#193, #195): two homes (personal and firm), a granular key
  policy, training with mentors and pupils (one mentor per pupil per firm), text
  size. See [`settings-map.md`](settings-map.md).
- **Interface** (#194, #195): composer sheet; Newsreader and Departure Mono
  typography; Light, Dark or Auto theme (`user_profiles.theme`, migration
  `20261114_10`, replaces `dark_mode`); surface tokens `--surface-desk`, `-sheet`,
  `-float`, `-field`, `-document`; sticky Settings sidebar. See
  [`design-system.md`](design-system.md).
- **Connectors** (#198): Notion and Airtable are suggested one-click MCP
  presets, per person and per workspace; there is no firm-shared MCP connector
  ([`connectors.md`](connectors.md)).
- **Citation support check** (#199): TypeSafe Jev in **silent** mode, a
  platform service with the platform's `TYPESAFE_API_KEY`, on in production
  (`LITT_CITATION_CHECK=enabled`). Covers the web chat, project chats and cloud
  Word chat; each person can opt out in Settings → Privacy and data; results go
  to `citation_support_checks` for the beta statistics and the lawyer sees
  nothing. `LEGAL_VERSION` is `2026-11-15`. Tabular review and playbooks are not
  connected ([`citation-support-check.md`](citation-support-check.md)).
- **Google connectors** (#200): the Google variables are passed to the backend
  in `deploy/prod/compose.yaml` and Drive is off by default, but there is **no
  OAuth client yet**, so nobody can connect Google. The owner postponed Google
  work ([`google-workspace.md`](google-workspace.md)).
- **Operations** (#196, #197): test-stability fixes; small reservations;
  PostgREST limited to 256 MiB with no swap. Deploy and backup procedure:
  [`deploy/prod/README.md`](../deploy/prod/README.md).

## Open items

Tracked in [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) and [`followups.md`](followups.md).
The ones that matter now:

- Connect tabular review and playbooks to the citation check, or decide not to
  (TD-047); showing the result to the lawyer needs its own legal text.
- Two frontend tests are flaky under load (TD-046).
- PostgREST memory growth is contained, not fixed; root cause is upstream (TD-048).
- Google: create the OAuth client and verify scopes before enabling any service.
- Not yet done: a browser flow of «Separar expediente» with a real case file.

## Governance

Release gates: [`RELEASE_GATES.md`](RELEASE_GATES.md). Upstream sync rules:
[`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md). Update this file when integration or
production state changes.
