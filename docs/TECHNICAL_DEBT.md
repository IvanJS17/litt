# LiTT Technical Debt Ledger

This is the actionable debt ledger. A debt item is closed only by its exit criterion,
not by a green nearby test or a Kanban status change.

Severity:

- **P0:** immediate security/data-loss/release stop;
- **P1:** blocks upstream recovery or a trustworthy release candidate;
- **P2:** important but deferrable after explicit classification;
- **P3:** maintenance/polish.

## Candidate remediation ledger

TD-001/003/004/005/006/007 have recovery implementations and candidate verification
in the Phase 3 matrix: pinned-batch reconstruction, complete schema convergence,
Auth/MFA/tenancy, governed routing, the persisted MX catalog and upstream Word
approved-redline integration. They are not declared integrated into main by a local
PASS. Closure is bound to the candidate's exact Reviewer receipt; main acceptance
still requires G3/G4. Reconstructing the pin does not imply Git ancestry merged or
a new census of upstream commits.

## Remaining release debt and owners

| ID | Severity/boundary | Owner | Accepted candidate behavior / rationale | Next gate / exit |
| --- | --- | --- | --- | --- |
| TD-008 | P1 production retention (partial) | Iván + legal/product; Engineer implements | **Account erasure resolved** by the owner's 2026-10-24 decision (`20261024_51_litt_account_erasure`): `DELETE /user/account` starts a resumable job that deletes everything the person keeps outside the firm's matters, keeps matter work, audit history and AI evidence (shown as "Deleted user" through a join with the missing profile, never by updating insert-only rows), and returns a receipt dated to the 30-day backup expiry (`deploy/prod/litt-backup.sh` keeps daily sets only). New audit rows carry no address: the actor's `user_email` is dropped on insert, member and private-content permission events name the person by `target_user_id`, and invitation events by `invitation_id` (the address stays in the firm's `org_invitations` record); the audit view and CSV resolve the live name and show an erased member as "Deleted user". Rows written before this change are left as written (insert-only), so they may still hold an actor `user_email` (no longer returned by the API or CSV) or a recipient address in `title`; the event list shows "Deleted user" instead of that recorded address on member and permission events once the account is erased (older invitation events still show it), but the event's technical details ("Recorded title", metadata such as an old `target_email`) and the CSV, which uses a recorded `title` when present, still show it; search matches only `title`, so it no longer finds new member or invitation events by address. These rows age out under the audit retention still pending here. Every other destructive evidence operation still fails closed; no organization purge | Before G7: retention durations for the remaining data (organization content, departed members, audit and AI evidence) approved, implemented and tested |
| TD-009 | P1 operational release | Iván authorizes; Engineer operates | Only local synthetic candidate restore is proven | G5 after G4, then authorized remote staging and encrypted backup/restore with accepted RPO/RTO |
| TD-010 | P2 external Drive | Iván authorizes; Engineer executes | Fake transport only, no real Google Drive claim | Separately authorized G6 account/folder/token canary and cleanup |
| TD-011 | P2 global coverage | Engineer | Targeted gates and default-suite counts, not a fresh global coverage percentage | First post-integration maintenance slice: measure current coverage and risk-prioritized ratchets |
| TD-012 | P2 broader frontend coverage | Engineer; designer for visual decisions | Verified removal/citation controls and bounded Beta; not exhaustive assistant/tabular/browser QA | First post-integration UI slice: identified navigation/stream/visual regressions |
| TD-015 | P2 worktree lifecycle | Engineer after owner scope | Preserve historical worktrees and receipts; no bulk prune | Separate inventory-backed archive/remove task |
| TD-017 | P2 performance | Engineer | Functional synthetic proof, not throughput/latency SLO | Before production sizing: representative bounded benchmark with hardware/provider scope |
| TD-018 | P3 board hygiene | Engineer | Exact current task/receipt, no board-count progress claim | First maintenance window after integration: archive only classified historical cards |
| Word host matrix | G6 access boundary | Iván provides host/access; Engineer verifies | Chromium/WebKit use Office/API mocks | Authorized Word desktop/web host matrix; mock PASS is not host certification |
| Build fonts | P3 reproducibility | Engineer | Current frontend build uses public Google Fonts assets, no app secrets | Next build-hardening slice: classify source-backed font caching/pinning without altering design |
| TD-020 | P1 email ownership, before G7 | Iván (SMTP inputs) + Engineer | `GOTRUE_MAILER_AUTOCONFIRM=true` in every compose, production included: each address counts as confirmed, so the confirmed-email rule for email-keyed grants and invitations is inert until mail confirmation exists | SMTP configured, autoconfirm off in production, recovery/smoke scripts updated and signup/invitation flow verified. Production package (2026-10-30): SMTP configured and autoconfirm off; live flow verification and the other stacks pending |
| TD-021 | P2 staging harness storage | Engineer | `compose.staging.yml` pins `minio/minio:RELEASE.2025-09-07T16-13-09Z`, no longer pullable from docker.io or quay.io; recovery inventory tooling assumes MinIO. S6 ported the harness onto the converged schema but kept MinIO. Production uses R2 and CI E2E uses RustFS. The harness runtime suites need Docker and do not run in default CI | Harness on RustFS pinned by digest with re-baselined recovery inventory, or a documented internal mirror |
| TD-023 | P2 legacy tabular transcripts | Iván decides; Engineer implements | Tabular review chat messages written before source provenance (now `20261023_07_litt_tabular_chat_source_provenance`) have `source_document_ids = NULL` and are withheld from every reader, exports and memory included, and taint later turns of their chat: no evidence shows which documents fed them, and review access is not document access. Rows are kept, not purged | Either an evidence-backed backfill (e.g. reviews whose rows never changed) or an approved purge under the TD-008 retention ADR |

