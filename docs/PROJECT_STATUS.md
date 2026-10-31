# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth.

**Last reconciled:** 2026-10-31<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike`

## Executive status

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
  on port 465. Email confirmation is on in production
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
