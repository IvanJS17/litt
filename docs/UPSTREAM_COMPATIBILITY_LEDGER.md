# LiTT Upstream Compatibility Ledger

> **Integrated control artifact.** This file consolidates the four immutable,
> read-only recovery analyses and governs compatibility, interfaces and writer
> ownership together with the five canonical control documents. It does not by
> itself authorize a product writer, staging, external-provider contact or production.

## Current execution reconciliation — 2026-09-14

**Upstream sync window closed; pin advanced.** The bounded window opened against
`1b58c7aa0520ff185c44698cea1a9e0c96af50ab` is closed: all 118 upstream commits
were classified and integrated or explicitly deferred through slices S1–S7
(PRs #22–#44), covering dependency majors (express 5, zod 4, TypeScript 7 /
6-native, vitest 5, react 19.2.8), the upstream upload-sessions / dbq / recovery
core surfaces, scoped memory, and the security/CI hardening batch. The upstream
pin advances to `7e3607e765e199f824808e1598cc44b3f99cd690` (tree
`f29d0ce404dede9e6ec9a2b509f7579f01757306`); the integration result is main
`951c834f7c4dce1e880ade878a795019fb840c2e` (tree
`d0ec077ec361e4a0bc11a3a1910d2ae889ec563f`), with a local G5-style
re-verification receipt in the project forensics archive. Residual items
(transparent tables, curation receipt, attribution fallback) remain
product-phase proposals pending owner authorization. The 2026-09-09 paragraph
below is retained as history.

The 25-row decisions and pinned upstream input below remain authoritative. The
coordinator scaffold, A–F ports and G implementation now exist on the recovery
branch. Final assembly also removes the previously residual CourtListener surface
and materializes the frozen MX playbook in `mike_workflows` through the existing
sync/RPC, preserving its own source commit and pending legal-validation status.
Execution reads the persisted active definition and exact prompt hash; no legacy
runtime registry or missing-row fallback is used.

The current verification/review/publication boundary is the 16-gate
[Phase 3 decision package](PHASE3_RECOVERY_DECISION.md). The former blocker text
and receipts below describe the historical control transition, not a command to
restart A–F or advance the upstream pin. Later lane prompts preserve ownership
contracts; they do not authorize duplicate implementation. Retention, real hosts,
external canaries, performance and release operations remain deferred as specified.

## 1. Historical control gate (2026-08-30)

The Phase 0 control package, reviewed Beta baseline and this compatibility ledger
are integrated in `origin/main`. PR #18 merged the final reviewed Beta head
`192310b6930d430667d729ed943e15e8441a61b1` into commit
`cc497bbf8f2ca7407d19801c4750340636e46548` with tree
`60aba275013aa788bc6d57ddd32b20f5cca03afb`. PR #19 merged the reviewed ledger
head `33ea753368c70bf6b6edbe34d2a0f0f8e0c93b60` into the ledger-acceptance baseline
`0cafb80c85e8a0e75f7f78df744eb4806b7057d6` with tree
`e2d87cd2e9712233c3fe409949986e0feee8f083`.

G4 evidence at that historical transition:

- PR exact-head CI: 8/8 checks succeeded, including Playwright;
- post-merge push workflows on `cc497bb`: CI, Stack tests, CodeQL, Secret scan,
  and Scorecard all succeeded;
- bounded integrated Beta journey: 2/2 passed with fake provider/Drive and a
  disposable Supabase stack;
- the first harness attempt stopped before application execution because
  Turbopack rejected an external `frontend/node_modules` symlink; cleanup was
  complete, a physical dependency copy made the same production build pass,
  and the single corrected retry produced the 2/2 journey result;
- real AI calls: 0; real Google calls: 0;
- attributed cleanup: zero owned containers, volumes, networks, listeners,
  processes, or ignored files; the detached post-merge verification worktree
  and its synthetic failure evidence were removed.
- ledger review `t_15f7252d`: PASS with zero P1/P2 on exact tree `e2d87cd2`;
- PR #19 exact-head CI: 8/8 PASS; post-merge push workflows on `0cafb80`: 5/5 PASS.

At the historical ledger transition, implementation awaited the coordinator
scaffold and migration baseline. That prerequisite was subsequently completed;
see the current execution reconciliation above. The historical control-only
closeout itself changed no product code.

## 2. Immutable evidence set

All four analyses used exactly this tuple. A future upstream intake does not move
this recovery batch; newer upstream commits belong to the next intake.

| Identity | Commit | Tree | Lifecycle meaning |
| --- | --- | --- | --- |
| Ledger-acceptance control/Beta/ledger baseline | `0cafb80c85e8a0e75f7f78df744eb4806b7057d6` | `e2d87cd2e9712233c3fe409949986e0feee8f083` | PR #19 squash; exact-head CI and post-merge workflows passed before the docs-only closeout |
| Integrated Beta G4 baseline | `cc497bbf8f2ca7407d19801c4750340636e46548` | `60aba275013aa788bc6d57ddd32b20f5cca03afb` | PR #18 squash; G4 CI, bounded Beta journey, and cleanup passed |
| Integrated control-package baseline | `d63fdd83dd1ccaaf07a23466b0e2fe540a4d973d` | `ac1a31ec4845ec6a2eedb50f6282297b00fce4a4` | PR #17; exact control tree used by all four analysis cards |
| LiTT/Beta analysis reference | `22cba89fe104b3c9df518762fb5a7170a5b16b03` | `4aba258495698862e5e77268beeefd5ca38ea459` | Original reviewed Beta behavior inspected by all four analysts |
| Final Beta PR head | `192310b6930d430667d729ed943e15e8441a61b1` | `5fbf99682e0e9592bfc53ff7a7cd7cdf3f8144d6` | Original Beta plus reviewed Playwright runner-selection delta (`t_b54d75b3`) |
| MikeOSS upstream core | `1b58c7aa0520ff185c44698cea1a9e0c96af50ab` | `ce8d7e1a6e4b5460258441a5568a353c52180162` | Core target for the recovery reconstruction |
| Common ancestor | `204d2d533a075c74fc69f8b283c70fb4e94ec104` | `0cf7a04ffbe325b005066d6783238ac872ce3b88` | Last shared lineage baseline |

Observed at dispatch:

| Comparison | Left-only commits | Right-only commits | Changed paths from ancestor | Overlap with upstream |
| --- | ---: | ---: | ---: | ---: |
| Beta vs upstream | 28 | 278 | Beta 258 / upstream 718 | 108 |
| Integrated control vs upstream | 17 | 278 | control 252 / upstream 718 | 108 |

Ledger-acceptance baseline against the same pinned upstream batch:

| Comparison | Left-only commits | Right-only commits | Changed paths from ancestor | Overlap with upstream |
| --- | ---: | ---: | ---: | ---: |
| `0cafb80` vs pinned upstream | 19 | 278 | LiTT 265 / upstream 718 | 108 |

The final Beta PR head and ledger-acceptance tree differ on exactly seven paths:
`README.md`, the five canonical control documents and this ledger. Before PR #19,
each of the first six blobs in the integrated Beta tree equaled the PR #17 control
baseline; PR #19 added only this ledger. No Beta product path was lost during
composition.

Canonical authority, in descending order:

1. integrated `docs/PROJECT_STATUS.md`, `docs/UPSTREAM_RECOVERY_PLAN.md`,
   `docs/UPSTREAM_POLICY.md`, `docs/TECHNICAL_DEBT.md`, and
   `docs/RELEASE_GATES.md`;
2. explicit decisions from Iván;
3. executable LiTT/Beta invariants;
4. upstream implementation;
5. analyst or writer recommendation.

## 3. Analysis receipts

| Lane | Kanban task | Status | Scope | Result use |
| --- | --- | --- | --- | --- |
| A | `t_769dd3c6` | `done` | schema, auth, tenancy, audit, deletion | Governs Slice A data/security constraints |
| B | `t_6402b72c` | `done` | providers, routing, credentials, workflows | Governs Slices C and D contracts |
| C | `t_f41446c2` | `done` | web frontend, Word, approved redline | Governs frontend scaffolding, Slices E and F |
| D | `t_06413920` | `done` | CI, schema gates, Beta parity, staging/recovery | Governs verification and Slice G |

All four echoed the same full commits and trees. Lane D decorated its `adopt` and
`port` headings rather than using the literal bare labels; the sections were
complete and unambiguous. No report was stale, silent, timed out, or tied to a
nearby snapshot.

## 4. Consolidated decisions and resolved analysis tensions

| Topic | Apparent tension | Resolution | Authority |
| --- | --- | --- | --- |
| Recovery strategy | Large two-way diff could invite a merge | Build on the pinned upstream core and port LiTT invariants in slices. Never merge Beta and upstream monolithically. | Recovery plan |
| Schema bootstrap | Beta E2E replays migrations fail-tolerantly; upstream supplies schema-fingerprint convergence | `backend/schema.sql` is the sole fresh bootstrap. A unique, ordered migration series must upgrade the supported integrated LiTT baseline to the same fingerprint. Fail-tolerant replay and blanket grants are rejected. | Recovery plan + A + D |
| Migration filenames | Both lines reuse stems such as `20260812_01`, `20260813_01`, `20260818_01`, `20260819_01`, and `20260820_10/11` for different SQL | Coordinator creates a new collision-free recovery series; no writer copies both directories together or renames migrations independently. | A |
| Browser database writes | Beta permits direct authenticated tenancy writes under RLS; upstream mediates through backend/service role | Target backend-mediated mutations with `requireAuth`, origin/MFA/epoch checks, and RLS as defense in depth. No broad browser write grants. | Canonical security invariants + A |
| Auth transport | Upstream is cookie/session-first and temporarily supports Bearer; Word needs a non-browser bridge | Web uses HttpOnly session cookies. Word uses the one-time auth handoff/current add-in contract. Any Bearer compatibility is restricted to named non-browser clients and cannot become a browser fallback. API key, access token, and refresh token remain distinct. | Recovery plan + A + B + C |
| Account/project deletion | Upstream cleanup deletes audit rows; LiTT audit and AI evidence are append-only | Adopt the cleanup orchestration except evidence deletion. Destructive endpoints fail closed until the retention/erasure ADR defines legal behavior and a privileged out-of-band mechanism, if any. | Canonical TD-008 + A |
| Provider runtime | Upstream uses Vercel AI SDK; Beta has governed provider adapters | Adopt upstream AI SDK/router implementation. Port `ModelRoute`, credential references, pinned chat routes, explicit request-path failure, egress provenance, receipts, and fake interception. Retire duplicate legacy provider adapters. | Recovery plan + B |
| Provider fallback | Some upstream preference paths fallback; LiTT forbids silent fallback for explicit routes | Fallback is permitted only when normalizing a stale saved preference and must be observable. An explicit request or pinned chat route fails closed. | Policy invariant + B |
| Real provider tests | Upstream may conditionally exercise LLM specs with a secret; LiTT requires zero real calls in default CI/local E2E | Default G0–G5 recovery gates use fakes/synthetic credentials only. Any real provider exercise moves to a separately authorized G6 canary and is not inferred from CI. | Upstream policy + release gates + D |
| Workflow source | Beta uses generated `systemWorkflows.ts`; upstream uses a DB-backed catalog | `mike_workflows` is the sole target catalog. Port the MX playbook as governed catalog content and retire the legacy generated registry after parity. | Recovery plan + B |
| CourtListener | Upstream still exposes US legal research/provider entries | Reject the surface and key type from LiTT. It remains absent unless a new jurisdiction-specific design and owner decision are reviewed. | Canonical policy + A + B + D |
| Word architecture | Beta has a legacy tabbed add-in; upstream has a document-scoped taskpane | Adopt upstream taskpane/chat/history/edit-card/Direct–Review architecture. Port only the approved-redline contract and UI integration; retire the Beta shell. | Recovery plan + C |
| Two redline modules | Upstream `redline.ts` parses streamed edits; Beta `redline.ts` validates approved bundles | Keep the upstream stream parser. Port the approved-bundle logic under the explicit new module name `approvedRedline.ts`; no parallel legacy add-in implementation and no ambiguous same-purpose module. | Coordinator architecture decision consistent with C |
| Approved bundle storage | Lane C deferred whether bundle state belongs in Word chat or a dedicated table | `ai_redline_bundles` remains the authoritative evidence store. Word chat/edit tables store interactive model edits only. The add-in fetches an approved bundle by API and never copies authority into Office settings. | LiTT executable invariant + coordinator architecture decision |
| Drive/staging | Fake Drive is part of Beta; real Drive and remote staging are external gates | Preserve fake Drive and local isolated staging. Real Drive, SMTP, remote staging, backup destination, monitoring, and DNS stay separate G6 authorizations. | Release gates + D |

## 5. Shared contracts frozen before writers

The coordinator must materialize these contracts in a compiling RED scaffold before
any writer that consumes them. Names describe the semantic contract; exact exported
TypeScript names are frozen in the coordinator snapshot handed to the writer.

| Contract | Required fields/behavior | Fail-closed rules | Coordinator owner |
| --- | --- | --- | --- |
| Request identity | authenticated `user_id`; transport is web session, one-time Word handoff/session, or explicitly allowed non-browser Bearer; assurance/MFA state | no provider secret in identity; untrusted cookie mutation origin is `403`; browser Bearer fallback prohibited | auth middleware and root auth registration |
| Tenancy scope | `organization_id`, optional `workspace_id`, required private `matter_id` where applicable, membership role, `authorization_epoch` | missing/inactive membership is generic deny/404; private matter needs explicit matter membership plus active org membership; stale epoch blocks mutation | schema, migrations, access/audit boundary |
| Provider route | `provider`, `model`, `credential_ref`; resolved credential source/version held only in memory | explicit/pinned route never silently falls back; disabled/rotated/missing credential returns typed failure; secrets never enter receipts/logs | `llm/types.ts`, `userApiKeys.ts`, chat streaming |
| Credential domains | membership identity; provider API key; OAuth access token; OAuth refresh token | no interchange between domains; refresh tokens encrypted and never stored in `user_api_keys` or chats | auth/provider shared files |
| Workflow identity | `workflow_key`, `version`, `content_hash`, `source_commit`, distribution/type, source and approval provenance | executed receipt pins the exact active hash; catalog edits do not rewrite prior receipts | catalog schema and shared API type |
| Execution provenance | tenant/matter/project/chat/document-version scope; input/output/citation hashes; provider route; workflow identity; status/error class | append-only evidence; actual route, not intended route; receipt sanitizer rejects secret/prompt/content fields except hashes | schema, receipt types, audit |
| Review state | item decision `accepted`, `rejected`, or `edited`; terminal review `approved` or `changes_requested`; reviewer separation and fresh authorization | approval requires no pending item; revoked reviewer cannot write; rejected findings excluded and edited values preserved | evidence schema/API contract |
| Approved redline | bundle id/SHA, review id/revision, source document/version/SHA, action spans and before/after hashes | fresh identity/hash/span revalidation before every write; ambiguity, overlap, supersession, Save-As, or document drift produces no partial write | Word API contract and `approvedRedline.ts` |
| Document/storage ownership | tenant/matter/project/document IDs, version hash, object prefix, download-grant id/expiry/use state | object prefix confinement; single-use/expiry; outsider non-disclosure; deletion waits for retention contract when evidence is implicated | schema/access/API boundary |
| Publication intent | matter folder identity, approved artifact hash, idempotency key, attempt/outcome, provider file id when known | fresh authorization before upload and DB update; unknown outcome reconciled before retry; no real Drive in default tests | Drive publication API/schema boundary |
| Resource cleanup | explicit owner/root labels or IDs, primary error plus cleanup errors, zero-residue assertion | never adopt foreign resources; cleanup cannot mask primary failure; no row-by-row deletion of append-only evidence | aggregate harness contract |

## 6. Coordinator-exclusive files

Writers must not edit these paths. If a slice needs one, it stops and returns an
interface/change request; the coordinator changes it in the integration worktree,
runs the shared RED/GREEN gate, and issues a new exact base.

```text
backend/schema.sql
backend/migrations/**
backend/src/app.ts
backend/src/middleware/auth.ts
backend/src/lib/access.ts
backend/src/lib/audit.ts
backend/src/lib/supabase.ts
backend/src/lib/userApiKeys.ts
backend/src/lib/userDataCleanup.ts
backend/src/lib/llm/types.ts
backend/src/lib/chat/streaming.ts
backend/src/lib/chat/tools/wordClientTools.ts
backend/src/routes/auth.ts
backend/src/routes/user.ts
backend/src/routes/projects.ts
backend/src/routes/documents.ts
backend/src/routes/downloads.ts
backend/scripts/schema-fingerprint.sql
backend/scripts/check-security-invariants.sh
frontend/src/app/lib/mikeApi.ts
frontend/src/app/contexts/AuthContext.tsx
frontend/src/app/contexts/UserProfileContext.tsx
frontend/src/app/contexts/ChatHistoryContext.tsx
frontend/src/app/hooks/useAssistantChat.ts
word-addin/package.json
word-addin/tsconfig.json
word-addin/src/taskpane/api/mikeApi.ts
word-addin/src/taskpane/hooks/useWordDoc.ts
word-addin/src/taskpane/lib/redline.ts
word-addin/src/taskpane/lib/approvedRedline.ts (new)
word-addin/e2e/support/**
.github/workflows/**
package.json
package-lock.json
docker-compose.yml
compose.staging.yml
```

The coordinator also owns every cherry-pick/conflict resolution, aggregate gate,
review snapshot, compatibility-ledger update, and change to this ownership list.

## 7. Compatibility matrix

