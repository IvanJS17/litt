# LiTT upstream sync plan (intake 2026-10-23)

Approved under the owner's authorization of 2026-10-23 for the complete upstream
sync. This plan closes the classification half of TD-019. Execution is tracked
slice by slice in this document and in
[`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §15; the
receipt with each slice's reviewed snapshot is §17 of the ledger.

## 1. Intake receipt

| Item | Value |
| --- | --- |
| LiTT base | `origin/main` `4f6206c0b26b02b6c4efddbaa3862a02cd68f4e7` |
| Previous pin | `7e3607e765e199f824808e1598cc44b3f99cd690` (2026-09-12) |
| New upstream target | `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` (2026-10-22) |
| Upstream commits | 442 (367 without merges, about 110 PRs) |
| Paths changed upstream since the pin | 2,012 |
| Paths changed by LiTT since the pin | 638 |
| Paths changed by both | 332 (71 in hot zones) |
| Git merge-base of LiTT and upstream | `204d2d53` (2026-08-06): the pin was copied, never merged |

Every one of the 367 commits is classified exactly once in three capability
inventories: backend (118 commits, 25 groups), frontend (172 commits, 27 groups)
and Word, CI and other (77 commits, 20 groups). The classification files are kept
with the sync evidence outside the repository and summarized in §4.

## 2. Strategy: rebuild on upstream and restore shared history

Two strategies were measured.

| | A. Port upstream into LiTT | B. Reapply LiTT on upstream (chosen) |
| --- | --- | --- |
| Conflicts to resolve now | 548 conflicting paths (`git merge-tree` of LiTT `main` and upstream) | 315 conflicting paths (`git merge-tree` from the pin) |
| Backend layout | translate upstream `backend/src/modules/**` (312 files; `src/routes/` no longer exists upstream) back into LiTT routes on every sync | adopt the modular layout and its architecture test |
| Migrations | re-author every new upstream migration by hand (72 this cycle) | converge once on upstream's migration runner |
| Next syncs | another manual port of every commit | an ordinary reviewed `git merge upstream/main` |
| Estimated effort | 170–470 h now and again each cycle | 186–498 h once; 25–70 h per later cycle |

Both conflict counts are distinct paths reported by
`git merge-tree --write-tree --name-only` (git 2.56): A merges `HEAD` with
`upstream/main` on their real merge-base `204d2d53`; B uses
`--merge-base 7e3607e7`. They are not the 332 paths changed by both sides (§1),
which counts edits, not conflicts.

B is chosen because A never converges: upstream ships about 90 commits a week
and keeps restructuring, so every manual port costs as much as this one. B costs
about the same once and makes later syncs incremental.

### Git mechanics

1. Tag the current LiTT main as `pre-sync-20261023`.
2. Create `sync/upstream-20261023` from the upstream target.
3. Reapply the LiTT delta (`7e3607e7..origin/main`, 638 paths) as bounded,
   reviewed slices (§5); revert the rejected upstream capabilities (§4.2).
4. Close with a merge commit whose parents are LiTT `main` and the sync head, and
   whose tree is the reviewed sync tree. Integrate it with a **merge commit**,
   never a squash, so upstream becomes an ancestor of LiTT `main`.
5. From then on, each biweekly sync is `git merge upstream/main` on a sync branch,
   with the same review, revert list and CI gates.

The previous rule "never merge upstream wholesale" becomes "merge upstream only
through a reviewed sync branch that reapplies LiTT invariants and reverts the
rejected capabilities". `UPSTREAM_POLICY.md` and `AGENTS.md` change in the final
slice, together with the merge itself.

## 3. Tenancy conditions (blocking for the final merge)

Upstream now has organizations, roles (owner, admin, member) and organization
sharing, but no workspace or matter entity. Most LiTT content access is already
a port of upstream's organization-access model (53 of 69 tables are shared).
Reconciliation is feasible under these conditions:

- **C1 — workspaces and matters stay.** They are an approved product decision
  (decision D1, §3.1): workspaces are internal units of one firm, and matter
  teams are chosen by the partner who creates the matter. Both remain a LiTT
  extension on top of upstream organizations.
- **C2 — no standing access to private matters.** Organization owners and admins
  do not see or open private matters, in TypeScript and in SQL. Upstream's
  "ownerless" project takeover is not applied to private matters. The SQL mirror
  of project access also enforces matter privacy: today that check lives only in
  TypeScript.
- **C3 — append-only audit.** Audit and AI evidence stay insert-only and
  attributed (with organization). Upstream's audit deletion and organization
  purge do not apply.
- **C4 — authorization epochs.** Revocation keeps invalidating old sessions and
  jobs, with triggers covering deletes.
- **C5 — no organization deletion and no organization-wide listing.**
  `DELETE /orgs/:id` answers 405 until the retention decision is implemented
  (TD-008). `GET /orgs/:id/resources`, live upstream, also answers 405 until
  `project_access_role` and `project_access_scope` filter by matter membership:
  enabled earlier, it would list the titles of other teams' private matters.
  The existing regression in
  `backend/src/__tests__/integration/orgs.routes.test.ts` ("unsupported
  organization endpoints") keeps both 405s. Changing that test requires an
  explicit Reviewer verdict on the matter filter, not a slice adjustment.

Each condition gets a RED regression before its implementation.

### 3.1 Decision D1: what a workspace is

Upstream has no workspace level, so the evidence analysis asked for this
decision before the tenancy schema slice.

| Option | Effect | Cost |
| --- | --- | --- |
| (a) Collapse: workspace = organization, matters hang from the organization | Smallest tenancy delta; recommended by the evidence analysis because LiTT has no workspace endpoint or screen yet | Baseline |
| (b) Keep `workspaces` and `workspace_memberships` as a LiTT extension under upstream `organizations` (**chosen**) | One firm can hold several internal units with their own members, library and workflows; a workspace admin gets no automatic access to matters | About +800 LOC and +2 tables: `is_workspace_admin` rewritten over `org_members`, RLS of both tables re-issued, four roles remapped, `projects.workspace_id` |

Decision: **(b)**. Source: the owner's register of approved decisions (§19 of
the private product contract), which approves an internal unit as a workspace
of the same firm rather than a separate tenant, and private matters whose team
is chosen by the partner who creates them. Cost (b) is accepted. This record
replaces a separate ADR; a change of D1 needs a new owner decision recorded
here before S2 is reviewed.

## 4. Dispositions under strategy B

With B every upstream capability arrives with the base. A capability is kept
unless it breaks a LiTT invariant, in which case it is reverted or gated.

### 4.1 Kept (arrive with the base)

- Backend modular layout (#295) and its architecture test.
- Dependency and toolchain updates; self-hosted fonts.
- Chat turn lifecycle, streaming runs that survive refresh, answer rendering,
  citation highlights and two simultaneous chats.
- DOCX viewer and editor. Before the final merge: license, egress and the
  version, hash and audit contract are checked.
- Organization settings, profile images and logos, audit with names.
- BYOK provider matrix and model registry, with every upstream provider
  visible (owner decision of 2026-10-23). Route resolution stays fail-closed
  and pinned per conversation, with no silent fallback; a user's own endpoint
  (`custom`) cannot reach loopback, private, link-local or cloud-metadata
  addresses, checked on every hop. Operator-declared endpoints
  (`openai-compatible`, Ollama) may be internal, cannot be set by users and
  write egress provenance.
- Unified connectors with protected write actions, and upstream playbooks. The
  Mexican Civil/Mercantile playbook keeps its provenance in the governed catalog.
- PDF extraction for pages without a text layer, provider error and deadline
  handling, startup and storage lifecycle, MCP redirects with SSRF checks per hop.
- CI savings: add-in test workers, per-worker e2e accounts, removal of the evals
  job.

### 4.2 Reverted or gated (LiTT invariants)

| Capability | Reason |
| --- | --- |
| Sentry in backend, web and add-in | No third-party telemetry by default |
| CourtListener connector and listing | Removed by LiTT policy (TD-013); not Mexican authority |
| Desktop macOS app (`desktop/`) and its workflow | Second data plane outside tenancy, audit and retention; macOS runners multiply Actions usage. Revisit 2026-11-20 |
| Workflows that raise Actions usage (separate Supabase jobs, nightly stress, image builds on every push) | TD-024 reductions stay; image builds move to the deployment gate |
| US template catalog content | Not presented as Mexican authority; the catalog feature stays without US seeds |
| Suggested third-party MCP connector | No third-party service suggested by default |
| Organization-visible defaults, owner access to private content, audit deletion, organization purge | C2, C3 and C5 |

Upstream's `loadtest.yml` removal is not applied. LiTT keeps its stream
time-to-first-byte measurement.

## 5. Slices

All slices land on `sync/upstream-20261023`. Each slice is one reviewed snapshot
(Reviewer verdict on the exact tree) with focused tests. CI runs on the draft
pull request.

| Slice | Content |
| --- | --- |
| S1 | Branch and tag; migration and schema convergence: upstream's 160 migrations and runner as the base, the 10 LiTT re-issues of upstream migrations dropped, the 12 LiTT-owned migrations renumbered after `20261021_04`, `schema.sql` regenerated, ledger seeded, custom recovery ordering retired, Schema drift baseline updated |
| S2 | Tenancy and access: C1–C5 with RED regressions (workspace and matter tables, matter privacy in TypeScript and SQL, epochs, insert-only audit, organization deletion closed) |
| S3 | Backend LiTT delta in the modular layout: governed BYOK routing, provenance and receipts, approved artifacts, Drive fail-closed, tabular chat provenance, Mexican playbook |
| S4 | Frontend LiTT delta: branding, BYOK selector, private-matter UI, error mapping |
| S5 | Word add-in LiTT delta |
| S6 | CI and e2e: RustFS, Actions reductions, LiTT workflows |
| S7 | Reverts of §4.2 |
| S8 | Documentation: policy, `AGENTS.md`, status, ledger and debt; final aggregate review; merge commit; pull request with exact-head CI; merge with a merge commit; new pin recorded |

Acceptance criteria named for specific slices, in addition to their content:

- **S2:** RLS and grants keep LiTT's posture, not upstream's (56 tables with RLS,
  no policies, `revoke all` from `anon` and `authenticated`): RLS on every table
  of the converged schema, `anon` and `authenticated` revoked by default, and
  only LiTT's policies re-issued over the converged tables: six select-only
  tenancy policies with `select` granted to `authenticated`, and ten AI-evidence
  policies limited to `service_role`. No browser DML policy. A schema regression
  asserts it.
- **S3:** `chats.credential_ref` and `chats.model_provider`, dropped upstream,
  are restored and used by routing. S3 does not close without them: otherwise
  the release ships breaking the governed BYOK invariant.
- **S6:** policy invariant 11 holds: default CI and local e2e make no real
  provider or Google call.
- **S8:** the rule changes in `AGENTS.md` ("Never merge upstream wholesale") and
  `UPSTREAM_POLICY.md` are in the same reviewed snapshot as the merge commit and
  are verified before the merge commit is created, so `main` never holds a tree
  produced under a rule it contradicts.

Open Dependabot pull requests are closed or rebased after S8, against the merged
dependency set.

### 5.1 Execution state (2026-10-23)

| Slice | State |
| --- | --- |
| S1–S7 | Landed on `sync/upstream-20261023`, each with a Reviewer PASS on its exact snapshot (S5 and S6 reviewed together); receipt in the ledger §17. Exact-head CI of S7 green by `workflow_dispatch`, because the draft pull request #14 is `CONFLICTING` by design and starts no `pull_request` checks |
| S8a | Deployment package (`deploy/prod/`) and LiTT documents restored on the converged tree and updated: this document, the policy, the ledger, the debt ledger, the status and the release gates; recovery documents restored as history. In review |
| S8b | `AGENTS.md` rule change, final aggregate review, merge commit and its pull request with exact-head CI, merge with a merge commit, pin recorded on `main`. Pending; done by the coordinator with the owner present |

The S8 criterion above holds across the split: the policy change lands in S8a
on the sync branch, so it is part of the tree the S8b merge commit
integrates, and `AGENTS.md` changes in S8b before that merge commit is
created.

## 6. Risks

- Silent drift in about 62 files that auto-merge differently: each slice lists
  them and the Reviewer checks them.
- Eleven large upstream route files were split into 24–28 module files: the
  LiTT changes to them are reapplied by intent, not by patch.
- The upstream architecture test becomes binding for LiTT code.
- Production has no database yet, so migration convergence needs no data
  migration. If a populated preproduction database appears, it is baselined
  with upstream's runner, not with custom ordering.