### Debt recorded by the 2026-10-23 upstream sync

Non-blocking reservations from the Reviewer verdicts on slices S2–S7 of
[`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md) (receipts in
[`UPSTREAM_COMPATIBILITY_LEDGER.md`](UPSTREAM_COMPATIBILITY_LEDGER.md) §17).
The accepted behavior is what the synced tree does today. Next review for every
row: 2026-11-06, the first biweekly sync window after the merge, unless the
exit column names an earlier gate.

| ID | Severity/boundary | Owner | Accepted behavior / rationale | Next gate / exit |
| --- | --- | --- | --- | --- |
| TD-025 | P2 egress evidence | Engineer | `llm.egress` is written with `recordAudit`, which is best-effort: a failed audit insert does not stop the model call. The `ai_*` evidence of governed executions fails closed. (S3) | Before G7: the egress record of every model call fails closed, or the accepted loss is approved by the owner |
| TD-026 | P2 route pinning outside chat | Engineer | Non-conversational jobs (tabular extraction, chat titles, memory curation, `sourceDocuments`) resolve the key as upstream does: no pinned route and no per-call egress record. Chats, Word and tabular review conversations and playbook runs are pinned. (S3) | Each job uses the route of the conversation or review that started it and writes egress; RED test per job |
| TD-027 | P2 playbook key from chat | Engineer; Iván decides the org-key rule | A playbook started from the chat tool uses the personal → deployment route and does not inherit an organization key. The key selector is still shown when a playbook is attached to the turn, although a playbook must not be offered the organization key. (S3, S4) | Verify the selector rule, then either hide the organization key for playbook turns or record the owner's decision; RED test |
| TD-028 | P2 Word chat record | Engineer | Local Word add-in chats have no server-side record. (S3) | Decide whether Word chats need server evidence; if so, record them through the pinned-route chat path |
| TD-029 | P2 frontend LiTT gaps | Engineer; designer for UI | LiTT workspaces have no frontend API or screen; the matter roster is missing; localization is incomplete; the Drive pages are reachable only by URL, by design while Drive is off (TD-010). (S4) | First post-merge UI slice: workspace API and roster with tests; Spanish localization pass |
| TD-030 | P1 support contact, before G7 | Iván (address) + Engineer | `SUPPORT_EMAIL` is not configured for LiTT: `frontend/src/shared/lib/userError.ts` keeps upstream's constant, the upstream maintainer's address, so "Contact support" would open a mail addressed outside the firm. (S4) | LiTT support address set (constant or deployment setting), the `mailto:` link verified, and no upstream address left in user-facing support paths |
| TD-031 | P2 approved redline | Engineer | The Word redline panel reads only revision 1 of an approved bundle. (S5) | Panel follows the bundle's revisions; e2e covers a second revision |
| TD-032 | P3 test stability | Engineer | One synthetic web e2e spec passed only on retry. (S6) | Root cause fixed or the spec quarantined with a tracked reason |
| TD-033 | P3 dead code after removals | Engineer | Case-citation UI and contracts outlive CourtListener (`CaseCitation`, `SourceDocumentType 'case'`, `case_opinions`; `delegateTools` keeps `cluster_id`/`sourceLines` for `kind === 'case'`, discarded by `normalizeCitation`); `mikeApi.getPanelDocument` still calls the retired `GET /documents/:id` with no production consumer. (S7) | Removed in one cleanup slice with the architecture and contract tests green |
| TD-034 | P3 error logging | Engineer | `bestEffort` and `internalErrorResponse` log raw error objects; no personal data was observed. (S7) | Both use the `safeError` redaction helpers |
| TD-035 | P3 supply-chain verification | Engineer | `frontend/bun.lock` was pruned by hand (the Dockerfiles install with `npm ci`); `security.yml` has no `workflow_dispatch`, so it does not run on the conflicting sync PR; no image of the synced tree has been built. (S7) | `bun.lock` regenerated or removed; images built from the exact release commit at the deployment gate ([`../deploy/prod/README.md`](../deploy/prod/README.md) §1); `security` green on `main` after the merge |
| TD-036 | P3 sync record | Engineer | The auto-merge drift list of the sync does not name the 11 upstream route files split into 24–28 module files (feasibility analysis §3); their LiTT changes were reapplied by intent and reviewed per slice. (S3) | Next sync intake lists them explicitly in its drift check |
| TD-037 | P2 revocation of queued jobs (C4) | Engineer | Queued tabular extraction, the organization audit export and playbook runs and imports carry and recheck the authorization epoch. Other queued jobs that read organization content (document text extraction and conversion, memory consolidation, other export builds) do not; they never widen a revoked user's access, and exports re-resolve access when they run. (S2 R1, S3) | Every queued job that reads organization content carries the epoch and fails on a stale one; RED test per job |
| TD-038 | P2 matter team and project access | Engineer; Iván decides succession | Matter membership gates project access but does not grant it: adding someone to a private matter's team also needs a project grant or override; a private matter's project with `visibility='organization'` gives `editor` to its team through that branch; a matter whose last member leaves has no successor. (S2 R2) | Adding a team member creates the project access in the same transaction; a rule for the last member's departure decided and implemented |
| TD-039 | P3 metadata edges | Engineer | `GET /single-documents/:id` answers 403, not 404, to a non-member who knows the UUID of a document in a private matter (no title or content exposed); the organization activity log shows redacted rows and lists actors of private matters without their title or ids; 405 responses carry no `Allow` header. (S2 R4, R5) | 404 for documents of matters the caller cannot see; activity-log actor list limited to visible matters; `Allow` header on 405 |
| TD-040 | P3 CodeQL alert from upstream | Engineer | CodeQL #45 `js/double-escaping` at `backend/src/lib/officeText.ts:4`: `decodeXml` decodes `&amp;` before the other entities, so `&amp;lt;` becomes `<` instead of `&lt;`. It only affects text extracted from Office XML for reading; nothing is written back. Arrived with upstream; open on `main`. (cycle 2026-10-24) | Decode `&amp;` last (or use one entity map), with a test for `&amp;lt;`; alert closed by the fix, or ported from upstream if it lands there first |
| TD-041 | P3 CodeQL alert from upstream | Engineer | CodeQL #46 `js/incomplete-sanitization` at `backend/src/lib/spreadsheet.ts:28`: `sanitizeCellText` escapes `\|` but not an existing backslash, so a cell ending in `\` can break the markdown table built for the model. Layout only, no injection into code. Arrived with upstream; open on `main`. (cycle 2026-10-24) | Escape `\\` before `\|`, with a test; alert closed by the fix, or ported from upstream |
| TD-042 | P2 upstream reconciliation (BYOK in organizations) | Engineer | Upstream #695 runs organization work only on the organization's or the deployment's keys and removes the owners' "allow members' own keys" setting. LiTT rejected it (ledger §18) because it contradicts the owner's recorded product decision (2026-08-12): personal BYOK plus optional institutional credentials, which replaced the single organization credential. Members may use their own pinned key in the firm unless the owners switch it off. Each new upstream change built on #695 needs the same reconciliation. (cycle 2026-10-24) | Not a pending decision. Closes when upstream no longer builds on #695, or when every later upstream change that does has been reconciled in its cycle and recorded in the ledger |
| TD-044 | P3 unused upstream settings | Engineer | Since the owner decision of 2026-10-30, chat subagents run on named routes the user configures in Settings > Subagents (`user_profiles.subagent_routes`). Upstream's `subagent_model`/`subagent_reasoning` columns and profile fields are kept, so upstream merges apply unchanged, but LiTT neither reads them for chat nor shows them. A value stored earlier stays in the row with no effect. | Drop them from LiTT's profile API and UI in an upstream cycle if upstream removes or reshapes them; otherwise keep them unused |

## Historical open ledger (2026-08-30; superseded status, retained risk evidence)

| ID | Severity | Area | Debt / risk | Evidence | Exit criterion |
| --- | --- | --- | --- | --- | --- |
| TD-001 | P1 | Upstream | Integrated LiTT still lacks 278 commits from the pinned upstream target | Git relation `0cafb80...1b58c7a` from common ancestor `204d2d5`; 265/718 changed paths with 108 overlapping | Recovery candidate integrates/classifies the pinned batch and records zero unclassified commits |
| TD-003 | P1 | Schema | LiTT and upstream both substantially changed fresh schema and migrations | 108 overlapping paths at ledger acceptance; `backend/schema.sql` changed on both lines | Fresh install and supported incremental upgrade converge to one fingerprint; reviewer PASS |
| TD-004 | P1 | Auth/tenancy | Upstream OAuth/onboarding/password flow is not reconciled with LiTT org/matter tenancy and MFA | concurrent changes in auth, user routes, schema and frontend contexts | Full identity/membership/revocation matrix passes on recovered core |
| TD-005 | P1 | Providers | Upstream AI SDK/router architecture is not reconciled with governed BYOK, egress and receipts | upstream replaced provider adapters; LiTT added governed routes | Provider matrix proves credential source, selected route/model, no silent fallback and correct receipt provenance |
| TD-006 | P1 | Workflows | Mexican playbook depends on pre-catalog workflow architecture | upstream removes `systemWorkflows.ts`; LiTT adds Civil/Mercantile playbook | Playbook lives in current catalog with id/version/source/hash and receipt tests |
| TD-007 | P1 | Word | Beta redline implementation overlaps a major upstream Word add-in rewrite | shared edits in Word API, edit cards, `useWordDoc`, redline and tests | Approved-redline contract passes on current upstream add-in without parallel legacy implementation |
| TD-008 | P1 | Retention | Deletion semantics for append-only AI/audit evidence are not approved for production (account erasure resolved 2026-10-24; see the release-debt table) | Beta needs disposable-stack cleanup; product DELETE can conflict with insert-only guards | Retention/erasure ADR, schema behavior, API response and tests are approved and implemented |
| TD-009 | P1 | Operations | No current remote staging and restore receipt for the integrated baseline | only local/disposable evidence is current | Isolated staging deploy plus encrypted backup/functional restore receipt; production untouched |
| TD-010 | P2 | External | Real Shared Drive canary is blocked | Kanban `t_a278ffcf`; missing dedicated account/token/folder/authorization | One authorized synthetic canary proves upload/idempotence/download/delete/404 and zero residue |
| TD-011 | P2 | Testing | Backend coverage outside Beta remains incomplete and existing coverage report may be stale | `docs/testing-coverage.md` records low global coverage on an older snapshot | Re-measure on recovered core; risk-prioritized auth/storage/provider/workflow tests added; ratchets updated honestly |
| TD-012 | P2 | Frontend | Critical assistant/tabular/hooks surfaces remain incompletely tested | `docs/frontend-testing.md` TODO list | Current-core component/soft-navigation/stream state tests cover identified user-visible contracts |
| TD-015 | P2 | Worktrees | Historical worktree registrations and branches are numerous; some are prunable | `git worktree list --porcelain` inventory | Separate authorized lifecycle task classifies preserve/archive/remove; no global prune without inventory |
| TD-017 | P2 | Performance | No representative concurrency/load baseline for recovered LiTT | upstream adds load testing; Beta is a functional smoke | Bounded representative assistant/tabular/Word benchmark with explicit hardware/provider boundary |
| TD-018 | P3 | Board hygiene | Historical Mike cards obscure current work | large completed/archived history | One active construction card per capability; current status derived from docs, not card census |

## Closed transitions

| ID | Area | Closure |
| --- | --- | --- |
| TD-002 | Git lifecycle | PR #18 integrated the reviewed Beta semantics. Exact-head CI passed 8/8; merge `cc497bb` received 5/5 post-merge workflows, a bounded 2/2 Beta journey and zero-residue cleanup. |
| TD-013 | Documentation | Removed CourtListener from deployment prerequisites and First Run instructions; README now states one explicit unsupported-for-LiTT policy and requires a new reviewed design for any Mexican legal-research source. |
| TD-014 | Governance | PR #17 integrated the control package; PR #19 integrated the 25-row compatibility/ownership ledger; this closeout reconciles all five canonical documents. Kanban remains execution evidence, not roadmap authority. |
| TD-016 | License | Every build embeds the full SHA of its commit (`GIT_SHA`): backend, frontend and Word add-in builds fail without it and the production backend refuses to start. `/health` reports it, and a "Código fuente" link to `github.com/IvanJS17/litt/tree/<SHA>` sits in the login footer, Settings → Acerca de and the add-in's Settings. `deploy/prod/README.md` §1 is the per-deploy procedure: build from a clean, published `main` commit, tag the images with the full SHA (`LITT_SOURCE_COMMIT`), check the image label, `/health` and the link, and rely on the full-history gitleaks `Secret scan` for the no-secret source. |
| TD-019 | Upstream drift | The 2026-10-23 sync rebuilt LiTT on upstream `e7ab6bd46cb4b3c22f150e184080d29c941df5c0`, the new pin, and reapplied the LiTT delta in slices S1–S7, each with a Reviewer PASS on its exact snapshot (ledger §17). Upstream is an ancestor of `sync/upstream-20261023`; it becomes an ancestor of `main` with the S8 merge commit (merge commit, never squash), which completes this closure. Later syncs are ordinary reviewed merges of `upstream/main` ([`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md)). |
| TD-022 | Upstream port cost | The sync adopted upstream's modular backend layout (#295) and its architecture test; `backend/src/routes/` no longer exists, so upstream fixes under `backend/src/modules/**` apply without translation. |
| TD-024 | CI availability | GitHub paused every workflow of the fork `IvanJS17/mike` from 2026-10-08 "due to the scale of GitHub Actions usage". On 2026-10-23 the code moved to the standalone repository `IvanJS17/litt`, outside the upstream fork network, so fork usage limits no longer apply. The usage reductions stay: superseded PR runs are cancelled, documentation-only changes skip e2e, Stack tests and CodeQL, and the scheduled e2e runs weekly. |
| TD-043 | Dependencies | The 2026-10-29 upstream cycle adopted google-auth-library 11 with the aligned `@ai-sdk/google-vertex` (`7797cadb`). Upstream pins the frontend's TypeScript on 5.x (`9831f558`) because `next build` type-checks through the TypeScript API, so the 7.0.2 bump of Dependabot #18/#28 no longer applies (ledger §19). |

## Closure protocol

For every P0/P1 item:

1. identify one RED contract or deterministic reproduction;
2. implement the smallest compatible change on an isolated worktree;
3. run focused GREEN and applicable aggregate gates;
4. freeze commit/tree and clean status;
5. obtain one independent Reviewer-profile verdict;
6. update this ledger and `PROJECT_STATUS.md` in the same integrated transition.

A deferred P2/P3 item must record owner, rationale, next review date and the product
behavior accepted during deferral. `Deferred` without those fields is still open.

## Decisions required from owner/product architecture

These are not implementation details that an agent may invent:

- production retention/erasure semantics for AI and audit evidence;
- whether and when real Google Drive becomes a supported integration;
- production deployment/data-residency/operator-access model;
- any jurisdictional research source replacing CourtListener;
- acceptance of material upstream behavior that changes user journeys or legal review semantics.