| Capability | Upstream behavior | LiTT invariant | Disposition | Target architecture | Dependencies | Shared files | Writer ownership | Tests | Migration impact | Blocker/debt | Implementation order |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| Fresh schema and upgrades | Canonical fresh schema plus schema-drift fingerprint workflow | Fresh and supported incremental paths converge; security grants/policies preserved | adopt + port | One consolidated fresh schema and a new collision-free recovery migration series from the integrated LiTT baseline | Beta integration; coordinator scaffold | schema, migrations, fingerprint script | coordinator only | fresh bootstrap; supported upgrade; fingerprint equality; security invariants | high: divergent schemas and duplicate stems | TD-003 | 0 |
| Password/session auth | HttpOnly cookies, trusted-origin checks, session endpoints | MFA default-on and no tenancy bypass | adopt + port | Upstream auth stack with LiTT MFA/tenancy guards | schema/auth contract | middleware, auth/user routes, contexts | Slice A domain services/tests only | login/recovery/session/origin/MFA matrix | user profile/trigger convergence | TD-004 | 1 |
| Google OAuth and Word handoff | OAuth exchange plus single-use handoff tickets | onboarding creates exactly one initial organization with an active `org_owner` membership; no initial workspace/matter; tokens remain distinct | adopt + port | Cookie web flow and one-time Word handoff; idempotent organization provisioning shared by password and OAuth completion; no browser Bearer fallback | resolved owner decision in section 11 | auth schema/routes/client contexts | Slice A tests and non-shared onboarding service | one-use/expiry; OAuth/password cannot bypass MFA/tenancy; retry cannot duplicate tenant | auth tickets, profile triggers and organization membership transaction | none for initial defaults | 1 |
| Organizations/workspaces/matters | Upstream lacks LiTT’s complete private-tenancy model | org/workspace/matter roles, private matters, outsider 404 | port | Backend-mediated tenancy mutations; RLS defense in depth; invitations require an explicitly selected valid role and never infer one | schema scaffold | schema/access/audit/app | Slice A `tenancy.ts`, new domain services/routes excluding shared registration | cross-tenant matrix; private matter; explicit-role invitation/onboarding | new consolidated tables/policies/functions | none for invitation default semantics | 1 |
| Revocation and epochs | Ordinary current-session authorization | revocation effective during long mutations | port | Organization authorization epoch checked before every sensitive write | tenancy model | schema/access/audit | Slice A tenancy/AI access helpers and focused tests | stale epoch and revocation race negatives | epoch columns/functions/triggers | none after interface freeze | 1 |
| RLS and service role | Narrower backend-mediated posture but different grants | no browser bypass; insert-only evidence; least privilege | port + reject broad grants | Per-table grants plus RLS and backend authorization; no blanket post-migration grant | schema convergence | schema/migrations/security script | coordinator; Slice A tests | RLS coverage; service-role route guard; negative DML | substantial grant reconciliation | TD-003/004 | 1 |
| Audit | Mutable upstream audit table | insert-only, scoped, sanitized audit detail | port | One consolidated append-only `audit_events` model and one audit module | tenancy schema | schema/migrations/audit | Slice A callers/tests outside shared module | service-role UPDATE/DELETE denial; scoped detail | incompatible table definitions | retention ADR for erasure | 1 |
| Account/project deletion | Upstream cleanup removes user/project rows and audit | append-only evidence cannot be silently purged | adopt orchestration, defer evidence deletion | Fail-closed destructive API until retention ADR; cleanup non-evidence resources deterministically | retention decision | schema/userDataCleanup/shared routes | later coordinator integration; no writer policy invention | blocked destructive endpoint; retained-evidence matrix | deletion order and privileged path are not implementable before the retention ADR | TD-008 | before E completion |
| Document access/downloads | Folder upload, multi-select, pagination, storage wrappers | matter-private access, hashes, single-use grants | adopt + port | Upstream document UX/storage core behind LiTT tenancy and grant service | Slice A integrated | schema/access/shared project/document routes | Slice B document/storage services, components, tests | prefix confinement; expiry/single-use; conflict/bounded concurrency | grant/table reconciliation | deletion depends on retention | 2 (parallel lane 1) |
| Provider runtime | Vercel AI SDK, routers, streaming, tool batching | governed BYOK and actual-route provenance | adopt + port | Upstream AI SDK adapters with LiTT route resolution before dispatch | Slice A; provider interface scaffold | llm types, keys, chat streaming, schema | Slice C provider adapters, governed route resolver, tests | provider/model matrix; tool streaming; fail-closed errors | user keys/chat route columns | TD-005 | 2 (parallel lane 2) |
| Model selection and fallback | Explicit routers plus observable fallback for stale preferences | explicit/pinned requests never silently fallback | adopt + port | Throw on request-path invalid route; normalize only stale saved preference with warning | provider runtime | shared provider/API types | Slice C router/model modules/tests | retired model; stale preference; explicit invalid route | preference/profile columns | provider support decisions | 2 |
| Credentials | One user key/provider plus env/router keys; OAuth stores tokens separately | multiple versioned `credential_ref`; membership/API/access/refresh separation | port | Encrypted multi-credential store; declared env/user source; rotation invalidates old pin | schema scaffold | schema/userApiKeys/types | Slice C non-shared resolution modules/tests | rotation, disabled key, missing key, no secret leakage | user_api_keys consolidation | BYOK for Vercel/OpenCode decision | 2 |
| Egress/fakes | Provider SDK and model-catalog network paths | explicit allowlist/provenance; default CI makes zero real calls | port | One provider/network choke point; fake interception precedes every SDK fetch; unexpected host aborts | provider runtime | chat streaming/workflows | Slice C provider egress modules/tests | host allowlist; zero-call negative; catalog fetch doubles | none beyond provider schema | allowed real providers deferred to G6 | 2 |
| Workflow catalog | DB-backed versioned catalog, packs, add-ons, quick actions, reference assets | governed content and immutable executed hash | adopt | `mike_workflows` is sole catalog; atomic sync and content-addressed assets | provider interface; catalog schema scaffold | schema/app/API types | Slice D catalog/sync/routes/tests outside shared files | sync idempotence; install/default; asset hash | catalog tables/RPC | none | 3 (parallel lane 1) |
| Civil/Mercantile MX playbook | No LiTT playbook in current catalog | stable id/version/source/approval/hash; R4/R6/R9; no authority overclaim | port | Governed catalog row/content with MX provenance and receipt hash; retire `systemWorkflows.ts` | catalog | schema/API receipt type | Slice D playbook content/loader/tests | hash round-trip; source/version; executed receipt immutability | seed/catalog content | legal validation remains later gate | 3 |
| Web assistant and citations | Current assistant, streaming, history, shared UI | governed route display, verified citations, matter/document scope | adopt + port | Upstream UI shell/hooks with frozen LiTT API/provenance interfaces | Slices A/C/D interfaces | mikeApi, contexts, useAssistantChat | Slice E0 new AI/review UI scaffolding and non-shared components | soft navigation; mid-stream chat switch; late citation frames | none initially | cannot claim parity before E1 | 3 (parallel lane 2 scaffold only) |
| AI executions/receipts/citations | Upstream chat/workflow execution model | append-only pages/outputs/receipts, hashes, actual route/workflow provenance | port | LiTT evidence state machine on upstream provider/catalog contracts | A/C/D integrated; retention decision for destructive paths | schema/audit/API types | Slice E1 AI evidence libs/routes/tests outside shared files | hash/citation integrity; append-only negatives; revocation races | full `ai_*` reconciliation | TD-008 before deletion claims | 4 |
| Human review/approved DOCX | General UI/workflow review surfaces | different reviewer; reject/edit/accept; no pending item on approval | port | LiTT review state machine and approved artifact service on current web UI | execution evidence | schema/API client | Slice E1 review/report services, components, tests | reviewer separation; transitions; approved DOCX content | review/export tables | retention ADR for destructive path only | 4 |
| Word taskpane/chat/history | Document-scoped chat, history, Direct/Review, tracked edit persistence | no cross-document/matter use | adopt | Use upstream add-in wholesale as shell; current Word identity/settings and edit-card UI | frozen auth/provider/workflow APIs | Word API/useWordDoc/stream parser | Slice F taskpane UI/features/tests excluding shared paths | upstream Chromium/WebKit suite; document switch/history | upstream word tables retained | Word host matrix deferred beyond bounded gate | 5 |
| Approved redline apply | Upstream stream-edit parser and tracked edits | reviewed bundle identity, source hash, span revalidation, no partial write | port | Dedicated `approvedRedline.ts` contract plus panel integrated into upstream taskpane; authoritative bundle remains backend evidence | Slice E approved bundle API | schema/Word API/useWordDoc/new module | Slice F panel/UI and E2E; coordinator writes core module/hooks | tamper/scope/source/span/supersession/Save-As/multi-occurrence | bundle tables reconciled | TD-007 | 5 |
| Drive publication | Upstream storage capabilities; no LiTT governed publication journey | approved artifact only; fresh authorization; idempotence/unknown outcome/rehydration | port | Matter-bound publication service and state machine; fake first, real canary later | Slice E/F artifacts | schema/app/shared API | Slice G Drive services/settings UI/tests | fake upload once; retry/unknown outcome; rehydrate; outsider deny | publication tables/retry fields | TD-010 real canary | 6 |
| CI and schema gates | Rich CI, schema drift, stack, mutation, load, Word workflows | LiTT security checks, Beta parity, zero real calls | adopt + port | Coordinator composes workflows after each slice; mutation/load on-demand until parity | all slice contracts | workflows, root manifests, scripts | coordinator only; writers report focused commands | exact-head CI; schema convergence; security; Word; Beta | none | coverage/performance TD-011/12/17 | each integration + Phase 3 |
| Beta parity | Upstream has broader E2E but not LiTT vertical journey | owner/private matter → DOCX → fake AI → review → DOCX/redline → fake Drive → audit/404/cleanup | port as acceptance contract | Adapt the existing Beta journey to recovered architecture; do not preserve legacy internals | Slices A–G | aggregate harness config | coordinator runs; slice writers maintain owned fixtures/spec helpers only | one fake provider call, one fake Drive upload, zero residue/real calls | disposable schema must match candidate | G4 baseline proven at `cc497bb`; parity must be re-proven on the recovered candidate | Phase 3 |
| Staging/recovery/cleanup | Upstream CI/local stack plus load tooling | isolated fresh bootstrap, backup/restore, attributed cleanup | port | LiTT loopback-only staging and recovery harness updated to recovered core; separate restore stack | integrated candidate | compose/workflows/shared scripts | Slice G non-shared services/tests; coordinator composes root files | contract smoke; backup; functional restore; zero residue | fresh-only bootstrap plus supported upgrade proof | TD-009 remote staging later | 6 + G5 |
| Jurisdiction research | Upstream CourtListener US surface | no US source presented as Mexican authority | reject | Surface/routes/tools/tables/key catalog remain absent; future replacement requires new reviewed design | owner jurisdiction decision | schema/provider/catalog shared files | coordinator exclusion tests | absence/security invariant tests | drop/exclusion preserved | owner decision only for replacement | continuous |

## 8. Implementation sequence and concurrency

### Required pre-writer gates

Completed:

1. Exact reviewed Beta candidate integrated through authorized PR #18.
2. Exact-head CI, separately authorized merge, post-merge CI, bounded Beta smoke,
   composed-tree proof, and zero-residue cleanup completed on `cc497bb` / `60aba275`.
3. Exact-tree ledger review `t_15f7252d`, authorized PR #19, exact-head CI 8/8,
   merge `0cafb80` / `e2d87cd2`, and post-merge push workflows 5/5 completed.

Still required before the first writer:

1. Create the coordinator recovery worktree from upstream commit
   `1b58c7aa0520ff185c44698cea1a9e0c96af50ab`.
2. Coordinator creates a compiling RED contract scaffold and the first collision-free
   migration plan. No writer receives a non-compiling base.
3. Freeze the shared contracts and coordinator-exclusive path set in an exact commit.

### Serialized and parallel work

```text
Coordinator scaffold (serial)
  -> Slice A identity/tenancy/auth/schema (serial)
  -> coordinator integration + focused/aggregate gates + exact review
  -> [Slice B documents/storage || Slice C providers/models]
       only after shared schema/config contracts are materialized and paths are disjoint
  -> coordinator integrates B then C sequentially; no merge conflict is auto-resolved
  -> [Slice D workflow catalog/playbook || Slice E0 frontend scaffold]
       only after provider/workflow/evidence API shapes are frozen
  -> coordinator integrates D then E0 sequentially
  -> Slice E1 AI evidence/human review (serial)
  -> Slice F Word/redline (serial)
  -> Slice G Drive/staging/recovery (serial)
  -> Phase 3 aggregate gates and one governing exact-snapshot review
```

Safe writer pairs, conditional on an exact coordinator-issued base and disjoint
ownership:

1. Slice B with Slice C.
2. Slice D with Slice E0 frontend scaffolding only; not with full Slice E evidence
   implementation.

Everything else is serialized. At most two writers run concurrently. Writers never
copy files between worktrees. The coordinator cherry-picks atomic commits one at a
time and treats any conflict as a violated ownership/interface contract.

## 9. Writer slice ownership and acceptance

| Slice | Writer-owned implementation surface | Explicitly prohibited | Focused RED/GREEN acceptance | Handoff |
| --- | --- | --- | --- | --- |
| A — identity/tenancy/auth | tenancy/epoch service modules, new non-shared org/workspace/matter route modules, focused auth/tenancy tests | every coordinator-exclusive file; deletion policy; CourtListener | auth-state matrix, cross-tenant/private 404, revocation race, onboarding membership contract | one clean atomic commit; no push/PR/merge |
| B — documents/storage | document/storage service modules, upload/folder/pagination UI/services, domain tests | schema/migrations, shared access/routes/API client, retention policy | object confinement, single-use grants, conflict policy, bounded concurrency | one clean atomic commit |
| C — providers/models | AI SDK provider adapters, governed route resolver, router/model modules, provider tests | shared types/keys/chat streaming/schema/API client | explicit route fail-closed, key rotation, no-key, actual provenance, fake before egress | one clean atomic commit |
| D — workflow catalog/playbook | catalog source/sync modules, workflow routes outside root registration, MX playbook content/loader, tests | schema/migrations/app/API client/legacy parallel registry | sync idempotence, default/add-on behavior, content hash/source/version, receipt pin contract | one clean atomic commit |
| E — AI evidence/human review | evidence/review/report services and routes outside root registration, new web AI/review components, domain tests | schema/migrations/audit/shared API client/contexts; destructive retention behavior | citation/hash integrity, append-only negatives, revocation, review state machine, approved DOCX | E0 scaffold may parallelize; E1 is serial; one commit per bounded sub-slice |
| F — Word/redline | taskpane panels/components/history/workflow integration and bounded Word E2E | shared Word API/useWordDoc/redline core/package/tsconfig; legacy Beta shell | bundle tamper/scope/source/span, Save-As, no partial writes, upstream Chromium/WebKit suite | one clean atomic commit |
| G — Drive/staging/recovery | Drive publication services/settings, non-shared staging/recovery scripts and tests | schema/app/shared API/root compose/workflows; real external calls | fake idempotence, unknown outcome/reconcile, fresh auth, backup/restore, zero residue | one clean atomic commit; G6 canary excluded |

## 10. Future Kanban writer prompts

These are **templates, not active cards**. Before dispatch, the coordinator must add
an exact identity block containing: integrated LiTT baseline commit/tree, pinned
upstream commit/tree, coordinator recovery-base commit/tree, branch, worktree,
allowed paths, prohibited paths, and current ledger SHA-256. A prompt without that
block is invalid and must not start.

### Slice A — identity, tenancy, auth

```text
Profile: engineer. Implement only Slice A on the exact coordinator-issued recovery
base. Beta must already be integrated and the shared schema/auth/API scaffold must
compile. Read the five canonical control documents and
`docs/UPSTREAM_COMPATIBILITY_LEDGER.md` from the supplied base.

Behavioral goal: make the upstream auth stack preserve LiTT organization/workspace/
matter membership, private-matter 404, MFA, authorization-epoch revocation, and
append-only audit callers. Implement the resolved onboarding contract exactly: create
one initial organization with an active `org_owner` membership, create no workspace or
matter automatically, and require an explicitly selected valid role for every
invitation. Make organization provisioning idempotent across password and OAuth
completion. Add the smallest discriminating RED contracts first, then GREEN
implementation. Do not decide retention, egress, or jurisdiction.

You may edit only the coordinator-issued Slice A allowlist: tenancy/epoch service
modules, new non-shared org/workspace/matter route modules, and focused tests. Never
edit a coordinator-exclusive file. If one is required, stop `blocked` with the exact
interface change; do not patch around it. No unrelated cleanup, network, real
providers, Docker unless the card explicitly names a disposable focused gate, push,
PR, merge, deploy, or new Kanban cards.

Run the exact focused type/lint/tests supplied in the dispatch and leave one clean
atomic local commit only if the card explicitly authorizes that commit. Return base,
HEAD/tree, changed paths, RED/GREEN evidence, real-provider calls=0, cleanup, shared-
file requests, and blockers. Coordinator integrates; writer does not.
```

### Slice B — documents and storage

```text
Profile: engineer. Implement only Slice B from the exact post-Slice-A coordinator
base. Shared tenancy, document API, schema, and storage interfaces are frozen. Read
the canonical documents and compatibility ledger from that base.

Behavioral goal: combine upstream folder upload, conflict policy, multi-select,
pagination, and S3/R2 wrappers with LiTT private matter/project access, content hashes,
object-prefix ownership, and expiring single-use download grants. Begin with RED
contracts for object confinement, outsider non-disclosure, expiry/single use, upload
conflicts, and bounded concurrency; implement only enough GREEN behavior.

Edit only the dispatched document/storage services, components, and focused tests.
Do not edit schema/migrations, shared access, project/document/download routes,
`mikeApi`, root config, or any coordinator-exclusive path. Do not invent deletion or
retention semantics. Stop if the frozen interface is insufficient. No push/PR/merge,
deploy, real external storage, or new cards.

Return one atomic commit receipt when authorized: base, HEAD/tree, paths, focused and
integration results, storage calls/cleanup, shared-interface requests, and blockers.
```

### Slice C — providers and models

```text
Profile: engineer. Implement only Slice C from the exact post-Slice-A coordinator
base, optionally in parallel with Slice B only on the declared disjoint allowlist.
Read the canonical documents and compatibility ledger from the supplied base.

Behavioral goal: use upstream Vercel AI SDK/router/model selection while preserving
LiTT `ModelRoute {provider, model, credential_ref}`, encrypted/versioned BYOK,
pinned chat routes, explicit request-path failure, actual route/provider/model receipt
provenance, and fake interception before every egress. Keep membership, provider API
keys, OAuth access tokens, and refresh tokens separate. Retire duplicate legacy
provider adapters; never add a fallback for an explicit or pinned route.

Edit only provider adapters, governed-route/router/model modules, and focused tests
listed in the dispatch. Shared `llm/types.ts`, `userApiKeys.ts`, chat streaming,
schema/migrations, API client, root manifests, and workflows are coordinator-only.
No network or real provider calls. Stop if a new provider or BYOK policy needs an
owner decision. No push/PR/merge/deploy or child cards.

Return base, HEAD/tree, paths, RED/GREEN results, provider matrix, egress call count
(0 real), cleanup, interface requests, and one atomic commit when authorized.
```

### Slice D — workflow catalog and MX playbook

```text
Profile: engineer. Implement only Slice D on the exact coordinator-issued base after
provider and catalog interfaces are frozen. Read the canonical documents and ledger.

Behavioral goal: adopt the upstream DB-backed workflow catalog, packs, add-ons, quick
actions, reference assets, and atomic sync. Port Civil/Mercantile MX as governed
catalog content with stable key/version, source and approval provenance, immutable
content hash, R4/R6/R9 behavior, and exact executed-workflow hash in receipts. The
catalog is the sole runtime source; do not preserve `systemWorkflows.ts` as a parallel
registry.

Edit only catalog source/sync/domain routes, MX playbook content/loader, and focused
tests named by the dispatch. Schema/migrations, root route registration, shared API
clients/types, receipts, manifests, and CI are coordinator-only. Use no network; mock
catalog sources/assets. Do not make legal-authority claims beyond the frozen content.
No push/PR/merge/deploy or new cards.

Return base, HEAD/tree, paths, RED/GREEN catalog/hash tests, zero real egress, cleanup,
interface requests, blockers, and one atomic commit when authorized.
```

### Slice E — AI evidence and human review

```text
Profile: engineer. Implement Slice E only after Slices A/C/D and their shared
interfaces are integrated. The dispatch will state whether this is E0 frontend
scaffolding or E1 full evidence/review; never combine both implicitly. Read the
canonical documents and ledger from the exact base.

E0 goal: create only new web scaffolding/components against already frozen APIs; it
may parallelize with Slice D on disjoint files. E1 goal: port executions, pages,
outputs, receipts, citations, audit detail, review reject/edit/accept/completion,
approved DOCX, and approved-redline bundle production onto the upstream core.
Preserve actual-route/workflow provenance, append-only guards, reviewer separation,
revocation checks, and no-pending-item approval. Add RED contracts before GREEN.

Edit only the E0 or E1 allowlist in the card. Schema/migrations/audit/root app/shared
`mikeApi`/contexts and destructive cleanup are coordinator-only. Do not implement
account/project evidence deletion until the owner-approved retention ADR exists. No
real AI/Drive, push/PR/merge/deploy, or child cards.

Return exact identity, paths, RED/GREEN and integration results, evidence invariants,
real external calls=0, cleanup, interface requests, blockers, and one atomic commit
per dispatched bounded sub-slice when authorized.
```

### Slice F — Word and approved redline

```text
Profile: engineer. Implement only Slice F from the exact post-Slice-E coordinator
base. Adopt the current upstream document-scoped Word taskpane, chat/history,
Direct/Review, shared edit cards, tracked edits, workflows, and document identity.
Port only the approved-redline UI/integration contract; do not revive the Beta tabbed
add-in or create a second generic redline implementation.

Add RED contracts for bundle/review/document identity, tampering, source/scope/span
drift, Save-As, supersession, multi-occurrence rules, and zero partial writes; then
GREEN panel/taskpane behavior. Edit only the dispatched taskpane components and Word
E2E specs. Word API client, `useWordDoc`, upstream stream parser, coordinator
`approvedRedline.ts`, package/tsconfig, fixtures, schema, and backend registration are
exclusive to the coordinator. No real Word host/network unless a later explicit gate
names it; no push/PR/merge/deploy or new cards.

Return base, HEAD/tree, paths, focused and Chromium/WebKit results, document-identity
boundary, cleanup, interface requests, blockers, and one atomic commit when authorized.
```

### Slice G — Drive, staging, and recovery

```text
Profile: engineer. Implement only Slice G after approved DOCX/redline contracts are
integrated. Read the canonical documents and ledger from the exact base.

Behavioral goal: port approved-artifact publication to a matter-bound Drive folder
with fresh authorization, idempotency, upload verification, unknown-outcome
reconciliation, bounded retry, and published-state rehydration. Update the isolated
local staging/recovery implementation for fresh bootstrap, supported-upgrade
convergence, application-consistent backup, restore into a separate stack, attributed
cleanup, and zero residue. Default tests use fake Drive and synthetic local secrets;
real Drive/remote staging remain G6.

Edit only the Drive services/settings and non-shared staging/recovery scripts/tests in
the dispatch. Schema/migrations/root app/shared API, root Compose, workflows, and
manifests are coordinator-only. Never use production data/credentials or contact real
Google/providers. No push/PR/merge/deploy or child cards.

Return base, HEAD/tree, paths, fake-call counts, staging/restore evidence, cleanup and
zero-residue receipt, interface requests, blockers, and one atomic commit when
authorized.
```

## 11. Product decisions that implementation may not invent

### Resolved for Slice A

On 2026-09-02, Iván fixed the onboarding and invitation contract:

1. Successful onboarding provisions exactly one initial organization and one active
   membership for the authenticated user with role `org_owner`.
2. Onboarding provisions no workspace and no matter implicitly.
3. Password and Google OAuth completion use the same idempotent organization-
   provisioning boundary; retry must not create a second organization or membership.
4. Every invitation requires an explicitly selected role from the applicable closed
   role vocabulary. There is no default invitation role and no fallback grant.

