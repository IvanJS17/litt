# Documentation

## Run and deploy LiTT

- [Local development](local-development.md) — Docker Compose, local services,
  registration, Ollama, and first-run setup
- [Manual and production deployment](deployment.md) — managed infrastructure,
  environment variables, database upgrades, and deployment safety
- [Project status](PROJECT_STATUS.md) — what is in production today
  ([history](PROJECT_STATUS_HISTORY.md))
- [Troubleshooting](troubleshooting.md) — common local and production problems
- [Safe local testing](safe-local-testing.md) — disposable resources, synthetic
  documents, and secret handling

## Features and clients

- [Organization offboarding](organization-offboarding.md) — member removal,
  account deletion, shared-work transfer and owner-only recovery
- [LiTT MCP server](mcp-server.md) — the OAuth authorization server and `/mcp`
  endpoint that let AI apps connect to LiTT: configuration, endpoints, tokens, audit
- [MCP connectors](connectors.md) — hosted presets, custom servers, OAuth,
  redirect URIs, and Slack/Google deployment setup
- [Document conversion](document-conversion.md) — Markdown, Word and PDF into a
  new document: what converts, what is lost, permissions, routes
- [Document comparison](document-compare.md) — two Word files of a project into a
  new one with tracked changes: permissions, route, limits, known limitations
- [Scoped memory](memory.md) — app and project Markdown memory, permissions,
  asynchronous learning, deletion, and operations
- [Google Drive](google-drive.md) — pointer to the Drive section (see also
  [Google Workspace](google-workspace.md))
- [Google Workspace](google-workspace.md) — Drive, Gmail, and Calendar
  connectors: setup, permissions, approvals, limits, and acceptance tests
- [Web search](web-search.md) — provider search and search services, page
  reading, keys, and safety
- [Subagents](subagents.md) — delegated tasks, what they may do, approvals,
  and limits
- [Microsoft Word add-in](../word-addin/README.md) — concise setup and command
  reference
- [Word add-in development and deployment](word-addin-development.md) — manual
  setup, sideloading, builds, storage behavior, testing, and troubleshooting
- [Firm profile](firm-profile.md) — the firm description the assistant reads
- [Requests inside a retainer matter](matter-requests.md) — type, complexity,
  assignee, state and negotiation rounds of a retainer client's requests
- [Client profile of a retainer matter](client-profile.md) — facts with a
  verified citation, lawyer confirmation and computed staleness
- [Deadline radar of a retainer matter](deadline-radar.md) — dates computed in
  code from confirmed profile facts, with ack/dismiss/done and a "Today" block
- [Managed accounts](managed-accounts.md) — firm-managed accounts without a
  personal space
- [Settings map](settings-map.md) — which Settings tab lives where, and who sees it
- [Training](training.md) — mentors, pupils, supervision, criterion and gym
- [Playbooks](playbooks.md) — negotiation guides turned into reviewable rules
- [Scan reading (OCR)](document-ocr.md) — LandingAI reading with the person's
  or firm's own key
- [Split a case file](document-split.md) — one PDF into one file per document
- [Document text search](document-text-search.md) and
  [search indexing](search-indexing.md)
- [Citation support check](citation-support-check.md) — TypeSafe Jev, silent
  mode, platform key, personal opt-out
- [Beta statistics](beta-stats.md) — counts for platform administrators, audited, no export.
- [Tamper-evident exports](tamper-evident-exports.md) — document hashes and
  optional signed manifests

## Models and providers

- [Configured models](configured-models.md) — the static model catalog
- [Direct provider models](direct-provider-models.md) — provider routes
- [Preset templates](preset-templates.md) — the preset contract catalog (empty in LiTT)
- [DOCX preview engines](docx-preview-engines.md)

## Backend

- [Service boundaries](service-boundaries.md) — ownership and workflow orchestration
- [Recovery upgrade](recovery-upgrade.md) — historical: the 2026 legacy Drive upgrade
- [Backend architecture](backend-architecture.md) — domain modules over a
  shared kernel: module anatomy, the service contract, the layering rules, and
  the fitness test that enforces them

## Frontend

- [Design system](design-system.md) — color/typography/spacing tokens, the shared
  `components/ui` primitives, and the accessibility baseline
- [Interface languages](i18n.md) — Spanish and English catalogs, key
  conventions, what is not translated, and the extraction codemod

## Testing and CI

- [End-to-end tests in CI](e2e-ci.md)
- [Backend unit-test coverage](testing-coverage.md)
- [Frontend unit-test coverage](frontend-testing.md)
- [Mutation testing and the SSE load harness](test-depth.md)

## Project governance and debt

- [Technical debt](TECHNICAL_DEBT.md) and [open follow-ups](followups.md)
- [Release gates](RELEASE_GATES.md)
- [Upstream policy](UPSTREAM_POLICY.md), [sync plan](UPSTREAM_SYNC_PLAN.md),
  [recovery plan](UPSTREAM_RECOVERY_PLAN.md),
  [compatibility ledger](UPSTREAM_COMPATIBILITY_LEDGER.md) and
  [Phase 3 recovery decision](PHASE3_RECOVERY_DECISION.md)

## Open-source acknowledgments

- [Open-source credits](../CREDITS.md) — the libraries, tools, and
  infrastructure behind LiTT

## Historical design and investigation notes

These files preserve the context of completed work. They are not current setup
or architecture guidance.

- [Legal workflows design spec](superpowers/specs/2026-06-29-legal-workflows-design.md)
- [Word add-in assistant scroll-jump report](word-addin-chat-scroll-report.md)

Contribution and disclosure policies live in [CONTRIBUTING.md](../CONTRIBUTING.md)
and [SECURITY.md](../SECURITY.md).
