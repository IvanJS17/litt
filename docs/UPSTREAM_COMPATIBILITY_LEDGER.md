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
| Fresh schema and upgrades | Canonical fresh schema plus schema-drift fingerprint workflow | Fresh and supported incremental paths converge; security grants/policies preserved | combine | One consolidated fresh schema and a new collision-free recovery migration series from the integrated LiTT baseline | Beta integration; coordinator scaffold | schema, migrations, fingerprint script | coordinator only | fresh bootstrap; supported upgrade; fingerprint equality; security invariants | high: divergent schemas and duplicate stems | TD-003 | 0 |
| Password/session auth | HttpOnly cookies, trusted-origin checks, session endpoints | MFA default-on and no tenancy bypass | combine | Upstream auth stack with LiTT MFA/tenancy guards | schema/auth contract | middleware, auth/user routes, contexts | Slice A domain services/tests only | login/recovery/session/origin/MFA matrix | user profile/trigger convergence | TD-004 | 1 |
| Google OAuth and Word handoff | OAuth exchange plus single-use handoff tickets | onboarding creates exactly one initial organization with an active `org_owner` membership; no initial workspace/matter; tokens remain distinct | combine | Cookie web flow and one-time Word handoff; idempotent organization provisioning shared by password and OAuth completion; no browser Bearer fallback | resolved owner decision in section 11 | auth schema/routes/client contexts | Slice A tests and non-shared onboarding service | one-use/expiry; OAuth/password cannot bypass MFA/tenancy; retry cannot duplicate tenant | auth tickets, profile triggers and organization membership transaction | none for initial defaults | 1 |
| Organizations/workspaces/matters | Upstream lacks LiTT’s complete private-tenancy model | org/workspace/matter roles, private matters, outsider 404 | port | Backend-mediated tenancy mutations; RLS defense in depth; invitations require an explicitly selected valid role and never infer one | schema scaffold | schema/access/audit/app | Slice A `tenancy.ts`, new domain services/routes excluding shared registration | cross-tenant matrix; private matter; explicit-role invitation/onboarding | new consolidated tables/policies/functions | none for invitation default semantics | 1 |
| Revocation and epochs | Ordinary current-session authorization | revocation effective during long mutations | port | Organization authorization epoch checked before every sensitive write | tenancy model | schema/access/audit | Slice A tenancy/AI access helpers and focused tests | stale epoch and revocation race negatives | epoch columns/functions/triggers | none after interface freeze | 1 |
| RLS and service role | Narrower backend-mediated posture but different grants | no browser bypass; insert-only evidence; least privilege | port + reject broad grants | Per-table grants plus RLS and backend authorization; no blanket post-migration grant | schema convergence | schema/migrations/security script | coordinator; Slice A tests | RLS coverage; service-role route guard; negative DML | substantial grant reconciliation | TD-003/004 | 1 |
| Audit | Mutable upstream audit table | insert-only, scoped, sanitized audit detail | port | One consolidated append-only `audit_events` model and one audit module | tenancy schema | schema/migrations/audit | Slice A callers/tests outside shared module | service-role UPDATE/DELETE denial; scoped detail | incompatible table definitions | retention ADR for erasure | 1 |
| Account/project deletion | Upstream cleanup removes user/project rows and audit | append-only evidence cannot be silently purged | adopt orchestration, defer evidence deletion | Fail-closed destructive API until retention ADR; cleanup non-evidence resources deterministically | retention decision | schema/userDataCleanup/shared routes | later coordinator integration; no writer policy invention | blocked destructive endpoint; retained-evidence matrix | deletion order and privileged path are not implementable before the retention ADR | TD-008 | before E completion |
| Document access/downloads | Folder upload, multi-select, pagination, storage wrappers | matter-private access, hashes, single-use grants | combine | Upstream document UX/storage core behind LiTT tenancy and grant service | Slice A integrated | schema/access/shared project/document routes | Slice B document/storage services, components, tests | prefix confinement; expiry/single-use; conflict/bounded concurrency | grant/table reconciliation | deletion depends on retention | 2 (parallel lane 1) |
| Provider runtime | Vercel AI SDK, routers, streaming, tool batching | governed BYOK and actual-route provenance | combine | Upstream AI SDK adapters with LiTT route resolution before dispatch | Slice A; provider interface scaffold | llm types, keys, chat streaming, schema | Slice C provider adapters, governed route resolver, tests | provider/model matrix; tool streaming; fail-closed errors | user keys/chat route columns | TD-005 | 2 (parallel lane 2) |
| Model selection and fallback | Explicit routers plus observable fallback for stale preferences | explicit/pinned requests never silently fallback | combine | Throw on request-path invalid route; normalize only stale saved preference with warning | provider runtime | shared provider/API types | Slice C router/model modules/tests | retired model; stale preference; explicit invalid route | preference/profile columns | provider support decisions | 2 |
| Credentials | One user key/provider plus env/router keys; OAuth stores tokens separately | multiple versioned `credential_ref`; membership/API/access/refresh separation | port | Encrypted multi-credential store; declared env/user source; rotation invalidates old pin | schema scaffold | schema/userApiKeys/types | Slice C non-shared resolution modules/tests | rotation, disabled key, missing key, no secret leakage | user_api_keys consolidation | BYOK for Vercel/OpenCode decision | 2 |
| Egress/fakes | Provider SDK and model-catalog network paths | explicit allowlist/provenance; default CI makes zero real calls | port | One provider/network choke point; fake interception precedes every SDK fetch; unexpected host aborts | provider runtime | chat streaming/workflows | Slice C provider egress modules/tests | host allowlist; zero-call negative; catalog fetch doubles | none beyond provider schema | allowed real providers deferred to G6 | 2 |
| Workflow catalog | DB-backed versioned catalog, packs, add-ons, quick actions, reference assets | governed content and immutable executed hash | adopt | `mike_workflows` is sole catalog; atomic sync and content-addressed assets | provider interface; catalog schema scaffold | schema/app/API types | Slice D catalog/sync/routes/tests outside shared files | sync idempotence; install/default; asset hash | catalog tables/RPC | none | 3 (parallel lane 1) |
| Civil/Mercantile MX playbook | No LiTT playbook in current catalog | stable id/version/source/approval/hash; R4/R6/R9; no authority overclaim | port | Governed catalog row/content with MX provenance and receipt hash; retire `systemWorkflows.ts` | catalog | schema/API receipt type | Slice D playbook content/loader/tests | hash round-trip; source/version; executed receipt immutability | seed/catalog content | legal validation remains later gate | 3 |
| Web assistant and citations | Current assistant, streaming, history, shared UI | governed route display, verified citations, matter/document scope | combine | Upstream UI shell/hooks with frozen LiTT API/provenance interfaces | Slices A/C/D interfaces | mikeApi, contexts, useAssistantChat | Slice E0 new AI/review UI scaffolding and non-shared components | soft navigation; mid-stream chat switch; late citation frames | none initially | cannot claim parity before E1 | 3 (parallel lane 2 scaffold only) |
| AI executions/receipts/citations | Upstream chat/workflow execution model | append-only pages/outputs/receipts, hashes, actual route/workflow provenance | port | LiTT evidence state machine on upstream provider/catalog contracts | A/C/D integrated; retention decision for destructive paths | schema/audit/API types | Slice E1 AI evidence libs/routes/tests outside shared files | hash/citation integrity; append-only negatives; revocation races | full `ai_*` reconciliation | TD-008 before deletion claims | 4 |
| Human review/approved DOCX | General UI/workflow review surfaces | different reviewer; reject/edit/accept; no pending item on approval | port | LiTT review state machine and approved artifact service on current web UI | execution evidence | schema/API client | Slice E1 review/report services, components, tests | reviewer separation; transitions; approved DOCX content | review/export tables | retention ADR for destructive path only | 4 |
| Word taskpane/chat/history | Document-scoped chat, history, Direct/Review, tracked edit persistence | no cross-document/matter use | adopt | Use upstream add-in wholesale as shell; current Word identity/settings and edit-card UI | frozen auth/provider/workflow APIs | Word API/useWordDoc/stream parser | Slice F taskpane UI/features/tests excluding shared paths | upstream Chromium/WebKit suite; document switch/history | upstream word tables retained | Word host matrix deferred beyond bounded gate | 5 |
| Approved redline apply | Upstream stream-edit parser and tracked edits | reviewed bundle identity, source hash, span revalidation, no partial write | port | Dedicated `approvedRedline.ts` contract plus panel integrated into upstream taskpane; authoritative bundle remains backend evidence | Slice E approved bundle API | schema/Word API/useWordDoc/new module | Slice F panel/UI and E2E; coordinator writes core module/hooks | tamper/scope/source/span/supersession/Save-As/multi-occurrence | bundle tables reconciled | TD-007 | 5 |
| Drive publication | Upstream storage capabilities; no LiTT governed publication journey | approved artifact only; fresh authorization; idempotence/unknown outcome/rehydration | port | Matter-bound publication service and state machine; fake first, real canary later | Slice E/F artifacts | schema/app/shared API | Slice G Drive services/settings UI/tests | fake upload once; retry/unknown outcome; rehydrate; outsider deny | publication tables/retry fields | TD-010 real canary | 6 |
| CI and schema gates | Rich CI, schema drift, stack, mutation, load, Word workflows | LiTT security checks, Beta parity, zero real calls | combine | Coordinator composes workflows after each slice; mutation/load on-demand until parity | all slice contracts | workflows, root manifests, scripts | coordinator only; writers report focused commands | exact-head CI; schema convergence; security; Word; Beta | none | coverage/performance TD-011/12/17 | each integration + Phase 3 |
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
restores shared history. Results per slice are appended here when each slice
lands.