This decision does not authorize retention/erasure behavior, provider egress,
jurisdictional sources, real Shared Drive, or production topology.

### Still pending

| Decision | Needed before | Fail-closed behavior until decided |
| --- | --- | --- |
| Retention/erasure of append-only audit and AI evidence, including storage residues | Any destructive account/project endpoint claimed complete; Slice E closeout | Evidence deletion disabled; endpoint returns a typed blocked/conflict result rather than weakening guards |
| User BYOK support and precedence for Vercel/OpenCode router credentials | Slice C completion for those routers | Unsupported user credential route is unavailable; no env/user silent substitution |
| Which real provider egress routes are supported | G6 canary planning | Default CI/local uses fakes; no real calls |
| Whether and when real Shared Drive becomes supported | G6 | Fake-only publication; no production support claim |
| Production data residency, operator access, and deployment topology | G7 | No production-readiness claim |
| Any Mexican jurisdictional research source replacing CourtListener | Separate reviewed product design | CourtListener and replacement surface remain absent |
| Material upstream UX/legal-review behavior that changes accepted journeys | Before the affected slice is frozen | Preserve executable LiTT invariant or defer the upstream behavior |

## 12. Verification and review lifecycle

For each implemented slice:

1. writer completes one bounded behavior in its own worktree and returns one atomic
   local commit only when authorized;
2. coordinator inspects the real diff and reruns focused verification;
3. coordinator integrates commits sequentially into the recovery worktree and changes
   shared files itself;
4. coordinator runs applicable type, lint, build, schema, integration, security,
   cleanup, and zero-real-call gates;
5. coordinator freezes exact HEAD/tree/paths and dispatches one governing
   Reviewer-profile task via Kanban;
6. timeout, silence, another tree, or incomplete receipt is not PASS;
7. push/PR, merge, G5, G6, and G7 remain separate owner gates.

Phase 4 starts only after the recovered candidate completes Phase 3, receives the
terminal governing review, is integrated, and the permanent cadence in
`UPSTREAM_POLICY.md` is activated.

## 13. Integrated ledger lifecycle

The candidate gate closed as follows:

- exact candidate tree: `e2d87cd2e9712233c3fe409949986e0feee8f083`;
- governing review: `t_15f7252d` PASS with zero P1/P2;
- local commit: `33ea753368c70bf6b6edbe34d2a0f0f8e0c93b60` with the approved tree;
- PR #19 exact-head CI: 8/8 PASS;
- integrated main: `0cafb80c85e8a0e75f7f78df744eb4806b7057d6` with the approved tree;
- post-merge push workflows: 5/5 PASS;
- this separate closeout transition reconciles the five canonical documents only
  after that acceptance, without changing product code or starting writers.

## 14. Security intake 2026-10-21

Upstream `7e3607e765e199f824808e1598cc44b3f99cd690` → `795f96083b6833c6c7b0d58dfa40336b0a335d52`
(439 commits). This intake classifies only the security, access, credential,
storage and schema subset, by static analysis against LiTT (no live database).
The rest stays unclassified, so the stop-the-line threshold remains active and
the pin is unchanged (TD-019). Ports land in `fix/release-candidate-20261021`
with a regression test that fails without the fix.

| Upstream | LiTT finding | Disposition | Candidate change |
| --- | --- | --- | --- |
| #603 `d146998d` `4cc88fa3` `1f831f07`: email-keyed grants, read-only write paths, confirmed email | Vulnerable: grants stayed on the old address; viewers could edit through the assistant; creators kept delete/copy/move rights after a downgrade; review grids exposed rows from unreadable documents; `userEmail` ignored confirmation | port | Migration `20261022_01_recovery_email_change_moves_grants` + schema; `canManageDocument`; per-document edit check; review row filtering; confirmed-email rule |
| `d91a657e` (backend part): export access | Vulnerable: exports selected by `user_id` through the service role | port | Every exported resource re-checked with the route access rules |
| #563 `e38827e4`: workflow metadata tables | Already enforced: RLS and service-role-only grants in schema and `20260905_01` | reject | None (optional `revoke` parity only) |
| #584 `76b09848`: signed download endpoint | Latent: production sets no public endpoint | port | Downloads signed with the browser-reachable client |
| #607 `74985991`: signing client rename | Cosmetic | reject | None |
| #594, `7dc80169`, `57009979` and Next.js advisories | Dependency advisories | adopt | Patched versions; `node-forge` and `braces` allowlisted (dev-only, no patched release) |
| Browser E2E storage (RustFS) | MinIO image no longer pullable | adopt | RustFS pinned by digest + upstream bucket CORS file |
| #463 `7b14ab32`: directory search, workflow share revocation, audit export | Vulnerable (P1 directory search; P2 others) | port | Directory search intersected with `listAccessibleProjectIds`; workflow share revocation answers 404/500 instead of a false 204 and batch overrides are validated first, then written in one upsert; audit export scoped by `listAccessibleProjectIds`. Deferred: chat document context by creator (fail-closed, P3) and the account-deletion/admin-promotion paths (not conclusive) |
| #452 `72f2579d`: private memory from shared chats | Vulnerable (P1) | port | Migration `20261022_02_recovery_memory_private_chat_boundary` + schema and curator mirror: app memory learns only from the actor's own conversation, outside any organization, without direct grants, and inside a private project. Memory already learned is not purged (TD-008) |
| #434 `ada0326c`: full URLs in error logs | Vulnerable (P2) | port | `safeRequestPath` drops the query/fragment and masks `/download/<token>` in internal-error logs |
| #520 `9de02492`: generic MCP OAuth client fallback | Vulnerable (P2) | port | Generic `MCP_OAUTH_CLIENT_ID/_SECRET` fallback removed (unknown hosts use dynamic client registration); Google/Slack require client id and secret |
| #649 `49e0d399`: workspace limits in the workflow store | Vulnerable (P2): shares resolved by email without organization | defer | Needs the owner to define "workspace" in LiTT; next review 2026-11-04 |
| #609/#614: migration ledger and lock | Absent | defer | Reconcile with the LiTT recovery upgrade path in the next sync plan |
| #295: backend modularization | Absent | defer | Dedicated batch (TD-022) |
| #483, #499, #529, #613/#608, #645, #403, #569, #558, #532 | Partial, absent or not conclusive; no bypass found | defer | Next sync plan; #645 needs RLS/retention review first |
| #630 personal organizations; #450/#682 Sentry | Conflicts with the LiTT access model and invariant 11 | reject | Remove any telemetry default if a later sync brings it |
| #673, #683, #661, #669, #671, #653 | Features absent in LiTT | reject | Reassess if those features are adopted |

`GOTRUE_MAILER_AUTOCONFIRM=true` (all stacks, production included) keeps the
confirmed-email rule inert until mail confirmation exists (TD-020).

The candidate's independent review extended the #603 tabular boundary past
upstream. Exports (tabular reviews, account and the queued `export.build` job)
keep only cells whose source rows are readable today. Tabular review chat
messages record their source documents
(`20261022_03_recovery_tabular_chat_source_provenance`): a reader receives a
message, and a chat title, only with current access to every source, checked
against the complete chat (paginated with an exact count, fail-closed). Messages
written before provenance existed stay withheld (TD-023).

LiTT-owned migrations keep the `_recovery_` tag on stems upstream has not used
(upstream already ships `20261021_01`–`04`) and are registered in
`SUPPORTED_RECOVERY_MIGRATION_ORDER` and `KNOWN_SUPPORTED_MIGRATIONS`: the
Schema drift runtime suites rebuild the upgraded database only from that
series. On 2026-10-22 both suites passed 14/14 against PostgreSQL 16.14 (local
instance; Docker replaced by a test shim) and failed 3/14 on the previous
commit without the registration.

## 15. Full intake 2026-10-23

Intake from `7e3607e765e199f824808e1598cc44b3f99cd690` to
`e7ab6bd46cb4b3c22f150e184080d29c941df5c0`: 442 commits, 367 without merges,
2,012 paths. All 367 commits are classified exactly once (backend 118, frontend
172, Word/CI/other 77). The §14 security subset keeps its rows.

The sync follows strategy B of [`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md):
upstream becomes the base, the LiTT delta is reapplied in reviewed slices, the
rejected capabilities of §4.2 of the plan are reverted, and a merge commit
restores shared history. The per-slice receipt, with exact snapshots, trees
and Reviewer cards, is §17.

| Slice | State | LiTT tree | Reviewer |
| --- | --- | --- | --- |
| S1 migrations and schema | landed on the sync branch | `7d66e67b` | `t_c515b92e` PASS |
| S2 tenancy and access | landed on the sync branch | `d1639a07` | `t_0f4ad497` PASS |
| S3 backend LiTT delta | landed on the sync branch | `451897c5` | `t_f79a7b96` PASS |
| S4 frontend LiTT delta | landed on the sync branch | `3604ac5e` | `t_99c299c9` PASS |
| S5 Word add-in | landed on the sync branch (reviewed with S6) | `9be56c8c` | `t_87e481c3` PASS |
| S6 CI and e2e | landed on the sync branch (reviewed with S5) | `9be56c8c` | `t_87e481c3` PASS |
| S7 reverts | landed on the sync branch | `15923538` | `t_48cf81dd` PASS |
| S8 documentation and merge | S8a (deployment package and documents) in review; S8b (`AGENTS.md`, merge commit) pending | | |

## 16. Compatibility matrix for the 2026-10-23 sync

This matrix governs slices S2–S7 of
[`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md). It plays the role that §4 and
§7 played in the August–September recovery: one row per capability present in
LiTT, upstream or both, with the side that wins when they collide. The §4 and
§7 resolutions stay in force unless a row below says that upstream changed the
capability.

Inputs: upstream `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` and the LiTT tag
`pre-sync-20261023` (`e3672b5954d2d3f8348fdbf2dcbe034a2725df4f`), read with
`git show <ref>:<path>`. Upstream has moved on since the intake (its `main`
was `18035cf6` when this matrix was written); those commits belong to the next
intake, not to this sync.

### 16.1 How to read the dispositions

The 72 capability groups of the intake (backend `G01`–`G25`, web `FR-01`–`FR-20`
and `§14-A`–`§14-G`, Word, CI and other `other-01`–`other-20`) were classified
while strategy A (port upstream into LiTT) was still open, so many of them say
`defer` because porting was expensive. Under strategy B every upstream
capability arrives with the base. The matrix therefore re-expresses each group
with one of five dispositions:

| Disposition | Meaning under strategy B |
| --- | --- |
| adopt | The upstream behavior stays as it arrives; at most LiTT branding or wiring is reapplied |
| port | LiTT-only behavior (no upstream counterpart) is reapplied on the upstream layout |
| combine | Upstream mechanism plus LiTT policy; the column "Target architecture" names which part wins |
| gate | The code arrives but stays disabled until the named checks pass and, where stated, the owner decides |
| reject | The capability is reverted or emptied in the slice named (the content reverts of §4.2 of the plan) |

The column holds exactly one of these five values. When a `combine` row
inherits a winner from §4 or §7, or when one side's part is only reapplied
LiTT code, the "Target architecture" column names which part wins.

### 16.2 Corrections to the proposed resolutions

The twelve resolutions proposed for this matrix were checked against both
trees. Seven hold as written (tenancy, audit, Word, chat, migrations, CI and
the reject list). Four needed a correction, recorded here with the evidence.
The provider resolution was replaced by an owner decision of 2026-10-23
(item 1):

1. **Providers (owner decision, 2026-10-23).** The proposed resolution kept
   every provider outside six approved families hidden. The owner decided
   instead that the providers upstream adds are enabled and visible: Google
   Vertex AI, Azure OpenAI, Azure AI Foundry, Amazon Bedrock, xAI, Mistral,
   the user's own OpenAI-compatible endpoint (`custom`) and the
   operator-declared `openai-compatible` endpoints. They sit next to the
   providers LiTT already has: OpenAI, Anthropic, Gemini, OpenRouter, the
   Vercel AI Gateway, OpenCode Go and Ollama. The upstream `Provider` union has
   15 values; LiTT's has 7 (`backend/src/lib/llm/types.ts`, both refs).
   Governed BYOK still applies to every one of them: provider + model +
   credential is chosen when the conversation is created and pinned on it,
   there is no silent fallback, and every call writes egress provenance. Two
   facts from the code shape the target. First, neither side has a direct
   DeepSeek adapter or an OpenCode Zen route: DeepSeek models are reachable
   only as `opencode-go` or OpenRouter models (`backend/src/lib/llm/models.ts`)
   and the only OpenCode base URL is `https://opencode.ai/zen/go/v1`; they
   become fixed-host entries on the shared OpenAI-compatible adapter. Second,
   only part of upstream's egress to configurable addresses is guarded. In
   `e7ab6bd4:backend/src/lib/llm/providers.ts`, `custom` goes through
   `customEndpointFetch` → `guardedFetch` (lines 427–467), which validates
   every redirect hop like the MCP client, but `createConfiguredAdapter` for
   `openai-compatible` passes `aiSdkFetch` directly (lines 491–517), with no
   address check. Azure endpoints are limited to Azure host names
   (`modules/user/user.apiKeys.ts`) and Bedrock and Vertex derive their host
   from a region or location. The owner's condition applies to a base URL
   configured by a user: it can never reach loopback, private ranges,
   link-local or cloud-metadata addresses, checked on every hop. Only `custom`
   has such a URL: it is saved with the user's key settings
   (`modules/user/user.apiKeyStore.ts`). Target: `custom` keeps going through
   `guardedFetch` on every hop, with a RED test. `openai-compatible` is not a
   user endpoint: its `baseUrl` is declared by the operator in
   `MIKE_MODEL_CONFIG_JSON` (`backend/src/lib/llm/registry.ts:26`, read by
   `createConfiguredAdapter`, `providers.ts:479–517`), no user-facing field
   accepts it (`ProviderSettings` in `lib/llm/types.ts` has
   `custom: { baseUrl }` and no `openai-compatible` entry), and it may
   legitimately point at an internal or local
   inference server. Target for it: the address stays operator-only, with a
   RED test that no user request or saved setting can set or change it, and
   every call writes egress provenance with the declared host. Guarding
   operator endpoints as well would need an explicit owner decision; it is not
   part of the condition of 2026-10-23. Ollama follows the same operator-only
   rule as both sides have it today: its address comes only from the
   deployment environment (`OLLAMA_BASE_URL`, default
   `http://localhost:11434/v1`), never from a user, and its models are listed
   only when that server answers (`GET /models/ollama`).
2. **Playbooks.** Upstream playbooks are not a second system catalog: they are
   user- or organization-authored rule sets in their own `playbooks` table with
   no version or content hash (only the user's source file:
   `source_filename`, `source_storage_key`, `import_model`), and upstream
   seeds none. Correction:
   `mike_workflows` stays the only seeded, governed catalog and the Mexican
   Civil/Mercantile playbook stays there; the `playbooks` table may hold only
   user-authored content. `playbook_runs` records only `model`, so runs must
   pin the full route and write evidence, and the import step (`import_model`)
   is model egress that needs the same provenance.
3. **DOCX editor.** The license question is answered by the lockfile:
   `@docx-editor.dev/core`, `react` and `i18n` 2.31.0 are Apache-2.0 and
   `fonts` is Apache-2.0 AND OFL-1.1 AND the GUST font license, all compatible
   with AGPL-3.0-only. What remains open is the version contract: upstream
   autosave replaces the file of the current version
   (`useDocxAutosave` → `replaceDocumentVersionFile`, upload purpose
   `document_version_replace` with an expected SHA-256). The same purpose
   already exists in LiTT. The gate therefore requires that no version
   referenced by an AI execution, review or approved artifact is ever replaced;
   if that cannot be proven, editor saves create a new version instead.
4. **Account deletion.** Organization deletion is already an explicit 405 in
   LiTT, but account deletion is not fail-closed: `DELETE /user/account` runs the
   upstream-style cleanup (`backend/src/lib/userDataCleanup.ts`), which deletes
   `audit_events` by a `user_id` column that LiTT's insert-only table does not
   have. The deletions run concurrently (`Promise.all`), so on a real database
   other rows are already gone when the audit delete fails: a partial erasure
   followed by a 500. Neither test sees it: the unit test
   (`backend/src/lib/__tests__/userDataCleanup.test.ts`) models an
   `audit_events.user_id` column and checks the delete, and the integration
   test (`backend/src/__tests__/integration/user.routes.test.ts`) mocks
   `deleteUserAccountData` and expects 204.
   Correction: account deletion, and any other path that would erase evidence,
   refuses before its first mutation until TD-008 is implemented.
   Resolved for account deletion on 2026-10-24 by the owner's decision
   (migration `20261024_51_litt_account_erasure`): the cleanup is now a
   resumable job that never deletes audit or AI evidence; those rows keep the
   account id and show "Deleted user".
5. **Drive.** Group `G24` was classified as a whole reject, but upstream #691
   adds a useful switch: `GOOGLE_WORKSPACE_DISABLED_PROVIDERS` now accepts
   `google-drive`, after which OAuth start and the Picker answer 404 and the
   assistant gets no Drive tools. Correction: the switch is kept, with Drive
   disabled by default; only the CourtListener half of #691 is reverted.

Two findings from the tenancy analysis are also binding here: LiTT has no
`WorkspaceContext` today (the `FR-09` rationale was wrong), and LiTT enforces
private-matter denial only in TypeScript, never in the SQL mirror of project
access, which S2 must close.

### 16.3 Matrix

