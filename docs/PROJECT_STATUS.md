# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth.

**Last reconciled:** 2026-11-13<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike`

## Executive status

### Integrated, in production: layers 1 to 7 and upstream cycle 11 (#177, #182)

- **Main and production:** `c10401f9` (merge of #182), deployed on 2026-11-13. It
  carries layers 1 to 7 and upstream cycle 11 (#177), so the sections below that
  call them «not merged» or «not in production» are history. The non-blocking
  reserves of the reviews of layer 7 and cycle 11 are closed in
  `fix/capa7-cycle11-reservations`.
- **Layer 7, «Separar expediente»:** splits a PDF that holds several documents into
  one PDF per document, proposed by LandingAI Split and adjusted by the lawyer
  before anything is created. The original does not change. Details and design
  decisions in [`document-split.md`](document-split.md). Migration
  `20261112_60_litt_split_expediente.sql` (adds `split` to
  `document_versions_source_check` and a `split_classes` column to
  `user_profiles` and `organizations`). New backend dependency: `pdf-lib` (MIT).
- **Legal text:** the final text (socium-legal, task t_a4651c51: Terms 2, 6.10 and
  6.13, Privacy Notice 3 to 7 and 13, the simplified notice) went out with it, with
  `LEGAL_VERSION` `2026-11-13`; every account accepts it on its next sign-in.
  Whether to announce the feature the same day or 15 days after publishing the text
  (Terms 19.2) is the owner's decision.
- **Real smoke test, done:** the real LandingAI Split smoke took
  3.7 s and cost 0.0948 credits. Still not done: a browser flow with a real case
  file.

### Firm-managed accounts (branch `feat/managed-accounts`, not yet merged)

- A firm setting, «Cuentas administradas por el despacho»: the accounts a firm
  invited and that were created by that invitation have no personal workspace
  and use only the firm's workspace and keys. Enforced on the server (403
  `personal_workspace_disabled`), applied at once and ended by leaving the firm
  or turning it off. Migration `20261113_10_litt_managed_accounts.sql`
  (`organizations.managed_accounts`, `user_profiles.created_by_org_id`,
  `managed_notice_seen_org_id`). Design, covered routes and gaps in
  [`managed-accounts.md`](managed-accounts.md). Waits on the legal text (Terms
  5.5, Privacy Notice §8) and the new `LEGAL_VERSION`; not for production before.

### DOCX editing in LiTT (branch `feat/capa3-docx-editing`, not yet merged)

- The Word editor (`@docx-editor.dev` 2.33.0 → 2.35.0, as upstream) is on for
  anyone with write permission; the `NEXT_PUBLIC_LITT_DOCX_EDITING` gate is
  gone.
- **Every save creates a new `user_edit` version** on top of the version the
  edit was made on (same design as the Markdown editor); a stale base answers
  409 `document_version_conflict` and writes nothing. No version an AI run, a
  review or an approved artifact refers to is replaced, and an editor save
  never approves. The editor saves only when the user presses **Save**
  (or Cmd/Ctrl+S), plus once when the tab closes with unsaved edits: there is
  no timer, so an editing session does not fill the version history.
  `document_version_replace` is used by the document table and workflow
  assets, not by the Word add-in or the web editor.
- Evidence: a browser round trip over four synthetic `.docx`
  (`npx playwright test -c playwright.docx-roundtrip.config.ts`) keeps text,
  tables, numbering, comments, tracked changes, header/footer and
  bold/italic; the editor makes no request outside the local origin (packaged
  fonts, no CDN).

### Upstream cycle 11 (2026-11-12, integrated in #177, in production since `c10401f9`)

- Pin `54c2cb59` (#861), 54 commits; topics 1 to 9 of the intake come in (more
  precise model-failure messages and key ownership, unreadable documents not
  retried, memory scopes, request id, queue listeners, storage endpoint
  warning, outside-Word notice, Node 22.19 floor, dependencies); Sentry and the
  desktop app are rejected. Receipt: ledger §31. The backend image changed
  (Node floor) and went out in the `c10401f9` deploy.
- **Upstream pin after this cycle:** `54c2cb59` (`ffe49226` and later wait for
  the next intake).

### Production and integration 2026-11-12

- **Main:** `09dacab6` (merge of pull request #164). **Production:** runs
  `09dacab6`, deployed on 2026-11-12. It supersedes the 2026-11-11 section
  below, whose `3752c539` deploy is no longer current.
- **Interface languages, phase 1, complete and in production:** the whole web
  app and the Word add-in render in **es-MX** (and en-US) from one catalog
  ([`i18n.md`](i18n.md)). Integrated and deployed (#157 to #164):
  - #157 and #160: `scripts/i18n/translate.mjs` becomes a model-free
    export/apply tool for the catalog translation.
  - #158: accounts, authentication and entry screens.
  - #159: documents.
  - #161: settings and organizations.
  - #162: the Word add-in.
  - #163: the assistant, the shared components and `@mike/ui`.
  - #164: the remaining web screens (projects, tabular reviews, workflows,
    modals and popups, playbooks, training, recovery).
  - #156 (follow-up notes, [`followups.md`](followups.md)) went out in the same
    deploy.
- **Layers 4 to 6, integrated after that deploy and in production:** conversions
  (#168), comparison (#171 and #172) and scan reading (#175), below. Layer 6 is
  being deployed as 20261112j at the time of writing. The minor reserves of phase 1
  were closed in #165. Technical follow-ups are in [`followups.md`](followups.md).

### Integrated, in production: layer 4, document conversions (#168)

- Convert a document between Markdown, Word and PDF into a **new** document; the
  original does not change. Details in [`document-conversion.md`](document-conversion.md).
  Migration `20261112_10_litt_converted_source.sql` (adds `converted` to
  `document_versions_source_check`).
- Word → Markdown now has one converter (`docxToMarkdown`, mammoth + turndown):
  it replaced the regex conversion of `extractDocxMarkdown` and serves the
  person's conversion. Tabular review (`documentText`) and the assistant
  (`docxText`) still read plain text with offsets (`extractDocxBodyText`),
  unchanged.

### Integrated, in production: layer 6, scan reading (LandingAI) (#175)

- Read the pages of scanned PDFs with the owner's own LandingAI key (optional,
  off by default, personal or firm). Details in [`document-ocr.md`](document-ocr.md).
  Migrations `20261112_30_litt_landingai_key.sql` and
  `20261112_40_litt_document_ocr.sql`. It raises `LEGAL_VERSION` to `2026-11-12`
  (Terms and Privacy Notice name LandingAI), so every account accepts the new text
  on first sign-in after the deploy. Being deployed as 20261112j.
- The real-API smoke test used one **synthetic page** generated by the test
  script, not a real document: it shows the client works against LandingAI, not
  how it reads a real scan.

### Integrated, in production: layer 5, document comparison (#171, #172)

- Compare two Word documents of a project into a **new** Word document with
  tracked changes; both originals do not change. Details in
  [`document-compare.md`](document-compare.md). Dependency `docxodus` 15.1.0
  (MIT, WebAssembly, runs in the isolated parser). Migration
  `20261112_20_litt_compared_source.sql` adds `compared` to
  `document_versions_source_check`. The backend container limit is 1024 MB (#172) so a
  comparison fits next to the API.

### Production and integration 2026-11-11

- **Main:** `3752c539` (merge of pull request #155). **Production:** runs
  `3752c539`, deployed and verified on 2026-11-11, with migration
  `20261111_10_litt_markdown_versions.sql` applied. It supersedes the
  2026-11-09 section below, whose `bf00e4f2` deploy is no longer current.
- **Integrated and deployed (#150 to #155):**
  - #150: router output is capped at 32,000 tokens, with reasoning headroom for
    short completions (conversation titles through routers).
  - #151: OpenCode Go receives a per-conversation `x-opencode-session`, as its
    official rule asks.
  - #152: the BYOK provider modal's primary button becomes «Done» when no key is
    waiting to be saved; the «overloaded» provider message was also fixed.
  - #153: web search takes its key from the saved keys, not from the pinned
    model bag. Web search is on in production (owner decision of 2026-11-10),
    served by Brave; `LITT_CHAT_WEB_SEARCH` other than `enabled` turns it off.
  - #154: Claude Fable 5.2 in the direct Anthropic catalog.
  - #155: Markdown documents (`.md` upload, view and edit; each save creates a
    new `user_edit` version) and GitHub-style comparison of two versions of a
    document, text against text.
- **Closed beta by invitation:** access is by invitation only (#139,
  `20261109_20_litt_platform_invitations.sql`, Spanish auth emails), with the
  legal pages and their acceptance (#148, `20261109_30_litt_terms_acceptance.sql`),
  both in production.
- **Word add-in:** `word.litt.asteroitt.com` now has its DNS record
  (`A word.litt`, no Cloudflare proxy) and its Caddy block, both ready on
  2026-11-11; the service (`litt-word`) was already deployed
  ([`../deploy/prod/README.md`](../deploy/prod/README.md) §9).
- **System mail:** GoTrue sends over port 587 since 2026-11-09; the 465 of
  Neubox stopped answering.
- **Pending:** the interface languages phase 1 (including the English literals
  in the Word chat and the BYOK modal) and the OCR choice (local or LandingAI,
  owner to decide). Technical follow-ups from these pull requests are listed in
  [`followups.md`](followups.md).

### Production and integration 2026-11-09

- **Main:** `bf00e4f21691f922a65a746d8c48aa50a1df72ff` (merge of pull request
  #137, the follow-ups of training layer 4).
- **Production:** runs `bf00e4f21691f922a65a746d8c48aa50a1df72ff`, deployed on
  2026-11-09. Migration `20261109_10_litt_training_gym.sql` is applied on top
  of the ten `20261108_*` migrations (`_10`, `_20`, `_60`, `_64`, `_66`,
  `_68`, `_70`, `_76`, `_78` and `_82`). Training layers 1 to 4 are in
  production, and so is the simplification of legal references (#134). The
  deploy of `cf84ddd1` (2026-11-08 21:05 CST) and the deploys before it are
  superseded. The Word add-in service (`litt-word`) runs as part of this
  deploy.
- **Pending:** the interface languages phase 1
  (including the English literals in the Word chat), and the DNS for Word
  (`A word.litt`, no Cloudflare proxy). Technical follow-ups from the recent
  pull requests are listed in [`followups.md`](followups.md).
- **Word add-in:** the service is deployed, but its public name
  `word.litt.asteroitt.com` does not resolve yet: the DNS record is still pending
  ([`../deploy/prod/README.md`](../deploy/prod/README.md) §9).
- **Upstream pin:** `366fa4e92e5734c31910df848d293899d98ebc50` (2026-11-06,
  merge of #777), which was `upstream/main` when the cycle was cut: LiTT is up
  to date with upstream. The weekly read-only intake (Mondays 9:00 CDMX, next
  2026-11-09) reports anything newer. Policy:
  [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md); receipts in
  [`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §20–§29.
