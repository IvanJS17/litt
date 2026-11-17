# Documentation index

One line per document, grouped by purpose. Start with the first group if you are
an AI agent or a new contributor.

Each feature document states its status (shipped, flag, default) near the top.
Production state is in [PROJECT_STATUS.md](PROJECT_STATUS.md), which is the only
place that says what is on in production today. Machine-readable entry point:
[`../llms.txt`](../llms.txt).

## Start here

- [`../AGENTS.md`](../AGENTS.md) — rules for agents working in this repository
  (scope, UI rules, verification, what not to change)
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — production deploy, what is on and off, open items
- [TECHNICAL_DEBT.md](TECHNICAL_DEBT.md) — authoritative open debt with exit criteria
- [followups.md](followups.md) — technical follow-ups by area (its «Current open items» section is current)
- [RELEASE_GATES.md](RELEASE_GATES.md) — the gates a change passes before it reaches production
- [PROJECT_STATUS_HISTORY.md](PROJECT_STATUS_HISTORY.md) — superseded status snapshots (history only)

## Product features

Each line gives the feature and its state. "Flag" names the environment switch.

- [Firm profile](firm-profile.md) — the firm description the assistant reads. Shipped.
- [Settings map](settings-map.md) — which Settings tab holds what, and who sees it. Shipped.
- [Managed accounts](managed-accounts.md) — firm accounts without a personal space. Shipped; firm setting.
- [Organization offboarding](organization-offboarding.md) — member removal, account deletion, shared-work transfer. Shipped (no flag).
- [Training](training.md) — mentors, pupils, supervision and criterion. Shipped.
- [Playbooks](playbooks.md) — negotiation guides turned into reviewable rules. Shipped.
- [Client profile](client-profile.md) — facts of a retainer matter with a verified citation and lawyer confirmation. Shipped.
- [Matter requests](matter-requests.md) — a retainer client's requests: type, state, rounds. Shipped.
- [Deadline radar](deadline-radar.md) — dates computed in code from confirmed profile facts. Shipped.
- [Document conversion](document-conversion.md) — Markdown, Word and PDF into a new document. Shipped.
- [Document comparison](document-compare.md) — two Word files into a new one with tracked changes. Shipped.
- [DOCX upload validation](docx-validation.md) — checks on DOCX uploads before storage and conversion. Shipped (no flag).
- [Scan reading (OCR)](document-ocr.md) — LandingAI reading with the person's or firm's own key. Shipped; optional, no platform key.
- [Split a case file](document-split.md) — one PDF into one file per document (layer 7). Shipped.
- [Document text search](document-text-search.md) — derived text of every document version, used by agent search. Shipped (no flag).
- [Search indexing](search-indexing.md) — the search-engine policy while the beta is closed. Shipped (robots policy, no flag).
- [Memory](memory.md) — app and project Markdown memory: permissions, learning, deletion. Shipped (in deploy `20261117a`; no flag).
- [Subagents](subagents.md) — delegated chat tasks on the user's routes. Shipped; flag `LITT_CHAT_SUBAGENTS` (compose default `enabled`).
- [Web search](web-search.md) — provider search and page reading. Shipped; flag `LITT_CHAT_WEB_SEARCH` (compose default `enabled`).
- [Citation support check](citation-support-check.md) — TypeSafe Jev in silent mode; per-person opt-out. Shipped; flag `LITT_CITATION_CHECK` (on in production, `disabled` in the repository defaults).
- [Tamper-evident exports](tamper-evident-exports.md) — document hashes and optional signed manifests. Shipped (no flag; signing key `MANIFEST_SIGNING_KEY`).
- [Beta statistics](beta-stats.md) — counts for platform administrators, audited, no export. Shipped.
- [Preset templates](preset-templates.md) — the preset contract catalog (ships empty in LiTT). Shipped, empty.
- [Connectors (MCP)](connectors.md) — hosted presets (Notion, Airtable), custom servers, OAuth. Shipped for presets; no firm-shared connector.
- [LiTT MCP server](mcp-server.md) — OAuth authorization server and `/mcp` for AI apps. On in production since 2026-11-17 (`LITT_MCP_SERVER=enabled`); real Claude/ChatGPT test pending.
- [Google Workspace](google-workspace.md) — Drive, Gmail and Calendar connectors. Not enabled: no OAuth client; postponed by the owner.
- [Google Drive](google-drive.md) — pointer to the Drive part of Google Workspace. Not enabled.
- [Microsoft Word add-in (user guide)](../word-addin/README.md) — setup and command reference. Shipped.
- [Word add-in development and deployment](word-addin-development.md) — sideloading, builds, storage, tests. Shipped.