| Capability | Upstream behavior (e7ab6bd4) | LiTT behavior / invariant | Disposition | Target architecture | Slice | Shared/conflict files | Tests protecting it | Upstream groups |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Backend layout and dead-code cleanup | #295 moves routes into `backend/src/modules/<domain>/` (19 modules) with `architecture.test.ts` (no `src/routes/`, `lib/` may not import `modules/`); later commits delete routes, aliases and helpers without upstream callers | Flat `routes/` + `lib/`; LiTT-only routers (`aiRecovery.ts`, `matterSettings.ts`, upload sessions) and `lib/recovery/**` | adopt | Upstream layout and architecture test become binding. LiTT routers become modules (`modules/ai-recovery`, `modules/matters`). An endpoint removed by the cleanup is restored only where a LiTT client still calls it, with a route-contract test. | S3 | 11 route files split into 24–28 module files (`tabular`, `user`, `projects`, `workflows`, `documents`, `chat`, `projectChat`, `dbq/handlers`, `quickActions`, `orgs`, `downloads`); `backend/src/app.ts` | `backend/src/__tests__/architecture.test.ts`; route integration suites under `backend/src/__tests__/integration/` | G02, G18 |
| Migrations, schema and ledger | 160 migrations; `schema_migrations` ledger with `backend/scripts/migrate.sh` (advisory lock, transaction by default); clean-install reordering of `schema.sql` | `schema.sql` plus 22 `_recovery_` migrations ordered by hand (`SUPPORTED_RECOVERY_MIGRATION_ORDER`, `KNOWN_SUPPORTED_MIGRATIONS`); fresh and upgraded databases converge | adopt | Upstream runner and ledger are the only mechanism. The 10 LiTT re-issues of upstream migrations are dropped; the 12 LiTT-owned migrations are renumbered after `20261021_04`; `schema.sql` is regenerated with the ledger seeded; the custom ordering is retired. | S1 | `backend/schema.sql`, `backend/migrations/**`, `backend/src/lib/recovery/migrationOrder.ts`, `.github/workflows/schema-drift.yml` | `backend/src/__tests__/migrationLedger.test.ts`; Schema drift fresh-versus-upgraded fingerprint | G23, other-12 |
| Organizations, workspaces and matters | Two levels: `organizations` + `org_members` (`owner`, `admin`, `member`, no status) and content `org_id`; "workspace" is a list filter; personal organizations (`kind='personal'`); owners and admins can list and open private content (`org_private_content_access`); "ownerless" takeover; creator always owner | Organization → workspace → matter → project; 5/4/4 closed roles with `active`, `inactive`, `revoked`; private matter needs explicit matter membership, creator included; owners and admins get no standing; outsiders get a generic 404; onboarding creates one organization and no personal organization | combine | LiTT policy on upstream tables: `org_members` gains `status` and the epoch; `workspaces`, `workspace_memberships` (decision D1 option b), `matters` (1:1 `project_id` UNIQUE) and `matter_memberships` are re-added. The matter gate runs before the creator branch in `resolveOrgContentRole` and in SQL `project_access_role` and `project_access_scope`. `can_access_private_content` never true, private-content routes absent, ownerless resolves false, personal organizations not provisioned, upstream roles remapped to least privilege. `GET /orgs/:id/resources` answers 405 (C5). Upstream workspace UI (one active workspace, selector, invitations, departed members) is mounted on LiTT workspaces. | S2 (backend), S4 (UI) | `backend/src/lib/access.ts`, `backend/src/lib/orgs.ts`, `backend/src/modules/orgs/orgs.routes.ts`, `backend/schema.sql`, `frontend/src/app/contexts/WorkspaceContext.tsx`, `AppSidebar.tsx` | `backend/src/lib/__tests__/access.test.ts` (creator without membership denied, listing excludes); `recoveryTenancy.migration.test.ts`; `recoveryTenancy.runtime.test.ts`; `orgs.routes.test.ts` (both 405s); new RED: an organization owner gets 404 on another team's private matter in every listing | G20, FR-09 |
| Organization sharing and access labels | Content `visibility` `private` or `organization` (organization gives `editor` to every member); Public/Private column, access pill, "Organisational Access"; sharing with named people; document text search and History per workspace (#645) | No membership-inherited content role; sharing by grant or override only; private matters never inherited | combine | Labels and sharing apply only to projects and workflows outside a private matter. A private matter never offers or honors `organization` visibility, owner rows or public pills. Grants by email keep the confirmed-email rule. | S2, S4 | `NewProjectModal.tsx`, `ProjectWorkspace.tsx`, `ProjectsOverview.tsx`, `NewWorkflowModal.tsx`, `shared/types.ts`, `mikeApi.ts` | `access.test.ts` ("does not inherit any content role from membership alone"); `NewWorkflowModal.test.tsx`; new RED: organization visibility refused on a private matter | FR-11, §14-F |
| Access fixes already ported in §14 | Email grants follow address changes; read-only paths cannot write; directory search, workflow-share revocation and audit export scoped; `filterAccessibleDocumentIds` chunked with per-container cache; review cells preserved | Same fixes ported, plus LiTT extensions: exports keep only cells from readable rows; tabular chat messages carry source provenance (`20261022_03`) | combine | Upstream originals arrive with the base; LiTT re-issue migrations are dropped (S1); LiTT extensions (export filtering, tabular chat provenance, TD-023 withholding) are reapplied on the modules. | S2, S3 | `backend/src/lib/access.ts`, `modules/tabular/**`, `modules/projects/**`, `lib/auditExport.ts` | `emailChangeMovesGrants.migration.test.ts`; `canManageDocument.test.ts`; `tabular.routes.test.ts`; `auditExport.test.ts`; `projects.directorySearch.routes.test.ts` | G17, G25, §14-A |
| Private memory boundary | #452: memory learns only from the actor's own conversation; memory files gain `org_id` | Same boundary ported (`20261022_02`) plus `scope` | adopt | Upstream original kept; LiTT re-issue dropped (S1). Memory inside a private matter follows the matter gate. | S1, S2 | `backend/src/lib/memory/**`, `backend/schema.sql` | `memoryPrivateChatBoundary.migration.test.ts`; `memory.routes.test.ts` | G05 |
| Audit | Mutable `audit_events` (uuid, `user_id`, `action`, `detail`); `audit_event_org` rewrites attribution on insert or update; organization activity log with actor filter, pagination and display names; audited access to private content; recoverable deletion and purge | Insert-only `audit_events` (bigint, `actor_user_id`, `event_type`, `event_detail`) with `audit_events_insert_only`; attributed `organization_id`; AI evidence insert-only | combine | As implemented in S1–S2: upstream's `audit_events` shape stays (uuid `id`, `user_id`, `org_id`, `action`, `detail`), so every upstream writer keeps working, and LiTT's insert-only guarantee wins: `audit_events_insert_only` rejects every UPDATE and DELETE (`20261023_11_litt_append_only_audit`) and `audit_event_org` fills `org_id` on insert only. `recordAudit` carries `orgId`. Upstream activity log, actor filter, pagination and display names are adopted on top. Private-content access logging, recoverable deletion and purge are not adopted (C2, C3). The earlier target (LiTT's bigint table with `actor_user_id`, `event_type`, `event_detail`) was not adopted. | S2 (backend), S4 (UI) | `backend/src/lib/audit.ts`, `modules/audit/**`, `lib/auditExport.ts`, `backend/schema.sql`, `(pages)/history/page.tsx` | `backend/src/__tests__/auditInsertOnly.test.ts` (UPDATE and DELETE on `audit_events` raise on the converged schema); `audit.test.ts`; `auditExport.test.ts`; `appendOnlyEvidence.test.ts` | G21, FR-12 |
| Account and organization deletion, member departure | Organization soft delete and purge after 30 days; offboarding with departure archives; account cleanup deletes audit rows; `chats.user_id` set null so organization content survives its author | Organization deletion 405; account deletion runs a cleanup that fails part-way against the insert-only audit (§16.2 item 4) | combine | Every destructive path that touches evidence refuses before its first mutation until TD-008: `DELETE /orgs/:id` 405, account deletion refused with an intentional message (superseded on 2026-10-24: account erasure per the owner's TD-008 decision keeps audit, AI evidence and matter content), no purge job. Member departure keeps content with the organization (upstream detach semantics) and bumps the authorization epoch; it never deletes evidence. | S2 | `backend/src/lib/userDataCleanup.ts`, `modules/user/user.account.ts`, `modules/orgs/**`, `backend/schema.sql` | `orgs.routes.test.ts` ("unsupported organization endpoints"); `user.routes.test.ts` (account deletion, rewritten to the refusal); new RED: account deletion leaves every row untouched | G20, G21 |
| Authorization epochs and revocation | None; revocation deletes the `org_members` row | `organizations.authorization_epoch`, bump triggers, `ai_assert_active_matter_access` with `for update`; stale epochs fail sessions and jobs | port | Epoch column and bump triggers on `org_members` (insert, update, delete) and `matter_memberships`; fresh revalidation before sensitive writes and before claiming queued jobs (C4). | S2 | `backend/schema.sql`, tenancy read port, `evaluateAccess.ts` | `tenancyModel.test.ts`; `recoveryTenancy.migration.test.ts`; new RED: a job queued before revocation fails on claim | — |
| Sign-in, MFA and identity | #529 reworks sign-in messages and recovery; `requireMfaIfEnrolled`; the profile read returns true on a missing column | MFA default-on; `mfa_satisfied` in the request identity; profile read fails closed; Bearer only for named non-browser clients | combine | Upstream flows and messages; LiTT `middleware/auth.ts` variant wins on MFA, fail-closed profile read and the Bearer allowlist; one initial organization at onboarding. | S2 | `backend/src/middleware/auth.ts`, `frontend/src/app/login/**`, `verify-mfa/page.tsx`, `AuthContext.tsx` | `authStateMatrix.test.ts`; `AuthContext.test.tsx`; `authApi.test.ts`; `authRedirects.test.ts` | §14-D |
| Provider runtime | Tool-call recovery, `read_document` loop cut, provider access and quota explanations, chunk timeouts and per-provider deadlines, reasoning replay for opt-in models, provider-chosen output limit unless `LLM_MAX_OUTPUT_TOKENS` | Governed route resolved before dispatch; explicit and pinned routes fail closed; egress provenance and receipts; fake interception in tests | combine | Upstream runtime as is; LiTT route resolution, typed failures and receipt writing reapplied in front of it. The operator's explicit output limit wins; reasoning is replayed only for models that declare it. | S3 | `backend/src/lib/llm/aiSdk.ts`, `providers.ts`, `types.ts`, `modules/chat/engine/**` | `chat.routes.test.ts`; `tabular.routes.test.ts`; `llmModels.test.ts`; `providerDeadlines.test.ts`; `providerErrors.test.ts` | G06, G14 |
| Provider catalog, credentials and model selection | Model registry and provider matrix; masked saved keys; personal key overrides; Vertex, Azure, Azure Foundry, Bedrock, xAI, Mistral, custom and OpenAI-compatible endpoints (`custom` guarded per hop, `openai-compatible` not); organization keys and router models (`org_api_keys`, `org_router_models`); `chats` without `credential_ref` or `model_provider` | Seven providers (OpenAI, Anthropic, Gemini, OpenRouter, Vercel AI Gateway, OpenCode Go with DeepSeek models, operator-run Ollama); route = provider + model + versioned `credential_ref`, fixed on the conversation; no silent fallback | combine | Upstream registry, matrix and masked-key UI, with every upstream provider visible (owner decision of 2026-10-23, §16.2 item 1): Vertex, Azure OpenAI, Azure AI Foundry, Bedrock, xAI, Mistral, Vercel, OpenCode Go, the user's own endpoint (`custom`) and the operator-declared `openai-compatible`, next to OpenAI, Anthropic, Gemini, OpenRouter and the operator-run Ollama that LiTT already has. `chats.credential_ref` and `chats.model_provider` restored and used by routing (S3 acceptance), for every provider. DeepSeek and OpenCode Zen are added as fixed-host entries on the OpenAI-compatible adapter. `custom`, the only provider whose base URL a user configures, sends every request through `guardedFetch`, which refuses loopback, private, link-local and cloud-metadata addresses on every hop. `openai-compatible` and Ollama keep operator-only addresses (`MIKE_MODEL_CONFIG_JSON`, `OLLAMA_BASE_URL`) that may be internal; no user field can set or change them, and their calls write egress provenance with the declared host. Organization keys are selectable only as an explicit institutional credential with its own `credential_ref`, never resolved implicitly. | S3 (backend), S4 (UI) | `backend/src/lib/llm/**`, `modules/user/user.apiKeyStore.ts`, `backend/schema.sql`, `(pages)/settings/byok/page.tsx`, `(pages)/settings/models/page.tsx`, `ModelToggle.tsx`, `RouterSettingsSection.tsx` | `user.apiKeyStore.test.ts`; `providers.byok.test.ts`; `modelSelection.test.ts`; `UserProfileContext.test.tsx`; `modelAvailability.test.ts`; `lib/mcp/__tests__/client.ssrf.test.ts`; `lib/__tests__/privateIp.test.ts`; new RED: a `custom` base URL that resolves, directly or after a redirect, to `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254` or `::1` is refused before any request leaves; new RED: no user request or saved setting can set or change the `baseUrl` of an `openai-compatible` model; a pinned chat never changes route | G19, FR-16, §14-E |
| Chat turns, server runs and two chats | Answers are server-owned runs (`streamRuns.ts`, `assistantTurnRuns.ts`) that survive refresh and resume by sequence number; explicit Stop; inactivity deadline; per-turn retry with mapped errors; second chat side by side and side panel; streaming render fixes; project-chat IDE workspace | Own `lib/chat/streaming.ts` + `sseHeartbeat.ts`; matter- and document-scoped assistant; errors pass through `userFacingError` | adopt | Upstream runs, retry, two chats and side panel. A run carries the conversation's pinned route and writes the same receipts as a direct stream; retry never changes the route. LiTT matter scoping and error mapping reapplied on the upstream components. | S3 (backend), S4 (web), S5 (Word) | `modules/chat/**`, `modules/project-chat/**`, `useAssistantChat.ts`, `ChatHistoryContext.tsx`, `ChatView.tsx`, `AssistantSidePanel.tsx`, `word-addin/src/taskpane/App.tsx` | `chat.routes.test.ts`; `projectChat.routes.test.ts`; `wordChat.routes.test.ts`; `useAssistantChat.sse.test.ts`; `userFacingError.test.ts`; `AssistantSidePanel.test.ts` | G12, FR-01, FR-03, other-20, §14-B |
| Answer rendering and citations | Passage selection and quoting shared by web and Word; copyable text cards; subagent pills; uploaded documents as pills; PDF citation highlights; citation document order with page breaks | Verified citations resolve to document, version, span and hash | combine | Upstream rendering; LiTT citation verification and provenance stay authoritative for "verified" marks. | S4 | `AssistantMessage.tsx`, `message/EventBlocks.tsx`, `CitationQuotesSection.tsx`, `frontend/src/shared/ui/**` | `CitationSources.test.tsx`; `CitationQuotesSection.test.tsx`; `PdfView.test.ts`; `citations.test.ts` | FR-02, §14-C, G06 |
| Web search and subagents in chat | Provider-native web search per user (`user_profiles.web_search`); delegation to subagents with their own `subagent_model` | Not present; every model call follows the pinned route with recorded egress | gate | Web search stays off (`LITT_CHAT_WEB_SEARCH`): it sends the query to the provider's search service and needs its own owner decision. Subagents are on (`LITT_CHAT_SUBAGENTS=enabled`, owner decision 2026-10-30): they run on named model routes each user configures in Settings > Subagents (`user_profiles.subagent_routes`, at most 8, with an optional default), modelled on the `model_map` mode of the Hermes advanced-delegation plugin. The assistant sees only route names and descriptions as an enum; without routes a subagent runs on the conversation's model. A route is checked like a chat's model (key, organization policy) and its egress recorded before it runs; one that cannot run fails closed, never on another model. The delegation event names the route, provider, model and reasoning. Upstream's `subagent_model`/`subagent_reasoning` columns are kept but not used or shown by LiTT. | S3 | `modules/chat/engine/**`, `lib/subagentRoutes.ts`, `modules/user/user.subagentRoutes.ts`, `user.chatRoute.ts` (`subagentRouteGovernor`), `backend/schema.sql` (`chat_subagent_runs`, `subagent_routes`), `SubagentRoutesSection.tsx` | `chatFeatureGates.test.ts`; `streamingDelegation.test.ts` (route enum, default, unknown route, fail closed, continuation); `subagentRoutes.test.ts`; `user.chatRoute.test.ts`; `SubagentRoutesSection.test.tsx`; `SubagentGroup.test.tsx` | G15 |
| Documents, uploads and storage | Visual-layout PDF extraction, AcroForm values, `textless_page_count` per version with a warning; startup names the missing switch and exits if it cannot bind; storage deletion reported once, only NoSuchKey counts as gone; storage adapter seam; signed downloads with the browser-reachable client; per-file upload results; document text search | Matter-private access, version hashes, single-use download grants, upload quarantine | combine | Upstream document and storage core; LiTT tenancy, grants and hashes reapplied. The textless warning is additive and leaves version hashes unchanged. | S3 (backend), S4 (UI) | `modules/documents/**`, `modules/uploads/**`, `backend/src/lib/storage.ts`, `DocTable.tsx`, `NewTRModal.tsx` | `documentVersions.test.ts`; `uploadProcessing.test.ts`; `storage.test.ts`; `storageSignedDownload.test.ts`; `documentUploadValidation.test.ts`; `workerEntrypoint.test.ts` (LiTT variant kept) | G03, G10, G16, FR-13, §14-F |
| DOCX viewer and editor | `@docx-editor.dev` 2.31.0 replaces `docx-preview`: toolbar, read and edit modes, comments, autosave that replaces the current version file | `docx-preview` viewer; versions hashed and referenced by evidence; approval is human and recorded | gate | Viewer adopted. Editing and autosave stay off until: no network fetch by the editor at runtime (fonts self-hosted), and no replacement of a version referenced by an AI execution, review or approved artifact (otherwise saves create a new version). An editor save never produces an approved version. | S4 (behind the gate), check before the S8 merge | `frontend/package.json`, `DocxView.tsx`, `useDocxAutosave.ts`, `DocPanel.tsx`, `uploads.processing.ts` | `PdfView.test.ts`; `DocPanel.test.tsx`; new RED: replacing a version referenced by evidence is refused | FR-04 |
| Workflow catalog, add-ons and playbooks | DB-backed `mike_workflows` with packs and add-ons (assets loaded in one batch); workflow metadata service-role only; playbooks: user-authored rule sets with editor, sources, import from a file by a model, runs, history, sharing and organization overrides | `mike_workflows` is the sole governed catalog with key, version, source commit, content hash and approval provenance; Mexican Civil/Mercantile playbook stored there (TD-006) | combine | Upstream playbook UI and runs adopted. `playbooks` holds only user-authored content and nothing is seeded there; governed content, the Mexican playbook included, stays in `mike_workflows`. A playbook run pins provider, model and `credential_ref` and writes evidence; playbook import records its model egress; playbook sharing and overrides pass the matter gate. | S3 (backend), S4 (UI) | `modules/workflows/**`, `modules/playbooks/**`, `backend/schema.sql`, `(pages)/playbooks/**`, `WorkflowPickerContent.tsx` | `governedWorkflowCatalog.test.ts`; `mxCivilCommercialPlaybook.test.ts`; `workflowCatalogSync.test.ts`; `workflowAddons.routes.test.ts`; new RED: no system row in `playbooks`; a playbook run without a pinned route is refused | G11, G15, FR-17 |
| Template library | Preset contract templates (`presetTemplates.json`: US forms such as Bonterms and Common Paper) shown as a document table | No US content presented as a base for Mexican practice | reject | Library mechanism kept, preset catalog shipped empty until a reviewed Mexican set with provenance exists. | S7 | `frontend/src/app/components/library/presetTemplates.json`, `LibraryWorkspace.tsx` | new RED: the shipped preset catalog is empty | FR-05 |
| AI evidence, human review and approved artifacts | None | Append-only `ai_*` evidence, reviewer separation, approved DOCX and redline bundles, receipts with hashes | port | Reapplied unchanged as modules on the upstream layout, with the matter gate and epochs from S2. | S3 | `aiRecovery.ts` → `modules/ai-recovery/**`, `backend/schema.sql` | `appendOnlyEvidence.test.ts`; `ai*` route tests under `backend/src/routes/__tests__/` | — |
| Connectors, MCP and Google Workspace | Unified connector management; write approvals before external mutations; OAuth hardening (no generic client); redirects revalidated per hop for SSRF; Gmail (`gmail.readonly` + `gmail.compose`) and Calendar with inline approvals, legacy `gmail.modify` and full Drive accepted as implied; Drive with `drive.file` and Picker; Drive switch-off; suggested third-party connectors (Lawve) | MCP egress through one choke point; no third party suggested by default; Drive publication fail-closed | combine | Upstream mechanism, approvals and SSRF checks. LiTT policy: Drive disabled by default through `GOOGLE_WORKSPACE_DISABLED_PROVIDERS`; Gmail requests only `gmail.readonly` and `gmail.compose`, and legacy broader scopes are not recognized because LiTT never issued them; the suggested list ships empty. | S3 (backend), S4 (UI), S7 (suggested list) | `backend/src/lib/mcp/**`, `lib/integrations/googleWorkspaceAuth.ts`, `lib/integrations/googleDrive.ts`, `(pages)/settings/connectors/page.tsx`, `mikeApi.ts` | `connectors.routes.test.ts`; `privateIp.test.ts`; `oauth.test.ts`; `connectors/page.test.tsx`; new RED: Drive offered nowhere with default config; no suggested connector rendered | G04, G07, G13, G15, G24, FR-19, other-12, §14-G |
| Approved publication to Drive | Drive writes from the assistant through the connector | Matter-bound publication of approved artifacts only, idempotent, fake Drive by default (TD-010) | port | LiTT publication service is the only Drive write path; assistant Drive write tools stay off with the Drive switch. | S3 | `lib/recovery/drive/**`, `matterSettings.ts` → `modules/matters/**` | `approvedArtifactPublication.test.ts`; `aiDrivePublicationWrites.test.ts`; `recoveryDrivePublication.runtime.test.ts`; `ApprovedDrivePublication.test.tsx` | G13, G24 |
| Profile, organization settings and web shell | Custom instructions, response style and language, profile photos, organization logo, organization settings area and Members table, settings reorganization, crash recovery screen, single design-token source shared with Word, dropdown and table primitives consolidated, Ladle catalog, typography and focus polish, self-hosted Inter and EB Garamond | LiTT branding, error mapping through `userFacingError`, documented design system | adopt | Upstream shell, settings and primitives; LiTT brand tokens and visible names reapplied on top of the shared token file. Custom instructions keep their length caps and section separation. | S4 | `globals.css`, `frontend/src/shared/ui/DesignTokensUI.css`, `(pages)/settings/**`, `UserProfileContext.tsx`, `mikeApi.ts`, `frontend/src/app/layout.tsx` | `userPersonalisationPrompt.test.ts`; `useMemoryAutosave.test.tsx`; `DesignTokensUI.test.ts`; `theme.test.ts`; `TablePrimitive.test.tsx` | G22, FR-06, FR-07, FR-08, FR-10, FR-12, FR-15, FR-18, other-13 |
| Word add-in | Document-scoped taskpane with session recovery, failed-answer retry, device-only saves and replayed edits; hermetic e2e in 4 workers | Approved-redline contract (`approvedRedline.ts` and panel); LiTT login card and model catalog | combine | Upstream shell (as in §4) with LiTT `approvedRedline.ts`, its panel and the approved bundle fetched from the backend; LiTT e2e assertions kept over upstream's. | S5 | `word-addin/src/taskpane/hooks/useWordDoc.ts`, `api/mikeApi.ts`, `lib/redline.ts`, `App.tsx`, `word-addin/e2e/**` | `word-addin/e2e/approved-redline*`; `history.spec.ts`; `chat.spec.ts`; `auth.spec.ts` | other-09, other-11, other-12 |
| Third-party telemetry | Sentry in backend, web and add-in, reporting by default to the upstream organization; diagnostic grouping series | No third-party telemetry by default (invariant 11) | reject | SDKs, init files, DSNs and environment entries removed; the error-classification pieces without SDK may return later as local work. | S7 | `backend/src/instrument.ts`, `backend/src/lib/observability/**`, `frontend/sentry.*.config.ts`, `frontend/src/instrumentation*.ts`, `word-addin/src/taskpane/lib/errorReporting.ts`, three `package.json` | new RED: no `@sentry/*` dependency and no default DSN anywhere | G08, G09, FR-14, other-15 |
| CourtListener | Connector listed in Discover, research tools, two index tables | Removed (TD-013); not a Mexican authority | reject | As implemented in S7: files, tools, key type and UI entry removed; the historical upstream migrations stay in the series, and one LiTT migration, `20261023_18_litt_remove_courtlistener`, drops the two index tables and `user_profiles.legal_research_us` and removes the key provider, stopping for an owner decision if a saved CourtListener key exists. The pre-sync removal migrations (`20260905_01_recovery_core_convergence`, `20260909_03_recovery_remove_us_research_preference`) were not carried over. | S7 | `backend/src/lib/courtlistener.ts`, `modules/chat/engine/tools/courtlistener*.ts`, `CourtListenerConnector.tsx`, `docs/courtlistener.md`, `backend/migrations/20261023_18_litt_remove_courtlistener.sql` | `courtlistenerExclusion.test.ts`; `migrationLedger.test.ts` | G24, FR-20 |
| Desktop app | macOS Electron app with a self-contained local database, filesystem storage driver and two `macos-15` CI jobs | Single governed data plane; Actions budget (TD-024) | reject | `desktop/` and `desktop.yml` removed; revisit 2026-11-20 as a product decision. | S7 | `desktop/**`, `.github/workflows/desktop.yml`, `backend/src/lib/storage.ts` | new RED: no `desktop/` tree and no macOS job | other-14 |
| CI workflows | Evals job removed; backend coverage ratchet; Stryker scope; PR triggers and `workflow_dispatch`; spec typecheck; Supabase ports `21320-21322`; run cancellation; Docker image builds on every PR; e2e split into several Supabase jobs; nightly stress; stack-script workflow; add-in e2e in 4 workers; `loadtest.yml` deleted | TD-024 reductions: superseded runs cancelled, docs-only changes skip e2e, Stack and CodeQL, weekly scheduled e2e; `loadtest.yml` kept | combine | Adopt the savings and fixes (evals removal, coverage ratchet, spec typecheck, port move, 4 add-in workers, architecture test for test files outside images). Revert `docker-images.yml` (image builds move to the deployment gate), `stack-script.yml` (the script stays), the e2e job split and nightly stress. Keep `loadtest.yml`. | S6 | `.github/workflows/**` | Exact-head CI on the draft PR; `frontend/src/__tests__/architecture.test.ts`; `docs/e2e-ci.md` census | other-01, other-02, other-03, other-04, other-07, other-08, other-09, other-10 |
| Browser e2e harness | Per-worker accounts; stable locators; local Anthropic-protocol stub so chat flows run without a key | Default CI and local e2e make no real provider or Google call (invariant 11) | adopt | Adopted on LiTT specs; the stub keeps the zero-real-call rule while turning skipped chat specs into coverage. | S6 | `e2e/**`, `.github/workflows/e2e.yml`, `docs/e2e-ci.md` | `e2e/chat-management.spec.ts`; `e2e/critical-path.spec.ts`; `anthropic-stub.check.mjs` | other-05, other-06 |
| Dependencies and supply chain | Upstream lockfiles, Dependabot groups `priority-1/2/3`, action bumps, audit step in `security.yml`, dev-only advisory allowlist | §14 patched floors; actions pinned by SHA with a version comment; allowlist with written reasons | adopt | Upstream dependency set is the base; each slice regenerates its lockfile after its reverts (Sentry removed); §14 floors and LiTT's allowlist reasons kept; actions stay pinned by SHA; the allowlist reasons are re-checked if `office-addin-debugging` or `office-addin-dev-certs` change major. | S6 (root and actions), each slice for its package | four `package-lock.json`, `scripts/audit-allowlist.json`, `.github/dependabot.yml`, `.github/workflows/security.yml` | `security` workflow (`audit-gate`); `npm ci` per package | G01, FR-15, other-12, other-16, other-17, other-18, other-19 |
| Repository texts | Upstream README, `SECURITY.md`, telemetry section, branch-name rule in `AGENTS.md` | LiTT README with upstream attribution, LiTT `SECURITY.md` and `AGENTS.md` | reject | LiTT texts reapplied; the rule changes of the plan land in S8 with the merge commit. | S8 | `README.md`, `SECURITY.md`, `AGENTS.md`, `docs/**` | review of the S8 snapshot | other-11 |
| Staging, recovery and cleanup harness | Upstream local stack | Loopback-only staging, backup and restore harness, attributed cleanup | port | Reapplied on the converged schema and runner. | S6 | `compose.staging.yml`, `backend/scripts/**`, `scripts/**` | recovery runtime suites; contract smoke | — |

### 16.4 Coverage

Every intake group is mapped to at least one row above: 72 of 72 (backend 25,
web 20 plus 7 §14 groups, Word/CI/other 20), checked by parsing the "Upstream
groups" column against the ids in the three classification files (no missing
id, no unknown id). Several groups appear in more than one row because they
span capabilities; `G15`, for example, bundles playbooks, web search,
subagents and Gmail retention. The rows with disposition `reject` are the content
reverts of §4.2 of the plan (telemetry, CourtListener, desktop app, US preset
templates, upstream repository texts). The §4.2 policy inversions
(organization-visible defaults, owner access to private matters, audit
deletion and purge, suggested MCP servers, workflows that push images,
`loadtest.yml`) live in the corresponding `combine` and `gate` rows.

### 16.5 Owner-visible changes

What a lawyer will notice after the sync, with the recommendation applied
unless the owner objects. None of these changes uses real client data.

| What the lawyer sees | Recommendation |
| --- | --- |
| Two conversations can be open side by side, and an answer keeps running if the page is reloaded | Adopt |
| A **Playbooks** page to write a firm's review rules and run them against a document, with history | Adopt; each run records the AI provider, model and key used, and a playbook inside a private matter follows the matter team. The Mexican Civil/Mercantile playbook stays in the governed catalog |
| Editing a Word document inside the browser, with autosave | Show the document now; turn editing on only after it is proven that saving never overwrites a version that an AI answer, a review or an approved document relies on |
| Organization settings: members table, roles, logo, profile photos; the activity log shows people's names instead of email addresses | Adopt |
| One active workspace at a time, chosen from the sidebar | Adopt, on LiTT's own workspaces (internal units of one firm) |
| "Public" and "Private" labels and sharing with the whole organization | Allow them only for work outside a private matter. A private matter stays visible only to its team, and partners or administrators who are not on the team do not see that it exists |
| Personal organizations created for every user | Not offered: onboarding still creates one organization |
| AI provider settings show saved keys masked and warn when a model is unavailable; new AI companies to choose from: Google Vertex AI, Azure OpenAI, Azure AI Foundry, Amazon Bedrock, xAI, Mistral and the firm's own compatible endpoint | Adopt, as decided by the owner on 2026-10-23. Every company is chosen when a conversation is created and stays fixed for it; nothing switches silently. The firm's own endpoint cannot point at internal network addresses. DeepSeek and OpenCode Zen are added directly |
| Gmail and Google Calendar connectors that ask for approval before sending or changing anything | Adopt with the narrowest Google permissions. Google Drive stays off; approved documents still reach Drive only through **Approve and publish** |
| Suggested third-party connectors and CourtListener in the connectors page | Not shown |
| Web search and helper "subagents" inside a chat | Off until the owner decides: web search sends the question to the provider's search service, and a subagent could use a model other than the one chosen for the conversation |
| A warning when a PDF has pages without readable text (scans) | Adopt |
| Custom instructions, answer style and answer language in the profile | Adopt |
| A recovery screen instead of a blank page after an error, and visual polish | Adopt |
| **Delete my account** | Implemented as decided by the owner on 2026-10-24: the person can download their data first, confirms by typing their email, and gets a receipt. Everything outside the firm's matters is deleted at once; matter work, audit history and AI evidence stay with the firm and show "Deleted user"; backups disappear within 30 days. The last owner of an organization with other members must transfer ownership first |
| A catalog of preset contract templates | Shipped empty: the upstream set is US law |
| A Mac desktop app | Not offered; revisit on 2026-11-20 |
| The Word add-in recovers its session, retries a failed answer and replays edits that were not applied | Adopt, keeping the approved-redline panel |

## 17. Receipt of the 2026-10-23 sync

Upstream target and new pin: `e7ab6bd46cb4b3c22f150e184080d29c941df5c0`.
Branch: `sync/upstream-20261023`, created from that commit (strategy B of
[`UPSTREAM_SYNC_PLAN.md`](UPSTREAM_SYNC_PLAN.md)); LiTT `main` before the sync
is tagged `pre-sync-20261023` (`e3672b5954d2d3f8348fdbf2dcbe034a2725df4f`).
The branch is linear on top of the pin (no merge commits) and every snapshot
below is an ancestor of its head. Each slice was reviewed on its exact snapshot
by one Reviewer-profile card; the verdict, its non-blocking reservations and
the evidence live on that card and in the sync evidence kept outside the
repository.

| Slice | Card | Snapshot with PASS | Tree | Verdict |
| --- | --- | --- | --- | --- |
| S1 migrations and schema | `t_c515b92e` | `917813a3e64e5936cbe89f05fceeaac81b5aa5ab` | `7d66e67b3fbccb8e305504856bc7d59cadffe34e` | PASS with non-blocking reservations |
| S2 tenancy and access | `t_0f4ad497` | `543489a1ce3548c37b6f617d886ca0f2356eb05a` | `d1639a07c8e8dbe7614ebbec9b6ea5d9c2c2ae21` | PASS with non-blocking reservations |
| S3 backend LiTT delta | `t_f79a7b96` | `d580112187f0bf7c8e4dfc625a6918f8b8281ddf` | `451897c57fc8628fc3d6b0745be0ec7c1c0b26b6` | PASS with non-blocking reservations |
| S4 frontend LiTT delta | `t_99c299c9` | `7cc4da632eba6191dfe82f1f067b546ca122ddde` | `3604ac5e088003b6245ef8b06ed77c5e6bc43bb7` | PASS with non-blocking reservations |
| S5+S6 Word add-in, CI and e2e | `t_87e481c3` | `20f43fc1d563e9db85e55617b420f74684368ac8` | `9be56c8cf812a5ec49b571535a9c0a4432242c3e` | PASS with non-blocking reservations |
| S7 reverts of §4.2 | `t_48cf81dd` | `6342e94c571df394028fadc6e3f928699bce6638` | `15923538147d4bb129c7e3306f2b20ee847ffc33` | PASS with non-blocking reservations |
| S8a deployment package and documents | this snapshot's review card | recorded on the card | | pending |
| S8b `AGENTS.md`, merge commit, pin | coordinator | | | pending |

Exact-head CI of the S7 snapshot. The draft pull request #14 is
`CONFLICTING` with `main` by design (strategy B), so GitHub starts no
`pull_request` checks; the evidence is `workflow_dispatch` on the exact head
`6342e94c`: CI `40061382451`, Schema drift `40061383918`, Stack tests
`40061385387`, Word add-in `40061386834` and e2e `40061388294`, all `success`.

The reservations became debt rows TD-021 and TD-025–TD-039 in
[`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md). Two of them describe how the synced
tree behaves and are repeated here because they qualify rows of §16.3:

- **Authorization epochs (C4).** S2 stamped queued tabular extraction; S3
  extended the stamp to the organization audit export and to playbook runs
  and imports. Other queued jobs that read organization content (document
  text extraction and conversion, memory consolidation, other export builds)
  carry no stamp; they do not widen a revoked user's access (TD-037).
- **Matter membership is a gate, not a grant.** A member of a private
  matter's team still needs project access (a grant or a
  `project_org_access_overrides` row) to open the project; a private matter's
  project with `visibility='organization'` gives `editor` to its team through
  that branch; a matter whose last member leaves the organization has no
  defined successor (TD-038).

From now on, upstream arrives by an ordinary reviewed merge of `upstream/main`
on a sync branch, checked against §16 ([`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md)).

## 18. Cycle 2026-10-24 (first ordinary merge)

Pin `e7ab6bd46cb4b3c22f150e184080d29c941df5c0` →
`d4fd89996e638f66ca55331cb787ce38e11975e1` (`upstream/main` at intake, four
commits). Branch `sync/upstream-cycle-20261024` from `main` `b24c1ecd`; the
upstream commits arrive through one `git merge --no-ff` and the rejected parts
are reverted in separate commits after it. The branch is integrated with a
merge commit, never a squash, so upstream stays an ancestor of `main`.

### 18.1 Classification

| Upstream commit | Capability (§16.3 row) | Disposition | What LiTT keeps |
| --- | --- | --- | --- |
| `18035cf6` #693 connectors per workspace | Connectors, MCP and Google Workspace; CourtListener | adopt, except the CourtListener half (reject) | A person keeps separate MCP, Drive, Gmail and Calendar connections for Personal and for each organization, tied to the membership row. Drive stays off by default. The CourtListener table, routes, client calls and contract type are removed |
| `540fb8a2` #695 organization work only on central keys | Provider catalog, credentials and model selection | reject: contradicts the owner's recorded product decision (2026-08-12): personal BYOK plus optional institutional credentials, replacing the single organization credential | The owners' per-organization switch for members' own keys (default on), `PUT /orgs/:id/api-keys/policy`, and the explicit pinned `credential_ref`. Upstream's rule would end personal BYOK inside the firm, where every LiTT lawyer works, and resolves organization work implicitly (organization key, then deployment key) |
| `040e17ac` #694 Privacy & Data deletes per workspace | Account and organization deletion, member departure | adopt, with the matter gate | Bulk deletes act on the active workspace only. In an organization, "Delete all projects" deletes only the projects the caller may delete through `DELETE /projects/:id`, so a private matter's project stays closed to a creator who is no longer on its team. Account deletion still refuses (TD-008) |
| `d4fd8999` #696 exports per workspace and member data policy | Access fixes (exports); Organizations, workspaces and matters | adopt | Exports cover the active workspace and keep LiTT's readable-cell and readable-transcript filtering. Owners decide whether members may export or bulk-delete their own work in the organization (both off by default); the change is MFA-guarded and audited |

### 18.2 Conflicts and adaptations

- The merge had 25 conflicting files. Where upstream's side of a hunk was
  CourtListener or #695 material, LiTT's side was kept. LiTT names and texts
  were kept on top of upstream's workspace scoping: `litt-*` download names,
  "LiTT" in the memory page text, the TD-008 refusal test and
  `loadReadableReviewCells`.
- `20261022_01_workspace_connectors` was edited before any LiTT database ran
  it: the CourtListener section is left out. As shipped by upstream it reads
  `user_profiles.legal_research_us`, which `20261023_18` drops, so it would
  fail on a LiTT database that already applied `20261023_18`. It would also
  delete the saved `courtlistener` keys that `20261023_18` stops on instead.
- `20261024_01_org_keys_central_only` is removed together with #695. No LiTT
  database has applied it.
- New migration `20261024_50_litt_memory_delete_opt_in`: upstream's
  `delete_user_private_memories(uuid, uuid)` creates a missing Personal memory
  file switched on, and LiTT memory is opt-in. After the merge, `schema.sql`
  also re-created LiTT's one-argument form as a second overload with no
  revoke. Only the final two-argument shape remains.
- LiTT-only tests were moved to the new signatures (`ConnectorOwner`,
  workspace-scoped exports).

### 18.3 Owner-visible changes

| What the lawyer sees | Recommendation |
| --- | --- |
| Connectors (Gmail, Calendar, MCP) are set up separately for Personal and for the firm, and a firm conversation uses the firm set | Adopt |
| "Delete all…" and "Export…" in Privacy & Data act only on the workspace shown and name it | Adopt |
| Firm owners decide whether other members may export or bulk-delete their own work in the firm (off until an owner allows it) | Adopt |
| Upstream would stop lawyers from using their own AI key for firm work and would remove the owners' setting for it | Not applied: it contradicts the owner's recorded product decision (2026-08-12) for personal BYOK plus optional institutional credentials. LiTT keeps the owners' setting, on by default. Later upstream changes built on #695 are reconciled the same way (TD-042) |

### 18.4 Dependabot

| PR | Group | Result |
| --- | --- | --- |
| #21 | codeql-action 4.39.0 → 4.39.1 (actions, pinned by SHA) | applied |
| #17 | word-addin development | applied |
| #19 | word-addin lucide-react | applied |
| #20 | frontend production (docx, lucide-react) | applied |
| #18 | frontend development | wrangler applied; TypeScript 5.9.3 → 7.0.2 deferred (TD-043) |
| #22 | backend production | applied except google-auth-library 10 → 11 (TD-043) |
| #4, #6, #8 (codeql-action), #7 (scorecard-action 2.5.0) | — | already closed by Dependabot, superseded by #21; scorecard-action is v2.5.0 on `main` |

Close #17–#22 once this branch is in `main`. Dependabot reopens the two
deferred majors on its own.

## 19. Cycle 2026-10-29

Pin `d4fd89996e638f66ca55331cb787ce38e11975e1` →
`d601932abecb7f6f5f01a863b939765ef2f3075d` (55 non-merge commits). Branch
`sync/upstream-cycle-20261029` from `main` `73de2cf2`. The cycle opened on
`4355fdf362108c948fc39b2d505f27758776b72d` (51 commits, merged first);
upstream gained four commits while it ran, merged by a second
`git merge --no-ff` of `d601932a`. Both merge commits keep upstream as an
ancestor; the branch is integrated with a merge commit, never a squash.

### 19.1 Classification

| Upstream commits | Capability (§16.3 row) | Disposition | What LiTT keeps |
| --- | --- | --- | --- |
| `2619ea72` #721, `15d51679`, `3ce96cf9`, `6cafeff8`, `dde73c39`, `8c5d2c43` parser isolation | Documents, conversion and extraction | adopt | Document parsing runs in bounded child processes with admission limits; uploads get their own thread; stalled storage downloads abort. Matter and organization access checks are unchanged |
| `a465c4b1`, `46dc4b5c`, `acf7b7a2`, `c93120f3`, `a4d8b24d`, `8c5733ef`, `dc9c73b6`, `7eef1a2d`, `877792b8`, `0454f331`, `df8b3593`, `a208530c`, `f4459d7d`, `141e0aa2`, `a543a681`, `1fd07e0f`, `68c242c1`, `89d9907a`, `0ebe949f`, `4ea69175`, `5750e093`, `a0bc1662`, `318b7416`, `608e207b`, `83587c44`, `56b62a68`, `5bd4cedf`, `1dd7c6f1`, `ee65103c` error identity (operation, kind, stage) | Third-party telemetry | adapt: classification adopted, reporter local | `AppError`, `describeError`, failure kinds, operation/stage labels, retry ownership and best-effort cleanup reporting are adopted. Every call site that upstream sends to Sentry goes to a local reporter instead: `backend/src/lib/observability/report.ts` writes one sanitized, allowlisted line to the server log (no messages, request data or stacks); `frontend/src/app/lib/errorReporting.ts` and `word-addin/src/taskpane/lib/errorReporting.ts` only mark the failure as handled. No SDK, DSN, environment entry or network egress |
| `01b33d22`, `927f96b2` Node warnings to Sentry; `71cd0286`, `95f2711c` source-map upload into image builds; `b611f3f5` Sentry docs | Third-party telemetry | reject (invariant: no third-party telemetry) | Sentry modules, `instrument.ts`, Sentry configs and tests, `docs/observability.md`, the `SENTRY_*` build args and the `SENTRY_AUTH_TOKEN` build secret in `docker-compose.yml`, `frontend/Dockerfile`, `word-addin/Dockerfile` and `.env.example` are not taken |
| `20261027_01_document_text_failed_jobs` (part of the extraction series) | Migrations | adopt | Upstream date/ordinal stem unused by LiTT; added to `schema.sql` and the `schema_migrations` list |
| `f6488bac`, `c2fb60eb`, `4c65b1cb`, `3208b273`, `8cee46bb`, `b522b75f`, `705fee83`, `ead870a2`, `d31a5ec5`, `7f0868a6`, `7bda0592`, `78c96293`, `7797cadb`, `9831f558`, `7ae77b6a` dependencies and audit gate | Dependencies and supply chain | adopt | Dependency-scoped audit exceptions, google-auth-library 11 with `@ai-sdk/google-vertex`, the frontend's TypeScript pinned to 5.x, decode-uri-component 0.5.1 (same lockfile hunk as LiTT PR #32). `@sentry/*` packages are removed from every `package.json` and lockfile |

### 19.2 Conflicts and adaptations

- The first merge had 80 conflicting paths. Sentry-only files that LiTT
  deleted in S7 (`observability/sentry*.ts`, `sentryTestRoute.test.ts`,
  `docker-images.yml`) and CourtListener (`courtlistener.ts`) stay deleted;
  `storageFs.test.ts` stays deleted with the filesystem adapter LiTT does not
  ship.
- In the conflicting hunks LiTT's governed BYOK route, organization and
  matter tenancy, insert-only audit, LiTT branding and the `GIT_SHA` source
  offer were kept on top of upstream's error classification.
- About 28 upstream comments mention a "console bridge" (the Sentry
  console integration) that LiTT does not have. They are text only and are
  left as upstream wrote them to keep future merges small.
- `rg -iw sentry` over runtime code and `package.json` files: 0 (a plain
  `rg -i` also matches `ProgressEntry` and `webkitGetAsEntry`). The other
  hits are `.gitleaks.toml` (a fixture description already on `main`),
  `AGENTS.md` and documents that state Sentry is absent or record history.

### 19.3 Owner-visible changes

| What the lawyer sees | Recommendation |
| --- | --- |
| A large or broken document no longer slows down or stops the rest of the app while it is read; it fails on its own with a clear message | Adopt |
| Error messages name what failed (upload, conversion, Drive, assistant) more consistently | Adopt |
| Upstream would send error reports to an outside service (Sentry) | Not applied: LiTT sends no data to third parties |

### 19.4 Dependabot

| PR | Group | Result |
| --- | --- | --- |
| #27 | word-addin webpack 5.112.2 | covered by the merge |
| #28 | frontend development | baseline-browser-mapping and eslint-config-next covered by the merge; TypeScript 7.0.2 not applied, upstream pins the frontend on 5.x (`9831f558`) |
| #29 | frontend production | covered by the merge, except the `@opennextjs/cloudflare` floor (^1.20.13), applied in its own commit |
| #30 | backend production | covered by the merge (google-auth-library 11 included) |

Close #27–#30 once this branch is in `main`. TD-043 is closed by this cycle.

## 20. Cycle 2026-11-06, 1 of 10

Pin `d601932abecb7f6f5f01a863b939765ef2f3075d` →
`1f7ae19fd1643fd350d564bbdbbe5801611d0765` (16 commits, 13 without merges,
upstream's 2026-10-29 to 2026-10-30 work). Branch `sync/upstream-c1-1f7ae19f`
from `main` `fe5c9070`. It is the first of ten cycles that bring in the
2026-11-06 intake in upstream's order; the owner approved every topic as
recommended on 2026-11-06 and rejected the Sentry, desktop and CourtListener
topic. One `git merge --no-ff` of the pin; the LiTT copy and index
adaptations follow in separate commits. The branch is integrated with a merge
commit, never a squash.

### 20.1 Classification

| Upstream commits | Capability (§16.3 row) | Disposition | What LiTT keeps |
| --- | --- | --- | --- |
| `d1d0e2c8`, `fec980fb`, `09349b56`, `b702ec6a`, `4591ab29`, merge `193c06bb` (#736) set-based chat list | Organizations, workspaces and matters | adapt | `get_chats_overview` evaluates the ladder with set-based joins (migration `20261029_01`, timeout reproduction and parity test in schema drift). Upstream's version copies upstream's ladder, so LiTT migration `20261106_53_litt_chat_overview_private_matter` re-creates it with `project_private_matter_denied` before every project branch (C2) and with `can_access_org_private_content` instead of upstream's inlined owner/admin rule. `chat.overview.sql` adds private-matter cases (creator, organization owner, override, revoked membership, public matter, matter team) and documents that opened private content grants nothing in LiTT |
| `3c907acb`, `6831f0c0`, `a89cffe5`, `186bba46`, merge `51f554c4` (#744) named upload-worker failures | Third-party telemetry (error identity) | adapt: classification adopted, reporter local | `upload.lease_lost`, `upload.job_missing`, `upload.session_missing`, `upload.file_missing`, the 15-minute repeat window of the poll failure gate and the new SQLSTATE/PostgREST codes. The codes go into `backend/src/lib/observability/diagnostics.ts`; `sentryPrivacy.ts` stays deleted. The reporting tests count local log lines |
| `be641cec`, merge `aa503191` (#746) export test wait | Profile, organization settings and web shell (test only) | adopt | — |
| `81a59c04` (#743) onboarding Connect a model | Provider catalog, credentials and model selection | adapt | The fourth step and the shared `PersonalProviderKeys` grid. The copy no longer says personal keys work only in the Personal workspace: a member's own key covers any provider the organization has not set up unless its owners turn that off (owner decision of 2026-08-12, personal BYOK; see #695 in §18). The step reads `allow_personal_api_keys` of the organization just joined. Desktop e2e files stay deleted |
| `1f7ae19f` (#745) settings search | Profile, organization settings and web shell | adapt | The search box and its index. CourtListener is removed from the index; entries for Formación (Mi formación, Mis pupilos), Subagentes with model routes, the AGPL source offer (Acerca de), and LiTT's data download and account deletion wording are added, with Spanish words; LiTT replaces Mike in every description. The heading focus ring uses `ring-focus` instead of blue |
| `3bcac35a` (#747) release images, source maps and Sentry tunnel | Third-party telemetry; CI workflows | reject (invariant: no third-party telemetry; LiTT builds each deploy's images from the exact SHA, AGPL §13) | `publish-images.yml` and its script, `VERSION`, `releaseName`, the `/monitoring` route and `sentryTunnel`, the image-based `db-init`, the GHCR image names in `docker-compose.yml`, the Sentry build and runtime variables and every Sentry file LiTT removed are not taken. LiTT's Dockerfiles, compose file, deployment docs, `adopt-ledger.sh` and `migrationLedger.test.ts` are unchanged |

### 20.2 Conflicts and adaptations

- The merge had 31 conflicting paths. The 14 modify/delete conflicts
  (Sentry, `desktop/e2e`, `docker-images.yml`, `docs/observability.md`,
  `docs/sentry-data-audit.md`) keep LiTT's deletion. The content conflicts
  that come only from #747 (`.env.example`, `README.md`, the three
  Dockerfiles, `docker-compose.yml`, `docs/deployment.md`,
  `frontend/.env.local.example`, `frontend/next.config.ts`, the web and
  add-in `errorReporting.ts`, `word-addin/src/env.d.ts`,
  `word-addin/webpack.config.js`) keep LiTT's side, and so do its
  non-conflicting hunks in `ci.yml`, `adopt-ledger.sh` and
  `migrationLedger.test.ts`.
- `schema.sql`: the `schema_migrations` list takes `20261029_01` in filename
  order and `20261106_53`; the LiTT section with the guarded function is
  appended after the training sections. On an existing database `20261029_01`
  and then `20261106_53` apply in filename order, both unlisted.
- `runner.reporting.test.ts` and `uploads.processing.test.ts` take upstream's
  flap cases, asserting on the local `console.error` lines instead of Sentry
  events.
- A PostgreSQL opt-in suite, `chat.overview.postgres.test.ts`, loads
  `schema.sql`, runs the parity and reproduction files, then applies
  upstream's `20261029_01` alone and shows the parity file fails (the list
  would show private matters' chats), and passes again after `20261106_53`.
- The `chat.overview.sql` fixture inserts private-content access rows directly
  and stamps the deleted organization directly, because LiTT refuses
  `open_org_private_content` and `soft_delete_organization`.
- Three comments that upstream wrote about Sentry now say "reported" or
  "error log"; `rg -iw sentry` over runtime code and `package.json` files: 0.

### 20.3 Owner-visible changes

| What the lawyer sees | Recommendation |
| --- | --- |
| The chat list opens faster in a busy firm, and a private matter's chats still appear only to its team | Adopt |
| Sign-up ends with a "Connect a model" step; it says a lawyer's own key also works in the firm unless the owners turned that off | Adopt |
| Settings has a search box that also finds Formación, Subagentes, the source code link, data download and account deletion | Adopt |
| Upstream would publish release images and send browser error reports to an outside service (Sentry) | Not applied: LiTT sends no data to third parties and builds its images from the exact source |

### 20.4 Dependabot

Upstream changes no dependency in this cycle. The open Dependabot pull
requests (#50–#55) are left for the cycle that brings upstream's next
dependency updates.

## 21. Cycle 2026-11-06, 2 of 10

Pin `1f7ae19fd1643fd350d564bbdbbe5801611d0765` (2026-10-30) →
`14d695f176152367cf44e89e200a04778b353b6d` (2026-11-04): 7 commits, 4 without
merges, upstream's 2026-10-27 to 2026-11-04 work. Branch
`sync/upstream-c2-14d695f1` from `main` `6f985097` (cycle 1 integrated). One
`git merge --no-ff` of the pin; the LiTT adaptation follows in a separate
commit. The branch is integrated with a merge commit, never a squash. The
owner's approval of 2026-11-06 (§20) covers this cycle.

### 21.1 Classification

| Upstream commits | Capability (§16.3 row) | Disposition | What LiTT keeps |
| --- | --- | --- | --- |
| `783e0ef8`, `b5eafa12`, merge `e3f2c8c1` (#716) playbook ids before Postgres | Workflow catalog, add-ons and playbooks | adopt, extended | A malformed `:playbookId` answers 404 and malformed or wrong-type `playbookId`/`documentId` in import and review bodies answer 400, before any query. The LiTT commit applies the same check to the other ids under a playbook: `:shareId` and `:sourceId` answer 404 with their services' not-found messages, and the `documentId` of `POST /:playbookId/sources` answers 400 while the staged upload is still cleared. No other route takes a playbook id |
| `6a52e85e`, merge `14d695f1` (#752) Word add-in node-forge and follow-redirects advisories | Dependencies and supply chain | adopt (already in LiTT) | LiTT's `word-addin/package-lock.json` already resolves node-forge 1.4.2 and follow-redirects 1.16.2 (`c1e839cf`), and `scripts/audit-allowlist.json` had already dropped the node-forge entry; both keep LiTT's side, which also keeps LiTT's braces and msal-node entries |
| `cfb8a2e4`, merge `93303e72` (#774) Sentry Vercel AI tool-error filter | Third-party telemetry | reject (invariant: no third-party telemetry) | The change only filters what `@sentry/node`'s Vercel AI integration sends. LiTT ships no Sentry, so there is nothing to adapt in `backend/src/lib/observability/diagnostics.ts`; `sentry.ts` and `sentry.test.ts` stay deleted |

### 21.2 Conflicts and adaptations

- The merge had 4 conflicting paths: `sentry.ts` and `sentry.test.ts`
  (modify/delete, LiTT's deletion kept), and `scripts/audit-allowlist.json`
  and `word-addin/package-lock.json` (content, LiTT's side kept; it already
  contains #752's result).
- `playbooks.routes.ts` and its integration test merged without conflict.
  The LiTT commit adds `router.param` checks for `shareId` and `sourceId`,
  the body check in `POST /:playbookId/sources`, nine route tests that fail
  without it, and a UUID id for the supplementary-document fixture.
- `rg -iw sentry` over runtime code and `package.json` files: 0.

### 21.3 Owner-visible changes

| What the lawyer sees | Recommendation |
| --- | --- |
| A broken playbook link shows "not found" instead of a server error | Adopt |
| Nothing: the Word add-in's development tools get security fixes LiTT already had | Adopt |
| Upstream would change what it sends to an outside service (Sentry) | Not applied: LiTT sends no data to third parties |

### 21.4 Dependabot

Upstream changes no dependency beyond #752, which LiTT already has. The open
Dependabot pull requests are left for the cycle that brings upstream's next
dependency updates.

## 22. Cycle 2026-11-07, 3 of 10

Pin `27683564a5b72c20d5f2796bf826f3146a8c7bfe` (2026-10-30), a commit on the
branch of upstream #749 and an ancestor of its merge `d0a7ca75`. The cycle
merges `14d695f1..27683564`: 43 commits, none of them merges, 157 files.
Nothing after the pin is integrated.

### 22.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| SQL C1–C7, H2–H6 (`20261030_01`…`_11`) | `43eeb809` `4dd610d3` `6d52372f` `48cb8419` `c9f47a1f` `4a55dd26` `a9a146e9` `498d49ef` `1b4eb570` `02d075a4` `b5b39ab2` `f03918ad` `b97fbb5f` | adopt, except `org_members_departure_items` in `20261030_04` (adapt, 22.2) |
| Picker and directory in SQL (`20261030_20`, `_21`) | `4de4c8d2` `3b981481` | adapt: LiTT private-matter backstop kept in `searchProjectDirectory` |
| Bounded rendering and reuse: tabular, Word add-in, PDF, DOCX comments, documents, chat, citations | `31d19862` `2fb4f0f5` `c28c6a16` `98f01a2b` `e6d30d96` `8b8c09ed` `27ffe38c` `3ca4d321` `b017e5f9` `3038feb5` `01bb3ad4` `e74a9e77` `f3c5a8b0` `2fb278a3` `3c461af5` `62baac62` `3a3a69ae` `b87cdbe2` `277ed6de` `eb22582b` `d7084ed6` `f2ffe4a9` `3b061c62` | adopt; CourtListener case-citation paths in `c28c6a16`/`f2ffe4a9` stay removed |
| Settings search focus | `d4451b1f` | adopt |
| Sentry stack paths | `fe8381fa` | reject (no third-party telemetry); no net change |
| E2E | `4ef9699d` | adopt without the Slack connector LiTT does not have |
| E2E development renderer | `efc0cdcd` `27683564` | reject: LiTT runs only the production renderer (TD-024); no net change |

### 22.2 Functions created or redefined, and LiTT C2

Every function the tranche (re)defines was compared with LiTT's last
definition and upstream's previous one. Only `org_members_departure_items`
had a LiTT change (C2 point 3, `20261023_13`). The list helpers
(`project_list_access`, `review_list_access`, `workflow_list_access`,
`search_project_directory`) collect candidates and still take each verdict
from `project_access_role`, `review_access_role` or `workflow_access_role`,
which carry `project_private_matter_denied`. `org_private_access_role`,
`org_private_document_access` and `list_org_private_content_access` still
require `can_access_org_private_content`, which is false in LiTT.
`find_document_text`, `document_text_access` and `organization_audit_events`
resolve projects through `project_access_role`.

- `20261030_51_litt_departure_private_matter.sql` re-creates
  `org_members_departure_items` with upstream's new text plus the matter
  exclusion. `schema.sql` defines that version once, in its LiTT section;
  upstream's unguarded copy is replaced by a pointer. The older bodies in
  upstream's part of the file and in the `20261023_13` section stay because
  SQL functions defined earlier call it and each LiTT section mirrors its
  shipped migration.
- `searchProjectDirectory` (TS) asks `private_matter_denied_project_ids`
  about the page before hydrating documents and fails closed.

Proof: `backend/src/__tests__/sql/performance.litt-private-matters.sql` (run
by the schema-drift loop with upstream's `performance.*.sql`) checks owner,
admin and an overridden member against all of the functions above, the team
as a positive control, and departure.
`littPrivateMatterLists.postgres.test.ts` shows it fails with upstream's
`20261030_04` alone and with the guard switched off.

### 22.3 Upstream SQL tests under LiTT

Upstream's `performance.*.sql` assume owner/admin openings of private content.
In LiTT `open_org_private_content` refuses, so the openings are recorded
directly and must grant nothing; parity with the per-item verdict is kept.
`performance.actors.sql` expects a recorded actor address, which LiTT does not
store (account erasure, 2026-10-24). `performance.private.sql` no longer
includes `orgs.privateContent.sql`, `orgs.auditPrivateContent.sql` and
`orgs.auditPagination.sql`, which already failed on LiTT main for that
reason and never ran in LiTT CI; it asserts the refusal instead.

### 22.4 Also in this cycle

- Reservation R3 of the cycle-2 review: `POST /playbooks/:playbookId/sources`
  with an id that cannot exist now clears the caller's staged upload.
- `PROJECT_STATUS.md`: production and `main` named separately (R2).

### 22.5 Owner-visible changes

Lists, the document picker, tabular reviews, Word edits and PDF pages respond
faster on large matters. Nothing a lawyer can see or reach changes.

### 22.6 Dependabot

Upstream's `word-addin/package-lock.json` change in this range is taken as merged; the open Dependabot pull requests stay for the dependency cycle (9 of 10).

## 23. Cycle 2026-11-07, 4 of 10

Pin `31539729f4609cdf642a61bb963995668b97cac4` (2026-11-01), a commit on the
branch of upstream #749 and an ancestor of its merge `d0a7ca75`. The cycle
merges `27683564..31539729`: 63 commits, none of them merges, 172 files.
Nothing after the pin is integrated.

### 23.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| SQL S1–S11, L11b (`20261101_01`…`_14`) | `ac1bee81` `5f326a58` `3997118b` `69556057` `d41b5c13` `c18c1ccd` `36509072` `c928c264` `9e6c5532` `aebf48fe` `102c84cc` `20c5a305` | adopt, except `project_access_role` in `3997118b` (S2) and `org_members_departure_items` in `d41b5c13`/`c18c1ccd` (S11, S4b): adapt (23.2) |
| Paged and batched backend reads (projects, chats, tabular rows/cells, playbooks, org resources, folders, exports) | `8badaf64` `afa219bd` `64735dd1` `2009f35b` `79f48103` `ae299826` `a8556f06` `6cc02c01` `1f0cd75b` `a8efd01e` `6471b592` | adopt, except: `6cc02c01` keeps LiTT's private-matter filter in `listOrgResources`; `a8efd01e` keeps the pasante release check and `OMITIDOS.txt` in the documents ZIP export; `afa219bd`'s paged `loadReviewRows` lives in `lib/tabularReadAccess.ts`, where LiTT keeps it |
| Web lists, selection, bulk actions, uploads, history (one Set, one pass, one frame) | `f3e6ba7e` `077be035` `13ad69b1` `272e2376` `c8eaeadf` `15aff5ca` `705cec82` `6f14b184` `d8aba7cc` `1b6e028d` `4b376f12` `68d72570` `164bbc96` `87927d91` `9c358da6` | adopt; `DocTable` keeps LiTT's download wrapper for pasante drafts |
| Chat engine: incremental citation parsing, find/search reuse, folder paths, doc labels | `68cd9f9e` `fc940a67` `58f70465` `b0c53bc8` `51d29f43` `ebe6f907` | adopt without the CourtListener case-citation and `find_in_case` halves, which LiTT removed |
| CourtListener case verification pass | `e2b7e9c4` | reject (LiTT removed CourtListener); no net change |
| DOCX tracked changes, spreadsheet rendering | `b992573d` `6341617c` `f9c57abf` | adopt |
| Job queue | `ff2e4357` `e7ac2ed5` | adopt |
| Sentry throttle map | `84637f74` | reject (no third-party telemetry); no net change |
| Word add-in: device-only chat storage, redline projector, picker, tracked-edit batching | `8a3742c7` `def3ab1f` `b8d9547c` `5f7f474b` `220ebe66` `a5e2b216` `d45eb378` `d31d6b14` `5204c465` `c10b4c75` `31539729` | adopt; no visible text, colours or provider names change (identity v1.0) |
| Word add-in node-forge / follow-redirects | `26975fa6` | adopt; no net change (LiTT already resolved both packages) |

### 23.2 Functions created or redefined, and LiTT C2

Every function the tranche (re)defines was compared with LiTT's last
definition and upstream's previous one
(`artifacts/upstream-sync-c4-20261107/function-comparison.txt` outside the
repository). Two had a LiTT change:

- `project_access_role` (`20261101_03`, S2): upstream compares the member's
  uuid instead of casting the column, and rewrites the function without
  LiTT's first branch, `project_private_matter_denied` (C2, `20261023_10`).
  `20261101_50_litt_project_access_private_matter.sql` re-creates upstream's
  new text with that branch first.
- `org_members_departure_items` (`20261101_06`, S11; `20261101_08`, S4b):
  upstream rewrites it twice without the matter exclusion that
  `20261030_51` restored (C2 point 3, `20261023_13`).
  `20261101_51_litt_departure_private_matter.sql` re-creates upstream's
  final text with `and not exists (select 1 from public.matters mt where
  mt.project_id=item.id)` on the project roots.

`schema.sql` defines each guarded version once, in its LiTT section. Upstream
edits its last copy in place: the in-place `project_access_role` keeps the
previous text behind a pointer, and the departure copy stays a pointer. The
older bodies stay because SQL functions defined earlier call them and each
LiTT section mirrors its shipped migration. The LiTT migrations sort after
every upstream `20261101_*` file.

The other functions route each verdict through a function that already carries
the guard:

- `project_list_access` and `workflow_list_access` (S3) only narrow the
  candidates; each role still comes from `project_access_role` or
  `workflow_access_role`. LiTT grants a matter's team nothing beyond those
  candidates (organization visibility, overrides, grants).
- `get_projects_overview` and `get_tabular_reviews_overview` (S7) count
  columns over `project_list_access` and `review_list_access`.
- `document_text_access` (S2) and `find_document_text` (S10) resolve projects
  through `project_access_role`.
- `org_private_document_access` (S5) and the private branch of
  `organization_audit_events` (S6) require `can_access_org_private_content`,
  which is false in LiTT; the rest of the audit page goes through the
  `*_access_role` functions.
- `workflow_access_role`, `standalone_org_access_role`,
  `cleanup_removed_org_member_overrides` (S4a), `document_referencing_items`
  and `claim_db_jobs` (L11b) never touch a matter's project.
- In TypeScript, every reader that called `private_matter_denied_project_ids`
  on `main` still does; `listOrgResources` applies it to upstream's paged reads.

Proof, all in the schema-drift CI loop:

- `performance.litt-private-matters.sql` checks the organization owner, an
  admin and an overridden member against all of these functions, with the
  team as a positive control and departure.
- `performance.litt-private-matters-controls.sql` loads upstream's
  `20261101_03` and `20261101_08` alone, and the switched-off guard. Each
  must leak the matter, and the LiTT migrations must restore the guard.
- Upstream's new suites (`performance.departure`, `.foreign-keys`, `.jobs`,
  `.membership`, `.overview-counts`) pass as they are.
- `performance.private.sql` runs upstream's S5 suite adapted to C2: the
  openings are written directly, and every verdict is false.

### 23.3 Reservations of the cycle-3 review

- **W1:** `performance.litt-audit-pagination.sql` is LiTT's copy of
  `orgs.auditPagination.sql` and runs in CI. LiTT stores no address on new
  audit rows and sorts by person on the live profile (account erasure,
  2026-10-24). So the page-vs-feed parity orders the feed by
  `audit_actor_email`, and actors are found by their profile e-mail.
  - The task proposed dropping the `user_email desc` parity. Instead it is
    aligned with LiTT's ordering, which keeps the check for both directions:
    the mismatch came from the recorded column being empty, and it could also
    fail for `asc` depending on the random ids.
  - An owner searching a member's private title finds nothing (total 0).
- **W2 (open product question):** a matter whose project has
  `visibility='private'` is reached only by the project's creator. A matter
  teammate who is not the creator gets `project_access_role = null` and does
  not list it, like the organization owner. This is LiTT's behaviour since
  `20261023_10`: stricter than the organization-visible form, not a leak.
  `performance.litt-private-matters.sql` pins it. Whether a matter's team
  should reach a private-visibility project is for the owner to decide;
  nothing changes until then.
  *Resolved by the owner on 2026-11-07 (§29.6, question 1):* the active team
  now reaches it with its matter roles (`20261107_70`), and the same file
  pins the new rule.
- **W3:** the negative controls run in CI
  (`performance.litt-private-matters-controls.sql`).
  `littPrivateMatterLists.postgres.test.ts` keeps the full-file swaps for
  local runs, updated to this cycle's migrations.

### 23.4 Owner-visible changes

Large matters, reviews, document lists, bulk actions, exports and the Word
add-in respond faster. Lists no longer stop at 1000 rows. Nothing a lawyer can
see or reach changes.

### 23.5 Dependabot

No Dependabot pull request is covered by this range: upstream's only
dependency change (`26975fa6`) was already in LiTT. The open ones stay for the
dependency cycle (9 of 10).

## 24. Cycle 2026-11-07, 5 of 10

Pin `d0a7ca7550bdaa3f21284b730c3139951ac89576` (2026-11-03), the merge of
upstream #749 and the last tranche of that pull request. The range
`31539729..d0a7ca75` has 72 commits, 4 of them merges, and 127 files. Seven of
them (`6a52e85e` `783e0ef8` `93303e72` `b5eafa12` `cfb8a2e4` `e3f2c8c1`
`14d695f1`) were already in `main` through cycle 2 (§21), so the merge brings
65 commits, one of them the #749 merge. Nothing after the pin is integrated.

### 24.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| SQL M-S2…M-S9, M-B6 (`20261101_15`…`_24`) and their suites | `bc0edec1` `d305d060` `18132c24` `fcaf75ab` `02de2ca5` `9754a2d2` `fa310552` `b7f8eb0d` `2e3ea04d` `e22e4f43` `493ac400` `e5d1298a` | adopt, except `ownerless_org_item_ids` in `18132c24` (M-S4), `org_members_departure_items` in `02de2ca5` (M-S5) and `organization_audit_events_page` in `9754a2d2` (M-S6): adapt (24.2). The projects, workflows and private-catalogue suites are adapted to LiTT's closed catalogue (24.2) |
| Word add-in: tracked edits, bulk decisions, device chats, picker cache | `5009f893` `25bab771` `ce27d2aa` `78f918a9` `b37acc2a` `c279b875` `851f57a9` `313c4aaa` `812bb656` `be445f62` `15025a79` `7eb72a57` `ad5c89e8` | adopt; the newer-database message of `c279b875` names LiTT (identity v1.0); the Sentry e2e half of `851f57a9` stays deleted |
| Tabular reviews: row sync, generation, reconcile, folder rows, row sources | `215516d0` `31b14465` `eccc9cce` `a3945be4` `e9e0c1a7` `af754e2b` `b34c4e4e` | adopt; the `loadReviewRows` halves of `af754e2b` and `5e84e1c1` are ported into `lib/tabularReadAccess.ts`, where LiTT keeps it |
| Batched and keyset reads: db helper, exports, memory, organizations, sharing, Word chat, library, playbooks, storage, documents | `0efe45e9` `02dfc357` `6509fab4` `a06261d0` `6df74ffa` `a26c443a` `75a6a435` `172ec4e2` `a8ed1c34` `5e84e1c1` `cb2f8038` `23e343b4` `c24da0e8` `fb1670f5` `b4c8069a` `ad392d43` `410484b5` `2bf0880a` `e0e8d73d` `893c0967` `c1b856c8` `cffa3b51` `542a7bdb` `bfb47bfc` `e4a188f2` | adopt; the export keeps the pasante release check and `OMITIDOS.txt`; the per-container export check (`6509fab4`) still takes every project verdict from `checkProjectAccess`, which applies C2 |
| Chat engine: one `read_workflow` verdict per turn | `ee6472f9` | adopt |
| Job pool tests, citation cache argument | `85838120` | adapt: LiTT's job-pool logging tests run through `createDbJobPool`, without upstream's Sentry assertions; the CourtListener half is rejected, no net change |
| Web: PDF viewer, document status polling | `62958411` `1eabc48a` `45e5f98a` `42b57273` | adopt; `mikeApi.ts` keeps LiTT's `errorReporting` type |
| Deployment notes (upgrade order, rollback) | `dbc3c927` | adopt |
| Merge of #749 | `d0a7ca75` | adopt |

Files with no net change against `main`: `verifyCitations.ts` and its test,
`playbooks.routes.ts` and its integration test (already in `main` through
cycle 2). Absent from both trees: `observability/sentry.ts`, its test and
`word-addin/e2e/error-reporting.spec.ts`.

### 24.2 Functions created or redefined, and LiTT C2

Comparing the last definition of every function in `schema.sql`, `main` to the
head, gives 210 signatures. 204 are identical, 5 changed and 1 is new
(`artifacts/upstream-sync-c5-20261107/function-comparison.txt`, outside the
repository). Three needed a LiTT migration:

- `org_members_departure_items` (`20261101_18`, M-S5): upstream finds the
  possible roots by departing user first. Its text lacks the matter exclusion
  (C2 point 3, `20261023_13`). It also sorts before
  `20261101_51_litt_departure_private_matter`, so a database that had run
  `_51` would lose the guard. `20261107_50_litt_departure_root_candidates_private_matter.sql`
  sorts after both. It re-creates upstream's new text with
  `and not exists (select 1 from public.matters mt where mt.project_id=item.id)`
  on the project roots, and that line is the whole difference.
- `ownerless_org_item_ids` (`20261101_17`, M-S4): upstream inlines
  `project_is_ownerless` as anti-joins with upstream's conditions. LiTT's
  `project_is_ownerless` also excludes matter projects, so upstream's list
  would let an organization owner take over a former member's matter project.
  `20261107_51_litt_ownerless_items_private_matter.sql` adds that condition.
- `organization_audit_events_page` (`20261101_19`, M-S6): upstream resolves
  the person filter among the organization's actors. Its text starts from
  upstream's page, which sorts by the address copied into each row. LiTT
  stopped copying addresses (`20261024_51_litt_account_erasure`) and sorts by
  the live profile. `20261107_52_litt_audit_username_filter_order.sql` keeps
  LiTT's order and takes upstream's filter. This is not C2, but without it
  upgraded databases would lose LiTT's order.

Each migration's body is byte-identical to the last definition in
`schema.sql`, in its LiTT section. The in-place upstream copies point to it.
On a database at `main`, the schema-drift replica applies upstream's
`20261101_15`…`_24` and then LiTT's three files, with no drift against a
fresh install.

The other three need no migration:

- `list_org_private_content` (M-S9) refuses unless
  `can_access_org_private_content`, which is false in LiTT.
- `backfill_document_text` (M-S2) and the new `wipe_memory_files` (M-B6) grant
  nobody access.

None of the range redefines `project_access_role`, `review_list_access`,
`document_text_access` or `can_access_org_private_content`.

Proof, in the schema-drift CI loop:

- `performance.litt-private-matters.sql` gains the ownerless case: a former
  member's matter project is not listed, and a plain private project in the
  same state is. The departure assertions now run on M-S5.
- `performance.litt-private-matters-controls.sql`, controls 4 and 5: upstream's
  `20261101_18` and `20261101_17` alone must leak the matter, and
  `20261107_50` / `20261107_51` must restore the guard.
- `performance.litt-audit-pagination.sql` covers the person filter and the
  live-profile order.
- Upstream's `performance.projects.sql` and `performance.workflows.sql` record
  the admin's opening directly, because `open_org_private_content` refuses in
  LiTT.
- `performance.private-catalogue.sql` first asserts that the owner is refused.
  It then checks upstream's per-kind paging with the permission switched on,
  inside its rolled-back transaction only.
- `littPrivateMatterLists.postgres.test.ts` (opt-in) runs the same swaps over
  the full assertion file.

In TypeScript, every reader that called `private_matter_denied_project_ids`
on `main` still does, and the release check and `OMITIDOS.txt` remain in the
documents ZIP export. Every tabular read that returns rows to a person (grid,
review chat, generation, export) still goes through `filterReadableReviewRows`.

### 24.3 Departure of a matter project's creator (cycle-4 review reservation)

The departure trigger (`cleanup_removed_org_member_overrides`, branch
`if org_is_team`) clears `user_id` on every project the leaver created,
matter projects included, and the matter exclusion keeps those projects out
of the departure items: they are not archived, not handed to the successor
and not "ownerless". That upstream function is unchanged.

The owner decided the rest on 2026-11-07 (§29.6, questions 1 and 2).
`20261107_70_litt_matter_succession.sql` adds a second departure trigger,
`org_members_matter_succession`, which runs after upstream's (triggers fire
in name order). It revokes the leaver's matter memberships and, on each
private matter left without an active owner, promotes the teammate with the
highest role. With no teammate left, it makes the departure's successor the
owner. The team reaches the project through overrides kept in step with
`matter_memberships`. `performance.litt-matter-departure.sql` (CI) fixes who
reaches the matters afterwards:

| Who | Private matter, team of four, private project (A) | Private matter, organization-visible project (B) | Private matter, only its creator (C) | Public matter (D) |
|---|---|---|---|---|
| Earliest editor | becomes owner | becomes owner | — | unchanged (editor of the matter; the private project is nobody's) |
| Other editor / viewer | keep editor / viewer | — | — | — |
| Successor chosen in the departure | no | no | becomes owner | no |
| Organization owner | no | no | no | no |
| Organization admin | no | no | no | no |
| Former creator | no | no | no | no |

Before this change, matter A was out of everyone's reach after the departure,
which contradicted the owner's 2026-10-24 rule that work inside a firm's
matters stays with the firm.

### 24.4 Owner-visible changes

Lists, reviews, exports, the audit search and the Word add-in respond faster
in large firms, with no change to what anyone can see. The Word add-in now
explains when a newer version updated the device's chats. The audit page
still sorts people by their current profile.

### 24.5 Dependabot

No Dependabot pull request is covered by this range. The open ones stay for
the dependency cycle (9 of 10).

## 25. Cycle 2026-11-07, 6 of 10

Pin `74aad3019efa903a8fb89ec9c07617b2ab61126a` (2026-11-04), the merge of
upstream #786. The range `d0a7ca75..74aad301` has 8 commits, one of them the
merge, and 10 files (+390/−23). Nothing after the pin is integrated.

### 25.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| Worker: PDF header check before anything is written (`%PDF-` anywhere in the first 1 KiB, as ISO 32000 Annex H and pdf.js allow; when the search misses, `countPdfPages` decides), terminal file code `invalid_pdf_file`, not reported as a fault | `ceedace6` `52d2f41e` `d7f9afae` | adopt |
| Web: a refused file is named with the reason, classified as the user's to fix, left out of Retry (`uploadOutcomeNeedsRetry`) in the documents table and workflow assets; a single refused file shown verbatim as a validation failure | `51c821d8` `cd546b8f` `8e4e9772` `35929c0e` | adopt |
| Merge of #786 | `74aad301` | adopt |

The only merge conflict is the comment of the missing-LibreOffice test in
`uploads.processing.test.ts`: LiTT keeps its comment without upstream's Sentry
issue id, and takes upstream's new byte stream for that test.

One LiTT commit adapts upstream's seven "accepts a PDF preceded by …" cases:
LiTT's `processCreatedDocument` reads the document's organization before the
update (pasante seal), so their fake database queues that empty read first,
as the other create tests in the file do. No product code changes.

### 25.2 LiTT checks

- **Error classification.** `invalid_pdf_file` is a per-file outcome code read
  from the upload file row, like `document_deleted` and `document_changed`; it
  is not a response `code`, so it does not belong in `CODE_KINDS` and the
  drift test is unchanged. The refusal reaches the user through
  `describeError`/`notifyError`: a single file through `UploadBatchError`
  with `userVisible`, `kind: "validation"` and `retryable: false`, which
  LiTT's classifier honours; a batch through `notifyPartialFailure` with no
  fault to report (`USER_SIDE_UPLOAD_CODES`). The copy names the file and
  says it is not a valid PDF; it does not name the product.
- **Telemetry.** The worker skips `reportError` for the refusal; in LiTT that
  is the local redacting logger. No Sentry, desktop or CourtListener path is
  added.
- **Training and copies.** The check runs in `processUploadFile` before every
  purpose, so it only adds a refusal. It does not touch the pasante seal of
  new documents and versions (the `pasante seal` tests in the same file still
  pass), the training lock of layer 1b or the `org_id` rule for copies.
  `processUploadFile` is the only ingress that writes uploaded bytes.
- **Word add-in.** It shares `uploadSessionClient.ts`; its typecheck passes
  with the new optional fields of `UploadBatchError`.

### 25.3 Owner-visible changes

A file named `.pdf` that is not a PDF (a renamed text file, a ZIP, an empty or
truncated file) is refused when it is uploaded. LiTT names the file, says it
is not a valid PDF and does not offer Retry for it. A real PDF with a few
bytes before its header is still accepted.

### 25.4 Dependabot

No Dependabot pull request is covered by this range. The open ones stay for
the dependency cycle (9 of 10).

## 26. Cycle 2026-11-07, 7 of 10

Pin `fa37b86d4add8e24286f54ef6a83b0a715a6ed96` (2026-11-04), the merge of
upstream #702. The range `74aad301..fa37b86d` has 9 commits, one of them the
merge, and 104 files (+2342/−1735). Nothing after the pin is integrated.

### 26.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| Service boundaries: cross-domain account, purge and export workflows move to `backend/src/application/` (`accounts/`, `exports/`, `jobs/`, `organizations/`); provider credentials to `lib/providerCredentials/` behind one facade; playbook types and schemas to `playbooks.types.ts` and `playbooks.schemas.ts`; project export and lifecycle to `projects.export.ts` and `projects.lifecycle.ts`; `lib/serviceData.ts` limited to the legacy throw helper | `877f4598` `1f764484` | adapt |
| Export reads paged by key and batched with the shared query helpers | `a66ef7ac` | adapt |
| Tests moved beside their owners; architecture and dependency-cycle gates | `c9e487ed` `1bc85db1` `c01d7ac6` `38ec9bb9` `2a87c9a4` | adapt |
| Merge of #702 | `fa37b86d` | adapt |

The merge stops on 18 content conflicts and 2 modify/delete conflicts. The
modify/delete pair is `user.courtlistener.ts` and its test: CourtListener stays
removed, so both are deleted again. Every content conflict is a file LiTT had
changed that #702 moves or splits; the rule is to carry LiTT's logic to the new
location, not to keep the old one.

### 26.2 Where LiTT's logic now lives

| LiTT logic | Before | Now |
|---|---|---|
| Account erasure (owner decision 2026-10-24): queued job, receipt with the 30-day backup note, confirmed-email matching, audit and AI evidence kept as "Deleted user" | `modules/user/user.accountJobs.ts`, `user.account.ts` | `application/jobs/accountDelete.ts`, `application/accounts/deleteAccount.ts` |
| A private matter's project is deleted only if the leaving person may still delete it | `modules/user/user.dataCleanup.ts`, `user.account.ts` | `application/accounts/dataCleanup.ts`, `application/accounts/clearAccountData.ts` |
| Training data erased with the account | SQL: `prepare_account_org_departures` and the departure path in `schema.sql`, called when the erasure is requested | unchanged; the range changes no SQL |
| Data export with the holder's training data | `modules/user/user.dataExport.ts` | `application/exports/buildJsonExport.ts`, now through the keyset helpers; `training_mentors` and `training_pupils` have no `id`, so they page on `org_id`, unique for one person |
| Readable review cells and transcripts in the export | `modules/user/user.dataExport.ts` | `application/exports/buildJsonExport.ts` |
| Documents ZIP: pasante release check and `OMITIDOS.txt`; C4 authorization stamp | `modules/user/user.exportJobs.ts` | `application/exports/buildExport.ts`; the queue adapter is `application/jobs/exportBuild.ts` |
| C4 stamp when an export is requested; LiTT file names | `modules/user/user.export.ts`, `user.dataExport.ts` | `application/exports/requestExport.ts`, `buildJsonExport.ts`, `modules/projects/projects.export.ts` |
| Governed BYOK: `opencode-zen`, no CourtListener, organization key scope with `allow_personal_api_keys`, no silent fallback | `modules/user/user.apiKeyStore.ts` | `lib/providerCredentials/store.ts` and `types.ts`; `user.chatRoute.ts` reads it through `lib/providerCredentials/index` |
| Pinned playbook route and C4 stamp on import and review work | `modules/playbooks/playbooks.operations.ts` | `playbooks.operations.ts` and `playbooks.types.ts` |
| No organization or organization-data deletion route (405) | `modules/orgs/orgs.routes.ts` | unchanged; the upstream purge workflow in `application/organizations/purgeContent.ts` is not reachable from any route |

LiTT's own tests move with their owners and none is deleted:
`user.dataExport.training`, `user.exportEpoch` and `user.exportFilename` to
`application/exports/__tests__/`, `user.exportJobs.trainingLock` to
`application/jobs/__tests__/`, and `user.operatorEndpoint` to
`lib/providerCredentials/`. The playbook suites mock the credential facade as
well as the user facade, keeping the real module for everything else.

### 26.3 LiTT checks

- **Architecture.** `architecture.test.ts` passes with upstream's new rules
  (application workflows are HTTP-agnostic, only the credential facade is
  imported from outside it). `dependencyCycles.test.ts` lists the
  applications to scan; LiTT has no desktop app, so the list is backend, web
  and Word, and the documentation says the same.
- **Telemetry.** The moved files keep LiTT's local reporter
  (`lib/observability/report`); none imports `observability/sentry`.
- **CourtListener.** No runtime path names it; `courtlistenerExclusion.test.ts`
  still passes.
- **SQL.** The range changes no migration or `schema.sql`.

### 26.4 Owner-visible changes

None. The reorganization changes where the code lives, not what a lawyer sees.
The export of a large account is read in pages, so it does not stop early on a
capped database response.

### 26.5 Dependabot

No Dependabot pull request is covered by this range.

## 27. Cycle 2026-11-07, 8 of 10

Pin `05d9aebcd30e6d9aef4d7190dfa0833475dd2500` (2026-11-04), the merge of
upstream #703. The range `fa37b86d..05d9aebc` has 7 commits, one of them the
merge, and 448 files (+1309/−1054). Nothing after the pin is integrated:
`e0e76ff2` (#798, shared abort-error imports) belongs to cycle 9. The local
build does not need it: the three files it touches do not import
`isAbortError` in LiTT.

### 27.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| `frontend/src/shared` moves to `packages/ui` (`@mike/ui`, React primitives) and `packages/client` (`@mike/client`, framework-free client behavior), each behind one barrel; consumers import by name; aliases, tsconfigs, webpack, Next, Vitest and both Dockerfiles follow | `a1c87117` `d03c4713` | adapt |
| React aliasing, linear-time regexes, build and diagnostic wiring after the rebase | `f9a79d69` `ac841cad` `6b8f4e85` | adapt |
| Executable import boundary (architecture rule 5) | `821c0131` | adapt |
| Merge of #703 | `05d9aebc` | adapt |

The merge stops on 32 content conflicts, 14 modify/delete and 8 rename/delete
conflicts and 15 file-location conflicts. Every modify/delete and
rename/delete is a file LiTT had retired (the Sentry SDK and its event
hygiene, `releaseName`, `desktop/`, `docs/sentry-data-audit.md`,
`docs/observability.md`, the `sentryTunnel`, `operationReporting`,
`releaseVersion` and `diagnosticVocabulary` tests): the deletion is kept. The
file-location conflicts are LiTT's own files under `frontend/src/shared`; they
follow the directory rename into the packages. The content conflicts are
import lists and build configuration.

### 27.2 Where LiTT's code now lives

The full table, one row per LiTT file, is in the cycle's evidence
(`mapa-traslado.md`). By area:

| LiTT code | Before | Now |
|---|---|---|
| Identity v1.0: wordmark and pixel monogram, brand and theme tokens | `frontend/src/shared/ui/LittBrandUI.tsx`, `ThemeTokensUI.css`, `DesignTokensUI.css` | `packages/ui/src/LittBrandUI.tsx`, exported from `@mike/ui`; `packages/ui/styles/` |
| AGPL-3.0 §13 source link (TD-016) | `frontend/src/shared/lib/sourceCommit.mjs` and `.d.mts`, `ui/SourceCodeLinkUI.tsx` | `packages/client/src/sourceCommit.mjs`, exported from `@mike/client`; `packages/ui/src/SourceCodeLinkUI.tsx`, exported from `@mike/ui`. `next.config.ts` imports `resolveSourceCommit` from `@mike/client`; `word-addin/webpack.config.js` loads the file by path |
| Training 1a/1b: attempt field, coach notes, the "pending approval" hold that hides downloads, per-turn notes | `frontend/src/shared/ui/Training*UI.tsx`, `hooks/useTrainingTurnNotes.ts` | `packages/ui/src/`, exported from `@mike/ui`; `@mike/ui` declares `@mike/contracts` as a type-only peer for `TrainingTurnNote` |
| `CODE_KINDS` with LiTT's `training_*` codes and its drift test | `frontend/src/shared/lib/userError.ts` | `packages/client/src/userError.ts`; `codeTable.drift.test.ts` reads it from `@mike/client` |
| LiTT model catalog, toggle and excerpt changes | `frontend/src/shared/lib/modelCatalog.ts`, `ui/ModelToggleUI.tsx`, … | the same file names under `packages/client/src` and `packages/ui/src`, with LiTT's lines intact |
| Word add-in: `@source` entries for LiTT's shared files; provider «LiTT» in the manifest | 40 per-file `@source` entries and per-file `@mike/*` aliases | one `@source "../../../packages/ui/src"` and the `@mike/ui` / `@mike/client` aliases; the manifest is unchanged |
| Frontend image: two-stage standalone build | runtime copied `/app/.next/standalone` | the build runs in `/app/frontend` with the trace root at `/app`; the runtime copies the nested standalone tree and starts `frontend/server.js` |

No LiTT test is deleted: the tests of moved files move with them and run in
the frontend's Vitest, which now includes `packages/*/src`.

### 27.3 LiTT checks

- **Telemetry.** The `@mike/client` barrel exports no Sentry module; no
  runtime file, `package.json`, Dockerfile or build config names Sentry.
- **Identity.** No blue is added and no visible text says «Mike»; the internal
  names (`@mike/ui`, `@mike/client`, `MikeIcon`) stay, as AGENTS.md requires.
- **Images.** The frontend and add-in images build locally from the repository
  root; the frontend image answers `/login` and embeds the build's `GIT_SHA`,
  and the add-in bundle embeds it too.
- **Architecture.** Upstream's rule 5 passes with LiTT's files in the
  packages.
- **SQL.** The range changes no migration or `schema.sql`.

### 27.4 Owner-visible changes

None. The move changes where shared code lives, not what a lawyer sees.

### 27.5 Dependabot

No Dependabot pull request is covered by this range.

## 28. Cycle 2026-11-07, 9 of 10

Pin `b91d1bdf4b7cdcbbe28def2aef4630bde1729a49` (2026-11-05), the merge of
upstream #798. The range `05d9aebc..b91d1bdf` has 50 commits, 10 of them
first-parent merges, and 51 files (+2038/−1475). Nothing after the pin is
integrated. No migration or `schema.sql` change is in the range.

### 28.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| #788 Dependabot: priority-2 production and priority-3 development groups for the root, backend, frontend and Word add-in, `@types/node`, `@types/office-js` kept at 1.0.615, `docker/login-action` | `01cbfe50` `8746f450` `a81b8658` `3cdaf46f` `4b05510b` `e4898270` `70a4d61f` `f8566eff` `63ea9614` `d36fca69` `4fbfed25` `3ae8da8a` `ee32e735` `2a87c3c8` `3866badc` `3f40d305` `9330d596` `9fc032a3` | adopt, without the `@sentry/*` packages; `docker/login-action` lives only in `publish-images.yml`, which LiTT deleted (no net change) |
| #797 startup hardening: placeholder, whitespace-only and short secrets refused at boot; 15 s model-catalog timeouts; least-privilege `permissions` in the remaining workflows; the local e2e stack fills throwaway secrets; deployment notes on rotation | `39bdb938` `0d6c93ef` `a582b462` `6e5855e9` `33afc161` `135dadd2` `425427b8` `772a10ae` `4b3fbe56` `88539c64` `25bd887d` | adopt, except the `stack-script.yml` half of `33afc161`/`772a10ae` (the workflow stays deleted, ledger §16) |
| #797 missing `user_profiles.mfa_on_login` column | `461f9338` `c4a032e4` | adapt: LiTT keeps the fail-closed lookup (generic 500); upstream's once-per-process report names the missing column; the test asserts the refusal |
| #715 README anchor | `29390435` `877d1b77` | adopt: LiTT's `CONTRIBUTING.md` has the `Mike Workflows` heading, so the anchor was broken; the rest of the README is LiTT's |
| #750 release publication follow-up | `132b7edc` `71d81f04` | reject (Sentry and image publication); every file stays deleted or LiTT's, so no net change |
| #699 weekly cleanup: shared `isAbortError`, unused playbook class | `df03c043` `5af2d20f` `38ba1abe` | adopt |
| #755 delegate calls without a title | `36e4e623` `2127826c` `8061e967` | adopt: only the title defaults to `Subagent`; route resolution, the pinned model and the fail-closed route are unchanged |
| #725 audit canary isolation | `851989a5` `12ff4976` | adopt |
| #757 stop notices outside hidden citation blocks | `6bf54c22` `94cdbed5` `70786b18` | adopt |
| #704 spreadsheet cells kept when a side-panel tab reopens | `c0b1ab06` `7a48d9f1` | adopt |
| #798 shared abort-error imports | `e0e76ff2` `b91d1bdf` | adopt |

The merge stops on 10 content conflicts and 6 modify/delete conflicts. Every
modify/delete is a file LiTT retired (`publish-images.yml` and its
`releaseVersion` test, `sentry.test.ts`, `docs/observability.md`, the
`/monitoring` route test, `stack-script.yml`): the deletion is kept. The
content conflicts are the three `package.json` files and their lockfiles
(upstream's versions without Sentry; the lockfiles are upstream's, pruned with
`npm install --package-lock-only`, adding no package), `.env.example` and
`errorReporting.ts` (LiTT's Sentry-free versions), `e2e.yml` (upstream's
`permissions` with LiTT's concurrency note) and `auth.ts` (below).

Without net change against `main` (byte-identical): `.env.example`,
`frontend/src/app/lib/errorReporting.ts` (upstream changed only Sentry
comments) and the six retired files above.

### 28.2 LiTT checks

- **Secrets at boot.** `validateRuntimeConfiguration` refuses
  `DOWNLOAD_SIGNING_SECRET=replace-with-a-random-32-byte-hex-string` and
  `USER_API_KEYS_ENCRYPTION_SECRET=your-long-random-secret` (the
  `backend/.env.example` values), and any set value of either variable that is
  shorter than 32 characters after trimming, whitespace-only values included.
  Unset values still pass and fail on first use. `deploy/prod/compose.yaml`
  requires both variables and `deploy/prod/README.md` generates them with
  `openssl rand -hex 32`; `compose.staging.yml` requires its own values; the
  README and `docs/local-development.md` already told local users to generate
  both. `scripts/e2e-local-stack.sh` fills CI's throwaway values;
  `scripts/local-secrets.test.sh` passes locally and does not run in CI, as
  `stack-script.yml` stays deleted.
- **Login MFA.** An unreadable `mfa_on_login` (the missing column included)
  is not "MFA is off": the request keeps getting the generic 500, and the
  missing column is named once per process as `auth.login_mfa_column_missing`.
- **Subagents.** #755 changes only the title; the named-route resolution and
  its fail-closed refusal are untouched (TD-044, TD-045 unchanged).
- **Telemetry.** No `@sentry/*` package, runtime import, env variable or
  workflow is added; `132b7edc` has no net change.
- **Identity.** No blue is added and no visible text says «Mike».
- **Audit allowlist.** The range does not touch `scripts/audit-allowlist.json`;
  the braces exception (`GHSA-vfj7-8cjw-p6xm`) stays while braces has no
  patched release.

### 28.3 Owner-visible changes

- A delegated task without a title shows «Subagent» instead of failing.
- A cut-off answer shows its warning even inside a citation block.
- A spreadsheet reopened in the side panel keeps its cells.
- An operator whose `.env` still holds a template secret sees the backend
  refuse to start, with the variable named.

### 28.4 Dependabot

The range covers LiTT's open Dependabot pull requests #50–#55: each version
they raise is at or above theirs in this cycle's `package.json` files. They are
closed with a comment pointing at this cycle.

## 29. Cycle 2026-11-07, 10 of 10

Pin `366fa4e92e5734c31910df848d293899d98ebc50` (2026-11-06), the merge of
upstream #777 and `upstream/main` when the cycle was cut. The range
`b91d1bdf..366fa4e9` has 66 commits, 7 of them first-parent merges, and 66
files (+3270/−311). No migration or `schema.sql` change is in the range. With
this cycle **LiTT is up to date with upstream at `366fa4e9`**: the ten cycles
of the 2026-11-06 intake are complete.

### 29.1 Classification

| Group | Commits | Disposition |
|---|---|---|
| #793 one failure, one report: a GoTrue outage answers API routes with 503 `upstream_unavailable` instead of a sign-out; only an unreachable GoTrue (no answer, 502/503/504) counts as an outage; a missing column (42703) and an ambiguous RPC (PGRST203) are schema drift; schema drift is reported once per process per route or operation, with an hourly reminder; clients do not report a 5xx the server already reported; the web app keeps the session during an outage | `0a322840` `bfe3d344` `a65566a6` `671f9288` `3e4ab0b0` `08bdc1d9` `ebbc30a9` `7a081bb9` `aa8b8364` `a2f4323c` `f1e8dffa` `163973cf` `a85eded5` `382c5084` `b32cb058` `6e1a2ac1` `4f75f743` `d1b97b65` | adapt: every report goes through the local seam `lib/observability/report.ts` (sanitized `[report]` lines, allowlisted tags only); the web and Word `errorReporting.ts` stay LiTT's no-op seams; login MFA stays fail-closed (29.2) |
| #779 session refresh without fan-out: one refresh per page-load burst shared only by callers already waiting, no cookie written after the response, a refused cookie session is 401, `retry-after: 5` on every `upstream_unavailable`, a single retry of an unreachable session check | `eb31091a` `9bc94787` `b9f0ead8` `a6f37810` `156d0fde` `4496d584` `7ef04aa1` `0cdd0b3b` `698917d8` `e15cd4fc` `4140befb` `9af2b163` `5e8fb458` `c839605a` `dde8fde1` `763f28ec` `cddcb4dc` `6443b718` `c342e823` `22ea9f61` | adopt the session and 503 behaviour; adapt the reporting comments and tests to the local seam |
| #782 Sentry off in development builds (`buildMode.ts`, `SENTRY_SOURCE_RUN_IS_INSTALL`, DSN resolution, README and `.env` examples) | `8dc204d3` `1dc4e2b7` `576c70a7` `161dc3ba` `60908a6a` `45c135b9` `ecc20a1b` `1a6fb62c` `784cd578` `80a73278` `890247e4` `b6513142` `d281a677` `3513f36b` | reject: no third-party telemetry. `buildMode.ts` is used only by the Sentry client, so it is not added; every other file has no net change |
| #799 parser children in Electron's Node mode | `9b77c4f0` `12a94a19` | reject the desktop half (LiTT has no desktop app): `isolated.ts` has no net change. The test that an ambient `ELECTRON_RUN_AS_NODE` is not forwarded to the parser is kept: the parser environment is an allowlist |
| #800 document search starts in a new chat (e2e) | `cd8dd53c` `75f4838c` | adopt |
| #801 packaged desktop extraction smoke | `9d400b58` `26900f82` `ecafe693` | reject: `desktop/` stays deleted, no net change |
| #777 typed `find_documents` failure: a database error is a typed `chat.document_search_failed` report, at warning level for a timeout or an unreachable database; the local log line keeps the category and the allowlisted `failure_code` | `3bfb16a8` `d8cdcf82` `db0e35b9` `b261dc34` `627428cf` `5d7f6397` `366fa4e9` | adopt, reporting through the local seam |

The merge stops on 19 content conflicts and 8 modify/delete conflicts (27
paths). Every modify/delete is a file LiTT retired (`sentry.ts`,
`sentry.test.ts`, `packages/client/src/sentryEvent.ts`,
`docs/observability.md`, `desktop/README.md`, `desktop/e2e/local.e2e.mjs`,
the Word `error-reporting.spec.ts` and `operationReporting.test.tsx`): the
deletion is kept.

Without net change against `main` (byte-identical): `README.md`,
`backend/.env.example`, `frontend/.env.local.example`,
`word-addin/.env.example`, `backend/src/lib/extraction/isolated.ts`, the web
and Word `errorReporting.ts`, `errorReporting.test.ts`,
`frontend/src/wordAddin/errorReporting.test.tsx`, `mikeApi.test.ts`, and the
retired files above.

### 29.2 LiTT checks

- **Login MFA.** An unreadable `mfa_on_login` is still a refusal, never "MFA
  is off". A missing column (42703) is now schema drift: the request answers
  503 `schema_out_of_date`, and the gate writes one error-level
  `schema_out_of_date` report under `operation: auth.login_mfa` per process
  (the consequence reads "authenticated requests are refused until the
  migration runs"); `sendInternalError` adds no second report for it. Any
  other lookup failure is still the generic 500.
- **Session.** A GoTrue outage keeps the user signed in: API routes answer 503
  `upstream_unavailable` with `retry-after: 5`, no session cookie is cleared,
  and the web app retries. A GoTrue 500 stays a reported 500.
- **Error messages.** Web and Word show the fixed sentences of
  `packages/client/src/reportedUpstream.ts` through `describeError` /
  `notifyError`; the backend copy (`reportedUpstreamCodes.ts`) is kept equal
  by `reportedUpstreamParity.test.ts`. `upstream_unavailable` was already in
  `CODE_KINDS`; no new client-acted code is added.
- **Document search (#777, #800).** Only the reporting of a failed
  `find_documents` changes. `find_document_text`, `document_text_access` and
  the private-matter guard (C2) are untouched; the range has no SQL.
- **Telemetry.** No `@sentry/*` package, runtime import, environment variable,
  file or workflow is added; the runtime word count of «sentry» stays 0.
- **Identity.** No blue is added and no visible text says «Mike».

### 29.3 Owner-visible changes

- When the sign-in service is briefly down, LiTT keeps the lawyer signed in,
  says «The server is temporarily unreachable. Please try again shortly.» and
  retries, instead of sending them back to the login page.
- An install whose database is missing an update shows «The server's database
  needs an update…» on the affected screen, and the operator log names the
  missing object once, with the commands to run.

### 29.4 Dependabot

No Dependabot pull request is covered by this range.

### 29.5 The ten cycles of the 2026-11-06 intake

| Cycle | Pin | LiTT PR | Decision |
|---|---|---|---|
| 1 (§20) | `1f7ae19f` | #61 | chat list adapted with the private-matter guard; named upload failures, onboarding model step and settings search adopted; Sentry tunnel rejected |
| 2 (§21) | `14d695f1` | #62 | playbook ids checked before Postgres, extended to share and source ids; Word advisories adopted; Sentry filter rejected (no net change) |
| 3 (§22) | `27683564` | #63 | #749 30-Oct SQL performance adopted; departure items adapted with the matter exclusion |
| 4 (§23) | `31539729` | #64 | #749 1-Nov SQL adopted; `project_access_role` and departure items adapted with LiTT migrations `20261101_50`/`_51` |
| 5 (§24) | `d0a7ca75` | #65 | #749 3-Nov SQL adopted; ownerless items, departure roots and the audit page adapted; private catalogue kept closed |
| 6 (§25) | `74aad301` | #66 | #786 PDF upload validation adopted |
| 7 (§26) | `fa37b86d` | #67 | #702 service boundaries adopted; LiTT account erasure, exports, BYOK and playbook rules moved to the new files |
| 8 (§27) | `05d9aebc` | #68 | #703 shared packages adopted; LiTT brand, AGPL link and training UI moved to `@mike/ui` / `@mike/client` |
| 9 (§28) | `b91d1bdf` | #70 | #788 dependencies and #797 startup hardening adopted without Sentry; login MFA kept fail-closed |
| 10 (§29) | `366fa4e9` | #72 | #793/#779 stable session and one report per failure adapted to the local seam; #782, #801 and the desktop half of #799 rejected |

### 29.6 Open product questions recorded during the cycles

Questions 1 and 2 were resolved by the owner on 2026-11-07 and implemented in
`20261107_70_litt_matter_succession.sql`. Question 3 is still open; its rule
stays as it is until the owner decides, and a test pins today's behaviour.

1. **Private project inside a matter (W2, cycle-3 review, recorded in §23.3).
   Resolved by the owner on 2026-11-07.** The whole active team of a private
   matter reaches its project, each member with their matter role
   (`matter_owner` → owner, `editor` → editor, `viewer` → viewer), whatever the
   project's own visibility. Nobody outside the team reaches it: an
   organization owner or admin is not on the team just by holding that role.
   Public matters are unchanged.
2. **Matter left unreachable when its creator leaves (cycle 5, §24.3).
   Resolved by the owner on 2026-11-07.** The matter stays with its team. When
   the leaver was the last active `matter_owner` of a private matter, the
   active teammate with the highest role becomes `matter_owner` (editor before
   viewer; the earliest member on a tie). With no teammate left, the successor
   chosen for the departure becomes `matter_owner`. An organization owner or
   admin can list the matters left without an owner (no titles) and name any
   current member of the firm, themselves included, as the owner of one of
   them. A matter with an active owner is refused (`matter_has_owner`, enforced
   by `assign_matter_owner`): naming never displaces or demotes an owner, so
   it cannot take a private matter from its team. Every succession and
   appointment is audited without the matter's title.
3. **Private catalogue without a matter exclusion (cycle 5, §24.2).**
   `list_org_private_content` is safe today only because
   `can_access_org_private_content` is false in LiTT. If the private catalogue
   is ever opened, it must first exclude matter content.

## 30. LiTT changes inside upstream hot zones

Files upstream edits often. A LiTT change here must be re-applied by hand when
an upstream cycle rewrites the same lines; the test named in each row fails if
it is lost.

| LiTT change | Files | What to keep on conflict | Test |
|---|---|---|---|
| Interface language per user (i18n I18N-0B, 2026-11-07): `user_profiles.ui_locale` (`en-US`, `es-MX` or null = automatic), migration `20261107_80_litt_user_ui_locale.sql` | `modules/user/user.profile.validation.ts` (`uiLocale` in `PATCH /user/profile`), `user.profile.serialization.ts` (`uiLocale` in the profile), `user.profile.storage.ts` (`ui_locale` in the newest select plus its own retry tier), `user.profile.operations.ts` (copy to GoTrue `user_metadata.locale`), `modules/auth/auth.service.ts` (`locale` in sign-up, sent as `data.locale`), `lib/uiLocale.ts`, `UiLocale` in `packages/contracts` | The `uiLocale` field and its validation, `ui_locale` at the end of `PROFILE_SELECT_NEWEST` with the `PROFILE_SELECT_NO_UI_LOCALE` tier, and the metadata copy after the profile update. If the copy to GoTrue fails, the profile keeps the saved value, the request still succeeds and a warning is logged; the emails use the previous metadata value until the next successful save. | `user.routes.test.ts` (`PATCH /user/profile uiLocale`); `auth.test.ts` (sign-up language); `buildJsonExport.access.test.ts` (profile export) |