- **Startup secrets:** the backend refuses to start when
  `DOWNLOAD_SIGNING_SECRET` or `USER_API_KEYS_ENCRYPTION_SECRET` holds the
  `backend/.env.example` placeholder or is shorter than 32 characters (cycle 9,
  ledger §28.2). Production's `.env` was checked before the `39ca4b38` deploy:
  both hold 64 characters and neither is the placeholder.
- **Open product questions (ledger §29.6):** a private project inside a matter
  is reached only by its creator (W2); a matter whose project is private is
  reached by nobody once its creator leaves the firm (§24.3); the private
  catalogue must exclude matter content before it is ever opened (§24.2).
  Each rule is unchanged until the owner decides.

### Training layer 3: criterion (2026-11-08)

- **What:** the learning layer that trains judgment, not only the answer: the
  thermometer and the verdict («según el contraste de la IA»), hints and the
  counterparty's lawyer, the junior's accountability mode, the methodology
  annex, the bulk review designer, from correction to rule, the pupil's own map
  with calibration and retakes, the periodic full reading, the firm's criteria,
  the criteria contrast, authorship of the work and promotion by evidence v2.
  Rules: [`training.md`](training.md) (index at the top).
- **State:** complete, integrated into `main` and deployed, cards 1 to 16, each with its
  pull request: card 1 turn wiring (#110, with #107 the performance and status
  work before it), 2 verdict and confidence on the server (#113), 3 thermometer
  on screen (#116), 4 map, calibration and retake on the server (#122), 5 the
  map on screen (#125), 6 hints and the counterparty's lawyer on the server
  (#123), 7 hints on screen (#127), 8 accountability (#115), 9 bulk review
  designer (#114), 10 full reading (#118), 11 methodology (#117), 12 from
  correction to rule (#119), 13 criteria contrast (#128), 14 the firm's
  criteria (#121), 15 authorship (#120) and 16 promotion v2 (#131). The
  legal-reference fixes #124, #126 and #129 came along.
- **Closure (card 17b):** this file and `training.md` made coherent, the counts
  of the training screens as ICU plurals, the Word add-in shows the consulted
  firm criteria, and the account export carries every learning table (a test
  discovers the `training_*` tables of the schema).
- **Deployed:** in production since 2026-11-08 (`cf84ddd1`), with its ten
  `20261108_*` migrations.
- **Layer 4:** deployed (below).

### Training layer 4: gym (2026-11-09)

- **What:** fictitious practice cases written by the mentor (optionally from an
  AI draft on the mentor's own route), with planted errors, assigned to a pupil
  as a timed attempt. The server keeps the clock and closes the attempt with
  what was saved when time runs out; the answer key is hidden until submission;
  scoring is by paragraph number only; the mentor can give another attempt.
  Web only. Results feed promotion as counts. Rules:
  [`training.md`](training.md) («Layer 4: gym»).
- **State:** integrated and deployed: #136 and its follow-ups #137 (the account
  export hides the answer key of an attempt not yet submitted).

### Training layer 2: supervision (2026-11-07)

- **What:** a pupil's current mentor supervises them: the two-minute review of
  each work, the oral defense with five questions (one a change of facts) and
  its outcome recorded once, a time-limited urgency pass per matter that lifts
  «Tu turno primero» without lifting the seal, and promotion proposals that
  rest only on the pupil's own evidence; the pupil sees exactly the same
  («Lo que mi mentor ve de mí»). Rules: [`training.md`](training.md#supervision-data-layer-2).
- **State:** complete and integrated into `main`: card 1 (supervision data,
  contracts and access, PR #69), cards 2–4 (PRs #73, #77, #85) and the card 4
  follow-ups (PR #95), card 5 (the mentor panel at `/settings/training/mentor`
  in four tabs, the pupil's view and `docs/training.md`, bilingual; PR #99) and
  its follow-ups (PR #104). The panel has a fifth tab, «Criterio», since layer
  3. Word does not honor a pass. It is deployed with `267609c2`.
- **Layers 3 and 4:** both are deployed (above); layer 3 added the confidence
  calibration to the promotion function and layer 4 the gym counts
  ([`training.md`](training.md#supervision-data-layer-2)).

### Playbooks layer 1 (2026-11-07)

- **State:** complete and integrated into `main`: T1 (draft and ready, model
  mark, server-owned provenance; PR #71), T2 (draft from the questionnaire;
  PR #74), T3 (use a playbook as a starting point, PR #84, and its follow-ups,
  PR #89) and T4 (the screens: start with questions, drafts, models and rule
  origins, bilingual; PR #98). Behavior: [`playbooks.md`](playbooks.md).

### Interface languages, phase 0 (2026-11-07)

- **State:** the web app and the Word add-in speak es-MX and en-US from one
  catalog ([`i18n.md`](i18n.md)). Integrated into `main`: the shared catalog
  (0A1), the web app served through `next-intl` (0A2), the shared error and
  auth sentences (0C), the language selector and entry screens (0D1), the Word
  add-in's bilingual base, login and language selector (0G; PR #102) and the
  extraction codemod, conventions and upstream text recipe (0H).
- **Pending:** 0D2, 0E and 0F, and phase 1, which has not started.

### Visual audit (2026-11-07)

- **State:** the six batches are integrated into `main` (A PR #88, B PR #87,
  C PR #91, D PR #94, E PR #90 and F PR #86), with the follow-ups PRs #101,
  #104, #105 and #106.

### Training layer 1a (2026-11-06)

- **What:** mentors, pupils and per-practice stages (`pasante`, `junior`) inside
  an organization, and «Tu turno primero»: a pasante's chat turn (web, project,
  Word and tabular) carries their own approach, kept as a private note with a
  separately generated contrast.
  Behavior and rules: [`training.md`](training.md).
- **State:** merged into `main` (PR #56) with migration
  `20261106_50_litt_training.sql`; deployed with `fe5c9070`. Nothing
  changes for a person without a stage.

### Training layer 1b: pasante seal and output lock (2026-11-06)

- **What:** every version a pasante writes is sealed; it leaves LiTT
  (downloads, signed URLs, `/download/` tokens, the `documents-zip` export, the
  approved AI review report and its Drive publication) only once a person who
  may approve it approves its current bytes. In-app views stay open. Rules:
  [`training.md`](training.md#the-pasante-seal-and-its-approval-layer-1b).
- **State:** merged into `main` with migration
  `20261106_51_litt_training_output_lock.sql`, its UI (draft mark, approve
  button, hidden download links) and follow-ups (PRs #58–#60); deployed with
  `fe5c9070`.

### Production 2026-10-31

- **Production:** deployed. LiTT runs in production at `https://litt.asteroitt.com`
  on the shared VPS `staging-apps-dev`, following
  [`../deploy/prod/README.md`](../deploy/prod/README.md) and the host rules
  (`HOST-RULES.md` of `asteroitt-ops`). The first deployment was on 2026-10-30
  from `main` `b044675d`; each deployment runs the exact published commit that
  `GET /api/health` reports (`commit`), which is also the target of the
  **Código fuente** link (AGPL §13). On 2026-10-31 `main` `db91148e` was deployed
  with `deploy/prod/litt-deploy.sh` on the shared ingress network `edge`
  (HOST-RULES): `/` 200, the other ingress domains unchanged, images kept as live +
  1 previous, and the deploy marker removed.
- **Verified on the server (2026-10-30/31):** every long-running service healthy;
  `/` and `/login` answer 200 through the shared ingress; `/auth/v1/signup` answers
  404 (only `/auth/v1/verify` is public); `/api/health` reports the deployed commit;
  the restic repository in R2 `litt-backups` holds the first backup and the nightly
  03:45 run of 2026-10-31; a restore drill into a scratch database matched
  production (89 public tables, 186 applied migrations) and was dropped afterwards.
- **Still to verify by the owner in a browser:** no account exists yet, so
  delivery of the confirmation and password-recovery mail, a document upload to
  R2 and the **Código fuente** link have not been exercised. Signup stays open,
  with email confirmation, until the team has accounts; then `DISABLE_SIGNUP=true`.
- **No real client data** until Gate E (owner decision).

### Deployment package 2026-10-30

- **Production at the time:** not yet deployed (superseded by the section above). The package in
  [`../deploy/prod/`](../deploy/prod/README.md) now carries the owner's inputs:
  domain `litt.asteroitt.com`; Cloudflare R2 only, with documents in the
  bucket `litt-docs` and the daily restic repository (30 days) in
  `litt-backups`, each bucket with its own token; system mail from
  `LiTT <no-reply@asteroitt.com>` through GoTrue over SMTP with implicit TLS
  on port 465 (since 2026-11-09 it is 587, see the 2026-11-11 section). Email confirmation is on in production
  (`GOTRUE_MAILER_AUTOCONFIRM=false`), and only `GET /auth/v1/verify` of
  GoTrue is public, through `auth-edge`. The restic commands, the
  `auth-edge` routing, the Caddy block and the compose interpolation were
  checked locally with synthetic values. Live mail delivery, R2 and the
  restore drill are verified at deployment, which the owner authorized as the
  last step.

### Reconciliation 2026-10-23 (upstream sync)

- **Main:** `e6b003ba08a58cc3e454d5b4148d76f24e91308c`. It already contains the
  release candidate of 2026-10-21 (PR #51, squash `23b888b8`), the move to the
  standalone repository (PR #11), the approved sync plan (PR #12), the
  compatibility matrix (PR #13) and a secret-scan allowlist for the sync
  branch (PR #15).
- **Upstream sync:** LiTT was rebuilt on upstream
  `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` on the branch
  `sync/upstream-20261023` (strategy B of
  [`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md)). Slices S1–S7 have a
  Reviewer PASS on their exact snapshots
  ([`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §17);
  the S7 head passed CI, Schema drift, Stack tests, Word add-in and e2e by
  `workflow_dispatch`. S8a (this documentation and the deployment package) is
  in review; S8b (`AGENTS.md`, merge commit into `main`) is pending. Until that
  merge, `main` does not contain the sync and the new pin is not in effect;
  feature expansion stays paused.
- **Production:** not deployed. The deployment package
  ([`../deploy/prod/README.md`](../deploy/prod/README.md)) is restored on the
  sync branch and adapted to the converged tree: the schema is applied by
  upstream's migration runner, storage is R2 only, there is no third-party
  telemetry. No image of the synced tree has been built: no CI workflow builds
  images, so building them belongs to the deployment gate. A deployment still
  needs the owner's inputs (R2, SMTP, support address) and explicit
  authorization.
- **Debt:** the sync's non-blocking reservations are TD-025–TD-039 in
  [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md); TD-019 and TD-022 close with the
  merge.

### Reconciliation 2026-10-21

- **Main base:** `2eb27db8da9d0bf8a66c9fff5b73618aadc4f0f2` (PR #50, production
  deployment package for the shared VPS described in
  [`../deploy/prod/README.md`](../deploy/prod/README.md)). PR #50's push
  workflows passed: CI, CodeQL, Schema drift, Scorecard, Secret scan, security
  and Stack tests. PR #51 (the release candidate below) targets this base; its
  review, check and merge state is tracked on the pull request, not in this
  file.
- **Production:** the package is versioned; no deployment is verified. Deploying
  needs the owner's domain, R2 bucket/credentials and SMTP inputs plus explicit
  authorization.
- **Browser E2E:** failed from 2026-09-25 because the MinIO image was no longer
  pullable. PR #51 moves it to RustFS pinned by digest; only a run of the
  browser E2E workflow can show that the move works.
- **Upstream (2026-10-23):** pin `7e3607e7…`; the sync target is
  `upstream/main` `e7ab6bd4…`, 442 commits ahead (367 without merges). All 367
  are classified exactly once, superseding the 2026-10-21 security subset
  ([`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §14
  and §15), and the sync plan is approved
  ([`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md), strategy B). That clears
  the classification thresholds in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md);
  feature expansion stays paused while the sync executes (TD-019) until the
  merge commit lands and the pin advances.
- **Release candidate** `fix/release-candidate-20261021` (PR #51, the commits
  from `2eb27db8` to the pull request head): dependency security updates,
  browser E2E storage on RustFS, visible LiTT branding, the security ports
  listed in §14 of the ledger and the tabular export and transcript access
  fixes required by its independent review.
  Local verification on Node 22 with synthetic data and no external network
  for tests: backend, frontend and Word add-in unit/integration suites, lint,
  builds, typecheck, the Word add-in Playwright suite (Chromium, Office/API
  mocks) and the Schema drift runtime suites against PostgreSQL 16.14 (local
  instance, Docker replaced by a test shim). Not run locally: Docker stack
  tests (`test:stack`), web E2E and the WebKit Word suite, which the pull
  request workflows are configured to run, and image builds, which no CI
  workflow runs: they belong to the deployment gate.

The sections below are the reconciliation history up to 2026-09-14.

Phase 2 recovery has been assembled on `recovery/upstream-1b58-phase2`, based on
the pinned MikeOSS core and ported LiTT invariants, not a monolithic upstream merge.
The final Phase 3 candidate includes DB-backed MX catalog content, removal of
CourtListener, governed evidence/review/approved artifacts, and an isolated
fake-provider/fake-Drive Beta plus populated backup/restore harness.

The current evidence and the 16 acceptance criteria are recorded in
[`PHASE3_RECOVERY_DECISION.md`](PHASE3_RECOVERY_DECISION.md). That package separates
code/test proof from the governing exact-tree review and publication receipts.
A historical PASS or a successful build does not approve this candidate.

**Sync window 2026-09 closed (2026-09-14).** The upstream pin advanced from
`1b58c7aa…` to `7e3607e7…` after slicing the 118-commit batch (S1–S7, PRs
#22–#44: dependency majors, upstream upload-sessions/dbq/recovery-core surfaces,
scoped memory, security/CI hardening). Current main carries the integrated result
`951c834f7c4dce1e880ade878a795019fb840c2e` (tree `d0ec077e…`) with a local
G5-style re-verification receipt; product-phase candidates (transparent tables,
curation receipt/egress, attribution fallback) remain proposals pending owner
authorization. The Phase 3 narrative below is retained as history.

Authorized close boundary: exact-snapshot Reviewer PASS, commit, recovery-only
push and independent remote readback. No new PR, merge, remote deployment, real
LLM/Drive canary or production promotion is authorized. Main remains the supported
`d9fa8380e63837b6441cef169cf5ef80dfb55e54` baseline observed at reconciliation.

## Current immutable input identities

| Input | Commit | Tree |
| --- | --- | --- |
| Last reviewed recovery parent | `f4dc9846eaa5fba2a97288c645112a59eaadba36` | `31262db2d54e11e4c35b7addaaabe81734f97f2e` |
| Pinned upstream target | `1b58c7aa0520ff185c44698cea1a9e0c96af50ab` | `ce8d7e1a6e4b5460258441a5568a353c52180162` |

The commit containing this document, its exact tree, Reviewer card/verdict and
published remote OID are recorded externally after freeze. This avoids
predeclaring a self-referential commit or editing documentation after approval.

## Historical immutable Git identities (2026-08-30)

The values below were read from Git after fetching `origin` and `upstream` on
2026-08-30. The ledger-acceptance baseline is the immutable input to this docs-only
closeout; this file intentionally does not predeclare the future squash OID of its
own PR.

| Line | Commit | Tree | Meaning |
| --- | --- | --- | --- |
| Common ancestor | `204d2d533a075c74fc69f8b283c70fb4e94ec104` | `0cf7a04ffbe325b005066d6783238ac872ce3b88` | Last shared lineage baseline |
| Ledger-acceptance LiTT baseline | `0cafb80c85e8a0e75f7f78df744eb4806b7057d6` | `e2d87cd2e9712233c3fe409949986e0feee8f083` | PR #19 squash; control package, Beta and compatibility ledger integrated before this docs-only closeout |
| Final Beta PR head | `192310b6930d430667d729ed943e15e8441a61b1` | `5fbf99682e0e9592bfc53ff7a7cd7cdf3f8144d6` | Exact PR #18 head after the reviewed Playwright selector delta |
| Historical Beta analysis reference | `22cba89fe104b3c9df518762fb5a7170a5b16b03` | `4aba258495698862e5e77268beeefd5ca38ea459` | Behavior snapshot inspected by all four read-only analyses |
| Pinned MikeOSS recovery target | `1b58c7aa0520ff185c44698cea1a9e0c96af50ab` | `ce8d7e1a6e4b5460258441a5568a353c52180162` | Upstream target analyzed and re-fetched unchanged at closeout |

Git relations from the common ancestor:

- At ledger acceptance, LiTT main had 19 fork-only commits and lacked 278 commits
  from the pinned upstream target.
- From the common ancestor, that baseline changed 265 paths and upstream changed
  718 paths; 108 paths overlapped.
- The ledger-acceptance baseline differs from the final Beta PR head on seven paths: `README.md`,
  the five canonical control documents and the compatibility ledger. The composed
  Beta/control proof is recorded in the compatibility ledger; no monolithic merge
  was used.

Moving refs can change. Revalidate the recovery tuple before a new task; do not
advance the pinned upstream target during this recovery closeout.

## Product boundary

### MikeOSS core

The upstream product supplies the general legal-AI platform: authentication,
projects, document library, assistant/chat, tabular review, workflows, model
providers, Word add-in and supporting infrastructure.

### LiTT adaptation

LiTT adds or changes behavior for Mexican legal practice and controlled firm use:

- organization/workspace/matter tenancy and private matters;
- expanded RLS, authorization epochs and revocation boundaries;
- governed BYOK/model routing;
- insert-only audit and AI evidence records;
- expiring, single-use document download grants;
- removal of the US CourtListener workflow from the Mexican product surface;
- Civil/Mercantile MX playbook provenance;
- human review, approved DOCX, redline and Shared Drive publication;
- reproducible local staging, recovery and external-canary harnesses.

### Beta Jurídica 0.1

Beta 0.1 is an acceptance journey, not the whole product. It proves this vertical
slice with local fakes:

```text
owner/private matter
  -> DOCX R4/R6/R9
  -> deterministic AI execution + hashes/citations/receipt
  -> different reviewer reject/edit/accept
  -> approved DOCX + redline
  -> fake Drive publication + idempotent rehydration
  -> audit assertions + outsider 404
  -> disposable teardown with zero owned residue
```

It does not prove all assistant tools, all model providers, complete tabular review,
remote staging, production, real Google Drive, load/performance, or upgrade of an
existing production database.

## Beta evidence receipt

Historical reviewed candidate: `test/beta01-integrated-recovery@22cba89`.

Observed implementation evidence:

- targeted Playwright: 2/2 passed;
- `tsc`: passed;
- shell syntax and helper syntax checks: passed;
- `git diff --check`: passed;
- focused `aiCitations`: 16/16 passed;
- disposable cleanup: zero owned processes/containers;
- real AI calls: 0;
- real Google calls: 0.

Independent governing review:

- Kanban task: `t_6ad4f0c2`;
- reviewed exact commit/tree: `22cba89` / `4aba258`;
- verdict: **PASS with non-blocking reservations**.

Integration evidence:

- final PR head: `192310b6930d430667d729ed943e15e8441a61b1` /
  `5fbf99682e0e9592bfc53ff7a7cd7cdf3f8144d6`;
- PR #18 exact-head CI: 8/8 PASS;
- squash merge: `cc497bbf8f2ca7407d19801c4750340636e46548` /
  `60aba275013aa788bc6d57ddd32b20f5cca03afb`;
- post-merge push workflows: CI, Stack tests, CodeQL, Secret scan and Scorecard PASS;
- bounded integrated Beta journey: 2/2 PASS with fake provider/Drive;
- real AI calls: 0; real Google calls: 0;
- attributed cleanup: zero owned resources and the disposable worktree removed.

This evidence proves the local/integrated Beta boundary only. It does not imply
remote staging, a real provider/Drive canary or production.

## Current lifecycle state

| State | Status |
| --- | --- |
| Phase 0 control package | Integrated by PR #17 at `d63fdd83`; governing review `t_a6d77f46` PASS with non-blocking reservations |
| Beta implementation | Integrated by PR #18 at `cc497bb`; final reviewed head `192310b6` |
| Beta G3 exact-head CI | 8/8 PASS |
| Beta G4 post-merge | 5/5 push workflows plus bounded 2/2 Beta journey PASS; cleanup complete |
| Compatibility ledger | Integrated by PR #19 at `0cafb80`; review `t_15f7252d` PASS; PR CI 8/8 and post-merge 5/5 PASS |
| Upstream recovery implementation | Assembled on recovery; exact-candidate technical evidence in the Phase 3 package; main integration remains a separate gate |
| Local staging harness | Versioned; historical local smokes are not current remote proof |
| Remote staging | Not verified |
| Real Shared Drive canary | Blocked pending dedicated account/token/folder and authorization |
| Production deployment package | `deploy/prod/` on `main`; images are built per deployment from the exact commit and loaded by `litt-deploy.sh` (space check, deploy marker, retention live + 1) |
| Upstream sync 2026-10-23 | 442 commits to `e7ab6bd4…` (367 without merges) classified (ledger §15) and matrixed (§16); S1–S7 landed with PASS on `sync/upstream-20261023` (§17); S8a in review; S8b merge commit pending; feature expansion paused until the merge |
| Release candidate `fix/release-candidate-20261021` | Integrated by PR #51 at `23b888b8` |
| Production | Deployed at `https://litt.asteroitt.com` since 2026-10-30; server checks, nightly backup and restore drill verified; owner browser checks (mail, upload) pending |

## Current blockers and risks

The former reconstruction blockers (schema, auth/tenancy, provider architecture,
workflow catalog and Word overlap) have candidate implementations and verification
receipts. Their governance and integration states must be read from the exact
Phase 3 receipt, not inferred from the older Beta evidence above.

Remaining release decisions/debt:

- production retention/erasure remains undefined except account erasure (owner
  decision 2026-10-24, TD-008 partial); other destructive evidence operations
  remain fail-closed and disposable test teardown is not a retention mechanism;
- real Word host compatibility, remote staging, real providers/Shared Drive,
  SMTP, backups, monitoring/DNS and production each need their own permission;
- representative load, global coverage, broader frontend scenarios, operational
  AGPL source offer and historical-worktree cleanup remain bounded follow-ups.

The actionable owner/exit ledger is in [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md).

## Current decision and next gate

As of 2026-10-21: one Reviewer verdict on the exact snapshot of
`fix/release-candidate-20261021`. After PASS, the owner decides push/PR; the
exact-head CI must include the RustFS browser E2E, Stack tests and Schema drift
before merge. Production deployment then follows `deploy/prod/README.md` with
the owner's inputs and its own authorization.

As of 2026-10-23 slices S1–S7 of the upstream sync have PASS. The next gates
are the Reviewer verdict on the S8a snapshot, then S8b: the `AGENTS.md` rule
change, the final aggregate review, the merge commit's pull request with
exact-head CI and the merge into `main` with a merge commit. Feature expansion
resumes after that merge. Production deployment remains a separate,
explicitly authorized gate.

Historical gate (2026-09-14):

Finish the candidate's 16 gates and consume one exact-snapshot Reviewer verdict.
Only after PASS may the already-authorized recovery-only publication occur.
The owner then decides PR authorization; exact-head CI, merge/post-merge, formal
G5, each G6 boundary and G7 production remain separate. A candidate restore is not
formal post-merge G5. Permanent Phase 4 intake is prepared, not activated, and the
upstream pin is unchanged. No cron or external automation is authorized here.

See [`RELEASE_GATES.md`](RELEASE_GATES.md) for what each PASS does and does not
authorize, and [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md) for the steady-state rule.