## Architecture and interfaces

- [Backend architecture](backend-architecture.md) — domain modules over a shared kernel; layering rules and fitness test
- [Service boundaries](service-boundaries.md) — ownership and workflow orchestration
- [Configured models](configured-models.md) — the static model catalog
- [Direct provider models](direct-provider-models.md) — provider routes and BYOK
- [DOCX preview engines](docx-preview-engines.md) — the document viewer and editor engines
- [Design system](design-system.md) — tokens, shared `components/ui` primitives, accessibility baseline
- [Interface languages](i18n.md) — Spanish and English catalogs, key conventions, extraction codemod
- [Brand](brand/README.md) — LiTT wordmark and monogram rules ([design](brand/DESIGN.md), [changelog](brand/CHANGELOG.md))
- [Package READMEs](../packages/) — `@mike/client`, `@mike/contracts`, `@mike/i18n`, `@mike/ui`, `pdf-text-order` (each `README.md`)

## Operations and deployment

- [Local development](local-development.md) — Docker Compose, local services, first-run setup
- [Manual and production deployment](deployment.md) — managed infrastructure, environment variables, migrations
- [Production deploy and backup](../deploy/prod/README.md) — the production runbook (in Spanish)
- [Word add-in install for production](../deploy/prod/word-addin-install.md) — installing the add-in for firm users
- [Troubleshooting](troubleshooting.md) — common local and production problems
- [Safe local testing](safe-local-testing.md) — disposable resources, synthetic documents, secret handling
- [Security policy](../SECURITY.md) — private vulnerability reporting
- [Incident: assistant update depth](incidents/2026-09-29-assistant-update-depth.md) and [streaming effects audit](incidents/2026-09-29-streaming-effects-audit.md) — dated post-incident notes (2026-09-29)

## Testing and CI

- [End-to-end tests in CI](e2e-ci.md) — Playwright suites and when they run
- [Backend unit-test coverage](testing-coverage.md) — the coverage ratchet and its scope
- [Frontend unit-test coverage](frontend-testing.md) — frontend test scope and gaps
- [Mutation testing and SSE load harness](test-depth.md) — deeper checks outside the regular suite
- [Streaming regression recordings](test-evidence/streaming-effects-2026-09-29/README.md) — recordings of passing tests (2026-09-29)

## Upstream and governance

- [Upstream policy](UPSTREAM_POLICY.md) — how LiTT takes MikeOSS changes; current pin and next intake
- [Upstream compatibility ledger](UPSTREAM_COMPATIBILITY_LEDGER.md) — per-cycle dispositions of upstream changes (cycle 12, 2026-11-16, is the latest)
- [Upstream sync plan](UPSTREAM_SYNC_PLAN.md) — the 2026-10-23 sync plan (completed)
- [Technical debt](TECHNICAL_DEBT.md) and [open follow-ups](followups.md)
- [Release gates](RELEASE_GATES.md) — the gates before production
- [PRD template](templates/PRD.md) — copy into a GitHub issue for a product requirement
- [Contributing](../CONTRIBUTING.md) and [open-source credits](../CREDITS.md)

## History (not current guidance)

These files keep the context of completed work. They are not current setup or
architecture guidance.

- [Project status history](PROJECT_STATUS_HISTORY.md) — dated snapshots up to 2026-11-16
- [Upstream recovery plan](UPSTREAM_RECOVERY_PLAN.md) — historical since the 2026-10-23 sync
- [Phase 3 recovery decision](PHASE3_RECOVERY_DECISION.md) — the recovery decision package
- [Recovery evidence](recovery-evidence/README.md) — evidence from the recovery
- [Recovery upgrade](recovery-upgrade.md) — the legacy Drive upgrade of 2026
- Google test evidence, superseded: [live run 2026-09-22](test-evidence/google-workspace-live-2026-09-22.md), [integrations 2026-09-23](test-evidence/google-integrations-2026-09-23.md), [Discover 2026-09-24](test-evidence/google-discover-2026-09-24.md), [screenshot walkthrough](test-evidence/google-integrations-screenshot-walkthrough.md)
- [Legal workflows design spec](superpowers/specs/2026-06-29-legal-workflows-design.md) — 2026-06 design
- [Word add-in assistant scroll-jump report](word-addin-chat-scroll-report.md) — 2026-08 investigation
