# LiTT Permanent Upstream Policy

## Purpose

Keep LiTT close enough to MikeOSS to adopt security, architecture and product
improvements without sacrificing Mexican legal, tenancy, evidence or provider
governance invariants.

**Current pin:** upstream `e7ab6bd46cb4b3c22f150e184080d29c941df5c0`
(2026-10-22), reached by the 2026-10-23 sync
([`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md), receipt in
[`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §17).
The pin takes effect on `main` with that sync's merge commit, which makes
upstream an ancestor of LiTT `main`. The earlier
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
