# LiTT Permanent Upstream Policy

## Purpose

Keep LiTT close enough to MikeOSS to adopt security, architecture and product
improvements without sacrificing Mexican legal, tenancy, evidence or provider
governance invariants.

**Current pin:** upstream `366fa4e92e5734c31910df848d293899d98ebc50`
(2026-11-06, the merge of #777), reached by cycle 10, the last of the
2026-11-06 intake (receipt in
[`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §29).
It was `upstream/main` when the cycle was cut, so with that cycle's merge
into `main` LiTT is up to date with upstream. The pin takes effect on `main`
with that merge.

**Next intake:** the weekly read-only intake runs every Monday at 9:00
(America/Mexico_City); the first after this sync is 2026-11-09. It lists
`origin/main..upstream/main`, classifies what is new and asks the owner which
topics to adapt; it merges nothing.

The previous pins were `b91d1bdf4b7cdcbbe28def2aef4630bde1729a49` (2026-11-05),
reached by cycle 9 of the same intake (ledger §28);
`05d9aebcd30e6d9aef4d7190dfa0833475dd2500` (2026-11-04),
reached by cycle 8 of the same intake (ledger §27);
`fa37b86d4add8e24286f54ef6a83b0a715a6ed96` (2026-11-04),
by cycle 7 (ledger §26);
`74aad3019efa903a8fb89ec9c07617b2ab61126a` (2026-11-04),
by cycle 6 (ledger §25);
`d0a7ca7550bdaa3f21284b730c3139951ac89576` (2026-11-03),
by cycle 5 (ledger §24);
`31539729f4609cdf642a61bb963995668b97cac4` (2026-11-01),
by cycle 4 (ledger §23);
`27683564a5b72c20d5f2796bf826f3146a8c7bfe` (2026-10-30),
by cycle 3 (ledger §22);
`14d695f176152367cf44e89e200a04778b353b6d` (2026-11-04), by cycle 2 (ledger §21);
`1f7ae19fd1643fd350d564bbdbbe5801611d0765` (2026-10-30), by cycle 1 (ledger §20);
`d601932abecb7f6f5f01a863b939765ef2f3075d` by the
2026-10-29 cycle (ledger §19); and `d4fd89996e638f66ca55331cb787ce38e11975e1`
by the 2026-10-24 cycle (ledger §18), the first ordinary merge after the
2026-10-23 sync ([`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md), receipt in
the ledger §17), which made upstream an ancestor of LiTT `main`. The earlier
[`UPSTREAM_RECOVERY_PLAN.md`](UPSTREAM_RECOVERY_PLAN.md) is history.

## Source model

| Ref | Role |
| --- | --- |
| `upstream/main` | Read-only vendor/core input from `Open-Legal-Products/mike` |
| `origin/main` | Canonical integrated LiTT product |
| `sync/upstream-<date>` | Short-lived branch from current `origin/main` where `upstream/main` is merged and reviewed |
| `feat/*`, `fix/*` | Bounded LiTT changes from current `origin/main` |

LiTT never develops directly on `upstream/main`. Upstream refs are fetched and pinned
by full OID before classification or integration.

## Cadence and drift thresholds

### Weekly intake

Once per week:

1. fetch `upstream/main` without pruning unrelated historical refs;
2. record previous and new upstream full OIDs;
3. calculate commit count, changed paths and overlap with LiTT hot zones;
4. classify every upstream PR/commit group;
5. update the upstream ledger;
6. run no merge and make no product change during intake.

### Biweekly sync window

At least once every two weeks, integrate the accepted bounded batch. Security fixes
may trigger an immediate out-of-cycle sync.

### Stop-the-line threshold

New LiTT feature expansion pauses when any threshold is exceeded:

- more than 30 unclassified upstream commits;
- more than 14 days since the last successful intake;
- any upstream security/auth/storage/schema fix remains unclassified for 3 business
  days;
- the batch touches more than 15 LiTT hot-zone files without an approved sync plan;
- fresh schema and migration fingerprint no longer converge.

These thresholds are governance policy, not historical measurements.

## Merging upstream

Before 2026-10-23 LiTT and upstream shared no history after `204d2d53`, so
upstream was never merged wholesale: each change was ported by hand, and the
2026-10-23 sync had to rebuild LiTT on upstream once (strategy B of
[`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md)). That rebuild is not
repeated. From the sync's merge commit on, each cycle is an ordinary
`git merge upstream/main` on a `sync/upstream-<date>` branch:

- the merge result is checked against the compatibility matrix
  ([`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §16):
  rows marked `reject` or `gate` are reverted or kept off again, and `combine`
  rows keep the LiTT part that wins;
- a new upstream capability gets its own row before the merge lands;
- the merge is reviewed on its exact snapshot and integrated into `main` with
  a merge commit, never a squash, so upstream stays an ancestor of `main`;
- the cycle ends with a ledger entry (below) and the new pin.

## Classification

Every upstream batch receives one disposition:

- **adopt:** take upstream behavior substantially as-is;
- **port:** adopt architecture while reapplying LiTT invariants;
- **reject:** intentionally exclude with a documented reason and compensating control;
- **defer:** bounded delay with owner, risk, deadline and exit criterion.

No commit remains `unclassified` when a sync batch closes.

## LiTT invariants

Upstream sync must preserve:

1. organization/workspace/matter tenancy;
2. private matter isolation and outsider non-disclosure;
3. RLS/service-role boundaries and revocation checks;
4. MFA and governed identity lifecycle;
5. governed BYOK/provider routing and explicit egress provenance;
6. append-only audit/AI evidence unless a separately approved retention ADR changes it;
7. document-version, citation and receipt hashes;
8. human review before approved reports/redlines/publication;
9. Civil/Mercantile MX playbook source/version/hash provenance;
10. no US-jurisdiction feature presented as Mexican authority;
11. no real provider/Google contact from default CI or local E2E;
12. reproducible staging/recovery and attributed cleanup.

## Hot zones

Changes in these paths require an explicit compatibility note and focused regression:

```text
backend/schema.sql
backend/migrations/**
backend/src/middleware/auth.ts
backend/src/lib/access.ts
backend/src/lib/audit.ts
backend/src/lib/llm/**
backend/src/lib/authorizationEpoch.ts
backend/src/lib/recovery/**
backend/src/modules/chat/**
backend/src/modules/user/**
backend/src/modules/projects/**
backend/src/modules/orgs/**
backend/src/modules/workflows/**
backend/src/modules/playbooks/**
backend/src/modules/ai-recovery/**
frontend/src/app/contexts/AuthContext.tsx
frontend/src/app/contexts/UserProfileContext.tsx
frontend/src/app/lib/mikeApi.ts
frontend/src/app/components/assistant/**
frontend/src/app/components/workflows/**
word-addin/src/taskpane/**
```

## Sync workflow

1. **Intake receipt:** old/new upstream OID, commit count, path inventory.
2. **Compatibility matrix:** one row per capability group and LiTT invariant.
3. **Sync branch:** create from current `origin/main` and merge `upstream/main` at the
   pinned OID; revert the `reject` rows and re-close the `gate` rows of §16.
4. **RED contract:** add or identify the regression that protects the LiTT invariant.
5. **Integrate one capability group.** Do not mix unrelated UI, schema and provider
   changes in one commit.
6. **Focused GREEN:** run the smallest relevant tests.
7. **Aggregate gate:** type/lint/build/schema/integration/Beta as applicable.
8. **Freeze:** record commit/tree/status and changed paths.
9. **Review:** one Reviewer-profile verdict for the exact snapshot.
10. **PR/CI/merge:** separate owner authorization and exact-head verification.
11. **Ledger closeout:** adopted/ported/rejected/deferred, resulting LiTT OID and debt.

## Settings from upstream

Every tab or section of Settings that upstream brings is placed in LiTT's map of
Settings (`frontend/src/app/lib/settingsMap.ts`, described in
[`settings-map.md`](settings-map.md)) **before it is integrated**: its home
(personal or firm), group, name and help text, written to the rules in
[`i18n.md`](i18n.md#writing-the-text-of-settings). The test
`frontend/src/app/lib/settingsMap.test.ts` watches it: it fails when a page
appears under `settings/**` or `organizations/[id]/settings/**` that the map
does not list, or when a tab lacks a home, a group, a name or a help text. A sync
that fails it is not ready: place the page in the map, never loosen the test.
Upstream's own tab names and help text are not adopted (`en-US.json` keeps
upstream's English for the rest of the app, but not for the names and help texts
of Settings).

## Interface text from upstream

LiTT moves interface text to a catalog ([`i18n.md`](i18n.md)); upstream keeps
writing English literals. A cycle therefore meets three cases. The rule behind
all three: `en-US.json` holds upstream's English verbatim, so LiTT never
resolves a text conflict by editing English.

**A conflicted hunk where LiTT only extracted text** (LiTT's side is
`t("…")`, upstream changed the line or one next to it):

1. Take upstream's side of the hunk. If LiTT's side also carried a non-i18n
   change, resolve that part as usual and keep only the extraction out of it.
2. Run the codemod on the file with the namespace its keys already use
   (`git grep -o 't("[a-zA-Z.]*' <file>` shows it):
   `node scripts/i18n/extract.mjs --ns <namespace> --write --prune <file>`.
   Unchanged text reuses its existing key and translation. Text upstream
   changed gets a new key with upstream's English in `en-US` and
   `⟦por traducir⟧` in `es-MX`; that mark is the review flag, and the catalog
   test fails until it is translated. `--prune` removes the keys that the
   change orphaned.
3. Translate the marked messages (the old Spanish is in the diff of the
   removed key) and run the frontend typecheck and the i18n tests.

Whatever git merged without a conflict but left as a literal in a migrated
file (upstream moved a text, or rewrote a component around it) is caught by
the literal guard, and step 2 applies to that file.

**New upstream text in a migrated area** (a new screen, a new label): the
literal guard fails on it. Run the codemod on the file (step 2) and translate.
When that work would hold the sync back, the sync PR may instead raise the
file's count in `i18n-literal-baseline.json` in plain sight, and a follow-up
card lowers it in the same week; a sync is never blocked by text.

New text outside the migrated areas needs nothing: it stays English until its
area's card moves it.

**Measuring the cost.** Each cycle's ledger entry records the i18n work:
conflicted hunks in migrated files, new or changed strings, and the time
spent. The planning estimate, with about 2 minutes per conflicted hunk and
half a minute per new string:

| Kind of week | Conflicts in migrated files | New strings | Extra work |
| --- | --- | --- | --- |
| Quiet (bug fixes, SQL, backend) | 0–5 hunks | about 0–10 | under 30 minutes |
| Typical (median of the 8 weeks to 2026-11-07) | about 120 hunks in about 37 files | about 180 | about 4–6 hours plus review of the catalog diff |
| Large upstream feature | about 350 hunks | over 1,000 | 1–2 days |

The cost grows only as areas are migrated. When more than 15 migrated UI files
conflict in one cycle, open a separate i18n card in the same cycle instead of
growing the sync PR. The way to bring this cost near zero is upstream adopting
a catalog itself, proposed in
[open-legal-products/mike#817](https://github.com/open-legal-products/mike/issues/817).

## Parallelism rules

Parallel read-only analysis is encouraged. Parallel writers are allowed only with:

- one worktree per writer;
- disjoint file ownership;
- frozen interfaces;
- no shared schema/config/API registry edits;
- atomic child commits;
- sequential coordinator integration.

The coordinator owns all shared files and all conflict resolution. Workers never copy
files manually between worktrees.

## Upstream contribution policy

Contribute generic fixes upstream when they do not encode confidential, Mexican-only
or LiTT-specific policy. Candidates include:

- provider-neutral bug fixes;
- generic tests and accessibility fixes;
- workflow/catalog extension seams;
- reusable security hardening;
- stable interfaces that reduce future fork conflicts.

Keep in LiTT:

- Mexican playbooks and reviewed legal content;
- firm governance and deployment policy;
- LiTT tenancy/evidence decisions not accepted upstream;
- proprietary operational configuration or customer data.

AGPL notices and source obligations must remain intact. Secrets, customer data and
production credentials are never committed or included in source packages.

## Documentation and evidence

The following documents are updated in the same lifecycle transition when their facts
change:

- [`PROJECT_STATUS.md`](PROJECT_STATUS.md)
- [`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md) while a sync is in progress
- this policy;
- [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md)
- [`RELEASE_GATES.md`](RELEASE_GATES.md)
- [`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md)

Kanban comments may link evidence but cannot supersede these documents.

## Upstream ledger template

| Intake date | Old upstream | New upstream | Commits | Capability groups | Disposition | LiTT integration | Reviewer | Notes/debt |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| 2026-08-24 | `204d2d533a075c74fc69f8b283c70fb4e94ec104` | `54681b550d991f8c885f19f93dec762f1967ab3f` | 254 | initial recovery baseline | superseded by the 2026-08-30 re-pin | not integrated | not applicable | Historical audit receipt |
| 2026-08-30 | `54681b550d991f8c885f19f93dec762f1967ab3f` | `1b58c7aa0520ff185c44698cea1a9e0c96af50ab` | 24 (278 total from common ancestor) | 25-row schema/auth/provider/workflow/frontend/Word/CI reconciliation | `adopt` / `port` / `reject` / `defer` in the integrated compatibility ledger | Phase 2 not started; writers 0 | `t_15f7252d` PASS for the ledger | Upstream re-fetched unchanged at closeout; implementation evidence still required per slice |
| 2026-09-14 | `1b58c7aa0520ff185c44698cea1a9e0c96af50ab` | `7e3607e765e199f824808e1598cc44b3f99cd690` | 118 | dependency majors (express 5, zod 4, TypeScript 7/6-native, vitest 5, react 19.2.8), upstream upload-sessions/dbq/recovery-core surfaces, scoped memory, security/CI hardening | `adopt` / `port` / `reject` / `defer` per sync slice S1–S7 (PRs #22–#44) | Integrated into main `951c834f7c4dce1e880ade878a795019fb840c2e` (+ fixes #45 worker-entrypoint, #46 contexto imagen frontend); upstream pin advanced | `t_bda42951` PASS (closeout) + per-slice governing verdicts | Residual deferred: transparent tables, curation receipt/egress, attribution fallback → product phase; RustFS unify deferred; chat-title/delete gates → owner |
| 2026-10-21 | `7e3607e765e199f824808e1598cc44b3f99cd690` | `795f96083b6833c6c7b0d58dfa40336b0a335d52` | 439 | security/access/credential/storage/schema subset only (compatibility ledger §14) | `adopt` / `port` / `reject` / `defer` per §14; rest unclassified | Out-of-cycle security ports on `fix/release-candidate-20261021`, not integrated; pin unchanged | pending | Stop-the-line active (TD-019); browser E2E storage moved to RustFS |
| 2026-10-23 | `7e3607e765e199f824808e1598cc44b3f99cd690` | `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` | 442 (367 without merges) | full classification in [`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md) §4 and matrix in the ledger §16: kept with the base, combined, gated or reverted | strategy B: rebuild on upstream and restore shared history | S1–S7 landed on `sync/upstream-20261023`; merge commit into `main` pending (S8) | one PASS per slice (ledger §17) | supersedes the partial 2026-10-21 intake; new pin `e7ab6bd4…`; debt TD-025–TD-039 |
| 2026-10-24 | `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` | `d4fd89996e638f66ca55331cb787ce38e11975e1` | 4 | connectors per workspace (#693), organization keys central-only (#695), workspace-scoped Privacy & Data deletes (#694) and exports with the owners' member data policy (#696) | #693 adopt without its CourtListener half; #695 reject (contradicts the owner's recorded product decision of 2026-08-12: personal BYOK plus optional institutional credentials); #694 and #696 adopt with the matter gate and memory opt-in kept (ledger §18) | merge commit on `sync/upstream-cycle-20261024`, rejects reverted in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §18) | first ordinary cycle; Dependabot #17–#22 applied or noted; debt TD-040–TD-043 |
| 2026-10-29 | `d4fd89996e638f66ca55331cb787ce38e11975e1` | `d601932abecb7f6f5f01a863b939765ef2f3075d` | 55 | parser isolation (#721 series), error identity and local failure reporting, Sentry warnings/source maps, dependency and audit-gate updates | parser isolation and dependencies adopt; error classification adapted to a local sanitized reporter; Sentry parts reject (no third-party telemetry) (ledger §19) | two merge commits (`4355fdf3`, then `d601932a`) on `sync/upstream-cycle-20261029`; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §19) | Dependabot #27–#30 covered or applied; TD-043 closed |
| 2026-11-06 (cycle 1/10) | `d601932abecb7f6f5f01a863b939765ef2f3075d` | `1f7ae19fd1643fd350d564bbdbbe5801611d0765` | 16 (13 without merges) | set-based chat list (#736), named upload-worker failures and poll-gate repeat window (#744), export test wait (#746), onboarding Connect a model (#743), settings search (#745), release images with Sentry tunnel (#747) | chat list adapt (private-matter guard, migration `20261106_53`); #744 adapt to the local reporter; #743 and #745 adapt (personal BYOK copy; LiTT sections, no CourtListener); #746 adopt; #747 reject (no third-party telemetry; LiTT builds its images from the exact SHA) (ledger §20) | merge commit on `sync/upstream-c1-1f7ae19f`, adaptations in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §20) | first of ten cycles for the 334-commit intake of 2026-11-06; no new debt |
| 2026-11-06 (cycle 2/10) | `1f7ae19fd1643fd350d564bbdbbe5801611d0765` | `14d695f176152367cf44e89e200a04778b353b6d` | 7 (4 without merges) | playbook ids checked before Postgres (#716), Word add-in node-forge/follow-redirects advisories (#752), Sentry Vercel AI tool-error filter (#774) | #716 adopt, with a LiTT commit extending the check to share and source ids and the source document id; #752 adopt (LiTT already resolved both packages, lockfile and allowlist kept); #774 reject (no third-party telemetry) (ledger §21) | merge commit on `sync/upstream-c2-14d695f1`, adaptation in a separate commit; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §21) | second of ten cycles; no new debt |
| 2026-11-07 (cycle 3/10) | `14d695f176152367cf44e89e200a04778b353b6d` | `27683564a5b72c20d5f2796bf826f3146a8c7bfe` | 43 (no merges) | #749 30-Oct tranche: SQL list and permission performance C1–C7 and H2–H6, picker and directory paging in SQL, tabular/Word/PDF/chat rendering bounds, citation verifier reuse | adopt, except `org_members_departure_items` (adapt: LiTT C2 point 3 re-applied in `20261030_51_litt_departure_private_matter`), the picker (adapt: LiTT private-matter backstop kept), CourtListener paths, the Sentry stack-path change `fe8381fa` and the development-renderer e2e job (reject) (ledger §22) | merge commit on `sync/upstream-c3-27683564`, adaptations in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §22) | third of ten cycles; no new debt |
| 2026-11-07 (cycle 4/10) | `27683564a5b72c20d5f2796bf826f3146a8c7bfe` | `31539729f4609cdf642a61bb963995668b97cac4` | 63 (no merges) | #749 1-Nov tranche: SQL S1–S11 and L11b (membership by uuid, list candidates, departure by reverse references, anchored private-document access, audit page by key, counts after the page, per-version text search, job claim order), paged and batched reads, web list Sets, Word add-in device-only storage and edit batching | adopt, except `project_access_role` and `org_members_departure_items` (adapt: LiTT C2 re-applied in `20261101_50_litt_project_access_private_matter` and `20261101_51_litt_departure_private_matter`), org resources and the documents ZIP export (adapt: private-matter filter and pasante release check kept), CourtListener paths (`e2b7e9c4` reject) and the Sentry throttle `84637f74` (reject) (ledger §23) | merge commit on `sync/upstream-c4-31539729`, adaptations in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §23) | fourth of ten cycles; cycle-3 reservations W1–W3 closed; W2 recorded as an open product question; no new debt |
| 2026-11-07 (cycle 5/10) | `31539729f4609cdf642a61bb963995668b97cac4` | `d0a7ca7550bdaa3f21284b730c3139951ac89576` | 65 new (72 in `31539729..d0a7ca75`, 7 already in `main` through cycle 2; 1 merge) | #749 3-Nov tranche and merge: SQL M-S2…M-S9 and M-B6 (job payload and folder name indexes, set-based ownerless items, departure root candidates, audit person filter among actors, paged private catalogue, text backfill from unfinished rows, batched memory wipe), tabular row sync, batched and keyset reads, exports by container, Word add-in bulk decisions and device chats, PDF viewer | adopt, except `ownerless_org_item_ids`, `org_members_departure_items` and `organization_audit_events_page` (adapt: `20261107_50_litt_departure_root_candidates_private_matter`, `20261107_51_litt_ownerless_items_private_matter`, `20261107_52_litt_audit_username_filter_order`), the CourtListener half of `85838120` (reject, no net change) and the Sentry e2e of `851f57a9` (reject) (ledger §24) | merge commit on `sync/upstream-c5-d0a7ca75`, adaptations in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §24) | fifth of ten cycles, last of #749; cycle-4 departure reservation investigated and recorded as an open product question with W2; no new debt |
| 2026-11-07 (cycle 6/10) | `d0a7ca7550bdaa3f21284b730c3139951ac89576` | `74aad3019efa903a8fb89ec9c07617b2ab61126a` | 8 (7 without the merge, all from #786) | #786 PDF upload validation: the worker refuses a PDF upload without `%PDF-` in its first 1 KiB that pdf.js cannot open either, with the terminal file code `invalid_pdf_file`; the web app names the file, classifies the refusal as the user's to fix and leaves it out of Retry | adopt; the one test conflict keeps LiTT's comment without upstream's Sentry issue id (ledger §25) | merge commit on `sync/upstream-c6-74aad301`; one test adaptation in a separate commit, no product code adaptation; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §25) | sixth of ten cycles; no new debt |
| 2026-11-07 (cycle 7/10) | `74aad3019efa903a8fb89ec9c07617b2ab61126a` | `fa37b86d4add8e24286f54ef6a83b0a715a6ed96` | 9 (8 without the merge, all from #702) | #702 service boundaries: cross-domain account, purge and export workflows in `backend/src/application/`, provider credentials in `lib/providerCredentials/`, playbook types and schemas in their own files, paged and batched export reads, tests beside their owners, and a dependency-cycle gate over every application | adapt: LiTT's account erasure, exports (training data, C4 stamp, pasante release check), governed BYOK, pinned playbook routes and the org deletion refusal carried to the new files; `user.courtlistener.ts` and its test stay deleted; the cycle gate runs without the removed desktop app (ledger §26) | merge commit on `sync/upstream-c7-fa37b86d`, ports in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §26) | seventh of ten cycles; no new debt |
| 2026-11-07 (cycle 8/10) | `fa37b86d4add8e24286f54ef6a83b0a715a6ed96` | `05d9aebcd30e6d9aef4d7190dfa0833475dd2500` | 7 (6 without the merge, all from #703) | #703 shared packages: `frontend/src/shared` moves to `packages/ui` (`@mike/ui`) and `packages/client` (`@mike/client`) behind one barrel each, with the aliases, tsconfigs, webpack, Next, Vitest and Dockerfiles that consume them and an executable import boundary | adapt: LiTT's brand, AGPL source link, training UI, `CODE_KINDS` and add-in wiring carried into the packages and exported from their barrels; the Sentry modules, `releaseName`, `desktop/` and the Sentry docs stay deleted; the frontend image's standalone runtime follows the nested layout (ledger §27) | merge commit on `sync/upstream-c8-05d9aebc`, ports in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §27) | eighth of ten cycles; no new debt |
| 2026-11-07 (cycle 9/10) | `05d9aebcd30e6d9aef4d7190dfa0833475dd2500` | `b91d1bdf4b7cdcbbe28def2aef4630bde1729a49` | 50 (10 first-parent merges) | #788 Dependabot groups; #797 startup hardening (template, whitespace-only and short secrets refused at boot, missing `mfa_on_login` named, 15 s model-catalog timeouts, least-privilege workflow permissions, local e2e secrets); #715 README anchor; #699 #755 #757 #704 #725 #798 chat, playbook, spreadsheet, audit-canary and abort-import fixes; #750 release follow-up | adopt, except the `mfa_on_login` report (adapt: LiTT stays fail-closed), the `@sentry/*` packages, `stack-script.yml` and #750 (reject, no net change) (ledger §28) | merge commit on `sync/upstream-c9-b91d1bdf`, one test adaptation in a separate commit; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §28) | ninth of ten cycles; Dependabot #50–#55 covered; no new debt |
| 2026-11-07 (cycle 10/10) | `b91d1bdf4b7cdcbbe28def2aef4630bde1729a49` | `366fa4e92e5734c31910df848d293899d98ebc50` | 66 (7 first-parent merges) | #793 one failure, one report (GoTrue outage → 503 `upstream_unavailable`, schema drift reported once per route or operation, 42703/PGRST203 as drift); #779 session refresh without fan-out and `retry-after: 5`; #777 typed `find_documents` failure; #800 search in a new chat (e2e); #782 Sentry in development builds; #799 Electron parser mode; #801 packaged desktop smoke | #793/#779 adapt to the local report seam (login MFA stays fail-closed, now 503 `schema_out_of_date` for a missing column); #777 and #800 adopt; #782, #801 and the desktop half of #799 reject (no net change) (ledger §29) | merge commit on `sync/upstream-c10-366fa4e9`, adaptations and docs in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §29) | last of ten cycles: LiTT up to date with upstream at `366fa4e9`; open product questions listed in ledger §29.6; no new debt |
| 2026-11-12 (cycle 11) | `54c2cb5943601d61016a1c37db6e15815c05ee09` | `366fa4e92e5734c31910df848d293899d98ebc50` | 54 (8 first-parent merges) | provider verdicts and key ownership (#843), unreadable documents not retried, memory scopes, request id and `reporting_owner`, queue listeners, storage endpoint warning, outside-Word notice, Node 22.19 floor, lean Supabase stack (#845), dependency bumps (#844), citation highlight (#840); Sentry reporting infrastructure and community keys (#842, #861), desktop macOS fix (#816) | #843 adapt to the local report seam and the governed pinned route; #844 adapt (no `@sentry/*`); #845, #840 adopt; Sentry and `desktop/` reject (invariant 11, no third-party telemetry) (ledger §31) | merge commit on `chore/upstream-cycle-11`, adaptations in separate commits; merge into `main` with `--merge` after review | Reviewer card on the exact head (ledger §31) | the backend image changes (Node floor): build `litt-backend-c11check` and check `deploy/prod/` before deploying; `ffe49226` and later go to the next intake |

## Release metadata

Every LiTT release candidate must record:

```text
LiTT commit/tree
upstream commit/tree used as core
upstream commits still unclassified/deferred
Beta acceptance result
schema/migration fingerprint result
review verdict
CI result
staging/production state
```