| Slice | State | LiTT tree | Reviewer |
| --- | --- | --- | --- |
| S1 migrations and schema | pending | | |
| S2 tenancy and access | pending | | |
| S3 backend LiTT delta | pending | | |
| S4 frontend LiTT delta | pending | | |
| S5 Word add-in | pending | | |
| S6 CI and e2e | pending | | |
| S7 reverts | pending | | |
| S8 documentation and merge | pending | | |

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
   from a region or location. The owner's condition for the own endpoint is
   that a configured base URL can never reach loopback, private ranges,
   link-local or cloud-metadata addresses, checked on every hop. Target:
   `custom` and `openai-compatible` both go through `guardedFetch`, with a RED
   test per provider. Ollama stays as both sides have it today and is the one
   deliberate exception: its address comes only from the deployment
   environment (`OLLAMA_BASE_URL`, default `http://localhost:11434/v1`), never
   from a user, and its models are listed only when that server answers
   (`GET /models/ollama`). No user-facing field may ever set it.
2. **Playbooks.** Upstream playbooks are not a second system catalog: they are
   user- or organization-authored rule sets in their own `playbooks` table with
   no version, source or hash, and upstream seeds none. Correction:
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
   followed by a 500. The unit test mocks a `user_id` column and expects 204.
   Correction: account deletion, and any other path that would erase evidence,
   refuses before its first mutation until TD-008 is implemented.
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
| Audit | Mutable `audit_events` (uuid, `user_id`, `action`, `detail`); `audit_event_org` rewrites attribution on insert or update; organization activity log with actor filter, pagination and display names; audited access to private content; recoverable deletion and purge | Insert-only `audit_events` (bigint, `actor_user_id`, `event_type`, `event_detail`) with `audit_events_insert_only`; attributed `organization_id`; AI evidence insert-only | combine | LiTT table shape and insert-only trigger win. `recordAudit` regains `orgId` and a throwing variant for durable jobs; upstream SQL writers are renamed to the LiTT columns; `audit_event_org` fires on insert only. Upstream activity log, actor filter, pagination and display names are adopted on top. Private-content access logging, recoverable deletion and purge are not adopted (C2, C3). | S2 (backend), S4 (UI) | `backend/src/lib/audit.ts`, `modules/audit/**`, `lib/auditExport.ts`, `backend/schema.sql`, `(pages)/history/page.tsx` | `backend/src/lib/__tests__/recoveryAudit.test.ts`; `audit.test.ts`; `auditExport.test.ts`; `appendOnlyEvidence.test.ts`; new RED: UPDATE and DELETE on `audit_events` raise on the converged schema | G21, FR-12 |
| Account and organization deletion, member departure | Organization soft delete and purge after 30 days; offboarding with departure archives; account cleanup deletes audit rows; `chats.user_id` set null so organization content survives its author | Organization deletion 405; account deletion runs a cleanup that fails part-way against the insert-only audit (§16.2 item 4) | combine | Every destructive path that touches evidence refuses before its first mutation until TD-008: `DELETE /orgs/:id` 405, account deletion refused with an intentional message, no purge job. Member departure keeps content with the organization (upstream detach semantics) and bumps the authorization epoch; it never deletes evidence. | S2 | `backend/src/lib/userDataCleanup.ts`, `modules/user/user.account.ts`, `modules/orgs/**`, `backend/schema.sql` | `orgs.routes.test.ts` ("unsupported organization endpoints"); `user.routes.test.ts` (account deletion, rewritten to the refusal); new RED: account deletion leaves every row untouched | G20, G21 |
| Authorization epochs and revocation | None; revocation deletes the `org_members` row | `organizations.authorization_epoch`, bump triggers, `ai_assert_active_matter_access` with `for update`; stale epochs fail sessions and jobs | port | Epoch column and bump triggers on `org_members` (insert, update, delete) and `matter_memberships`; fresh revalidation before sensitive writes and before claiming queued jobs (C4). | S2 | `backend/schema.sql`, tenancy read port, `evaluateAccess.ts` | `tenancyModel.test.ts`; `recoveryTenancy.migration.test.ts`; new RED: a job queued before revocation fails on claim | — |
| Sign-in, MFA and identity | #529 reworks sign-in messages and recovery; `requireMfaIfEnrolled`; the profile read returns true on a missing column | MFA default-on; `mfa_satisfied` in the request identity; profile read fails closed; Bearer only for named non-browser clients | combine | Upstream flows and messages; LiTT `middleware/auth.ts` variant wins on MFA, fail-closed profile read and the Bearer allowlist; one initial organization at onboarding. | S2 | `backend/src/middleware/auth.ts`, `frontend/src/app/login/**`, `verify-mfa/page.tsx`, `AuthContext.tsx` | `authStateMatrix.test.ts`; `AuthContext.test.tsx`; `authApi.test.ts`; `authRedirects.test.ts` | §14-D |
| Provider runtime | Tool-call recovery, `read_document` loop cut, provider access and quota explanations, chunk timeouts and per-provider deadlines, reasoning replay for opt-in models, provider-chosen output limit unless `LLM_MAX_OUTPUT_TOKENS` | Governed route resolved before dispatch; explicit and pinned routes fail closed; egress provenance and receipts; fake interception in tests | combine | Upstream runtime as is; LiTT route resolution, typed failures and receipt writing reapplied in front of it. The operator's explicit output limit wins; reasoning is replayed only for models that declare it. | S3 | `backend/src/lib/llm/aiSdk.ts`, `providers.ts`, `types.ts`, `modules/chat/engine/**` | `chat.routes.test.ts`; `tabular.routes.test.ts`; `llmModels.test.ts`; `providerDeadlines.test.ts`; `providerErrors.test.ts` | G06, G14 |
| Provider catalog, credentials and model selection | Model registry and provider matrix; masked saved keys; personal key overrides; Vertex, Azure, Azure Foundry, Bedrock, xAI, Mistral, custom and OpenAI-compatible endpoints (`custom` guarded per hop, `openai-compatible` not); organization keys and router models (`org_api_keys`, `org_router_models`); `chats` without `credential_ref` or `model_provider` | Seven providers (OpenAI, Anthropic, Gemini, OpenRouter, Vercel AI Gateway, OpenCode Go with DeepSeek models, operator-run Ollama); route = provider + model + versioned `credential_ref`, fixed on the conversation; no silent fallback | combine | Upstream registry, matrix and masked-key UI, with every upstream provider visible (owner decision of 2026-10-23, §16.2 item 1): Vertex, Azure OpenAI, Azure AI Foundry, Bedrock, xAI, Mistral, Vercel, OpenCode Go, the user's own endpoint (`custom`) and the operator-declared `openai-compatible`, next to OpenAI, Anthropic, Gemini, OpenRouter and the operator-run Ollama that LiTT already has. `chats.credential_ref` and `chats.model_provider` restored and used by routing (S3 acceptance), for every provider. DeepSeek and OpenCode Zen are added as fixed-host entries on the OpenAI-compatible adapter. `custom` and `openai-compatible` send every request through `guardedFetch`, which refuses loopback, private, link-local and cloud-metadata addresses on every hop; Ollama keeps its operator-only address (`OLLAMA_BASE_URL`) and is never user-configurable. Organization keys are selectable only as an explicit institutional credential with its own `credential_ref`, never resolved implicitly. | S3 (backend), S4 (UI) | `backend/src/lib/llm/**`, `modules/user/user.apiKeyStore.ts`, `backend/schema.sql`, `(pages)/settings/byok/page.tsx`, `(pages)/settings/models/page.tsx`, `ModelToggle.tsx`, `RouterSettingsSection.tsx` | `user.apiKeyStore.test.ts`; `providers.byok.test.ts`; `modelSelection.test.ts`; `UserProfileContext.test.tsx`; `modelAvailability.test.ts`; `lib/mcp/__tests__/client.ssrf.test.ts`; `lib/__tests__/privateIp.test.ts`; new RED: a `custom` base URL and an `openai-compatible` configured `baseUrl` that resolve, directly or after a redirect, to `127.0.0.1`, `10.0.0.0/8`, `169.254.169.254` or `::1` are refused before any request leaves; a pinned chat never changes route | G19, FR-16, §14-E |
| Chat turns, server runs and two chats | Answers are server-owned runs (`streamRuns.ts`, `assistantTurnRuns.ts`) that survive refresh and resume by sequence number; explicit Stop; inactivity deadline; per-turn retry with mapped errors; second chat side by side and side panel; streaming render fixes; project-chat IDE workspace | Own `lib/chat/streaming.ts` + `sseHeartbeat.ts`; matter- and document-scoped assistant; errors pass through `userFacingError` | adopt | Upstream runs, retry, two chats and side panel. A run carries the conversation's pinned route and writes the same receipts as a direct stream; retry never changes the route. LiTT matter scoping and error mapping reapplied on the upstream components. | S3 (backend), S4 (web), S5 (Word) | `modules/chat/**`, `modules/project-chat/**`, `useAssistantChat.ts`, `ChatHistoryContext.tsx`, `ChatView.tsx`, `AssistantSidePanel.tsx`, `word-addin/src/taskpane/App.tsx` | `chat.routes.test.ts`; `projectChat.routes.test.ts`; `wordChat.routes.test.ts`; `useAssistantChat.sse.test.ts`; `userFacingError.test.ts`; `AssistantSidePanel.test.ts` | G12, FR-01, FR-03, other-20, §14-B |
| Answer rendering and citations | Passage selection and quoting shared by web and Word; copyable text cards; subagent pills; uploaded documents as pills; PDF citation highlights; citation document order with page breaks | Verified citations resolve to document, version, span and hash | combine | Upstream rendering; LiTT citation verification and provenance stay authoritative for "verified" marks. | S4 | `AssistantMessage.tsx`, `message/EventBlocks.tsx`, `CitationQuotesSection.tsx`, `frontend/src/shared/ui/**` | `CitationSources.test.tsx`; `CitationQuotesSection.test.tsx`; `PdfView.test.ts`; `citations.test.ts` | FR-02, §14-C, G06 |
| Web search and subagents in chat | Provider-native web search per user (`user_profiles.web_search`); delegation to subagents with their own `subagent_model` | Not present; every model call follows the pinned route with recorded egress | gate | Both arrive disabled. Web search sends the query to the provider's search service and subagents can use a model other than the pinned one, so each needs an owner decision; a subagent, if enabled, must use the conversation's route. | S3 | `modules/chat/engine/**`, `backend/schema.sql` (`chat_subagent_runs`) | new RED: with defaults, no web-search tool and no subagent is offered | G15 |
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
| CourtListener | Connector listed in Discover, research tools, two index tables | Removed (TD-013); not a Mexican authority | reject | Files, tools, index tables, key type and UI entry removed; historical upstream migrations stay and the LiTT removal migrations (`20260905_01_recovery_core_convergence`, `20260909_03_recovery_remove_us_research_preference`) are carried into the renumbered series. | S7 (S1 for the migrations) | `backend/src/lib/courtlistener.ts`, `modules/chat/engine/tools/courtlistener*.ts`, `CourtListenerConnector.tsx`, `docs/courtlistener.md` | `courtlistenerExclusion.test.ts`; `recoveryCoreConvergence.runtime.test.ts` | G24, FR-20 |
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
| **Delete my account** | Answers "not available yet" until the retention decision (TD-008) is implemented. Today the button starts deleting and then fails part-way |
| A catalog of preset contract templates | Shipped empty: the upstream set is US law |
| A Mac desktop app | Not offered; revisit on 2026-11-20 |
| The Word add-in recovers its session, retries a failed answer and replays edits that were not applied | Adopt, keeping the approved-redline panel |
