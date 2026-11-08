# Training: mentors, pupils, stages and supervision (layers 1 and 2)

LiTT lets a firm mark the people it is training and change, for them only, how
the assistant answers. This document describes the behavior and the rules as
implemented. Nothing here changes anything for a person without a stage.

## Concepts

- **Stage.** `pasante` or `junior`. It belongs to one person in one
  organization, for one practice area or for all of them. Without a stage the
  person is a lawyer and LiTT behaves exactly as before.
- **Practice area.** The existing `practice` field of a project (or, when the
  project has none, of its linked matter). Stages store it normalized as
  `lower(btrim(practice))`; a stage with `practice = null` covers every
  practice area.
- **Effective stage** for (person, organization, project), resolved only by
  `resolveTrainingStage` in `backend/src/lib/training.ts`:
  1. the stage for the project's exact practice area;
  2. otherwise the stage for every practice area;
  3. otherwise none.

  In the personal space it is always none. A read failure fails the turn
  instead of answering "no stage".
- **Word.** A Word add-in chat has no project and so no practice area. This is a
  deliberate deviation from "the personal space is always none": without it,
  Word would be a way around the requirement. The effective stage there is the
  stage for every practice area (`practice null`) that is the most junior among
  the person's organizations (`pasante` before `junior`; a tie goes to the
  lowest organization id), ignoring deleted organizations. It is resolved by
  `resolveWordTrainingStage` in the same file; a stage for one practice area
  alone never applies in Word. The note of a Word turn belongs to the
  organization whose stage was applied.
- **Workflows.** A workflow and its assets have no project or matter, so no
  practice area. In an organization's workflow the effective stage is the
  stage for every practice area (`practice null`) in that organization, and a
  stage for one practice area alone never applies there. A personal workflow
  has no organization, so nobody has a stage in it (see Seal for the copies it
  refuses). The workflow's own `practice` label is a catalog tag, not a
  practice area for this rule. This holds both for sealing a version written
  into a workflow asset and for who may approve one: a junior whose only
  stage is for one practice area may approve a workflow asset as a lawyer
  would. Making any stage in the organization count inside workflows would
  be a product decision; it would harden sealing too, since both use the
  same effective stage.
- **Mentor.** Designated by an owner or admin of the organization. Each pupil
  has exactly one current mentor per organization.

## Data

Migration `backend/migrations/20261106_50_litt_training.sql` (also in
`backend/schema.sql`):

| Table | Key | Notes |
|---|---|---|
| `training_mentors` | `(org_id, user_id)` | FK to the `org_members` row, `on delete cascade` |
| `training_pupils` | `(org_id, trainee_user_id)` | FK to the pupil's `org_members` row (cascade); FK `(org_id, mentor_user_id)` to `training_mentors`, `on delete restrict`; `trainee_user_id <> mentor_user_id` |
| `training_stages` | unique `(org_id, trainee_user_id, coalesce(practice, ''))` | `stage in ('pasante','junior')`; `practice` normalized or null; FK to `training_pupils`, cascade |

RLS is on and there are no policies or browser grants: every read and write
goes through the backend (`modules/training/`, and `modules/training-notes/` for
the notes).

| `training_turn_notes` | `id` | a pasante's private notes on their chat turns: `attempt` (60–4,000 characters), `contrast`, `contrast_status in ('pending','ready','failed')`; FK `(org_id, trainee_user_id)` to the pupil's `org_members` row (cascade); one FK per surface to its chat (`chat_id` → `chats`, `word_chat_id` → `word_chats`, `tabular_chat_id` → `tabular_review_chats`, all cascade, exactly one set); `message_id` is the user message, unique |

The attempt and its contrast are learning data. They are **not** stored on the
chat message, so the people who can read the chat never see them.

### When membership ends

The rows hang off `org_members`, so leaving or being removed deletes the
person's pupil row, stages and mentor row. A mentor who still has pupils cannot
leave: the trigger `org_members_training_departure` raises `LT001`, which the
API answers as `409 training_mentor_has_pupils`. The exceptions are the
cascades that are not a choice: account erasure
(`prepare_account_org_departures`), the deletion of the account row itself and
the deletion of the organization row release that mentor's pupils instead.
Audit events are insert-only and stay.

The product never deletes a firm (`organizations_no_team_delete`). If an
operator's purge lifts that guard, every `training_*` row and every note of the
organization goes with it, Word and tabular notes included, through the
membership cascade; `training.postgres.test.ts` covers this. Such a purge must
delete the organization's chats first: `chats.org_id` is `on delete restrict`.

## Rules

Enforced in `training.service.ts` and covered by
`training.service.test.ts`:

| Action | Who |
|---|---|
| Designate or retire a mentor | an owner or admin; a mentor with pupils is not retired (`409 training_mentor_has_pupils`) |
| Take a member as pupil | a mentor, for themselves, when the member has no mentor |
| Move a pupil to another mentor | an owner or admin only (`409 training_pupil_has_mentor` for anybody else) |
| Set, change or remove a stage | the pupil's current mentor only |
| Release a pupil (mentor and stages) | their mentor, or an owner or admin |
| Read | the pupil: their mentor and stages; a mentor: their pupils' stages; an owner or admin: who mentors whom, never the stages |

Nobody is their own pupil.

**Accepted: a mentor can tell that a member already has a mentor.** The list of
members a mentor may take (`candidates` in `GET …/pupils`) leaves out those who
have one, and taking one of them answers `409 training_pupil_has_mentor`. This
is kept on purpose. The approved specification limits the owner's and admin's
role to naming mentors, so pupils cannot be assigned only by them, and a mentor
cannot take a pupil without a list of members who are free. What can be
inferred is only that somebody has a mentor: never who, never a stage, never a
note. Only designated mentors see it (`candidates` and the `POST` require being
one); owners and admins already see who mentors whom.

Each change writes one insert-only audit event, with
ids and labels only: `training.mentor_designated`, `training.mentor_removed`,
`training.pupil_assigned`, `training.pupil_released`, `training.stage_set`,
`training.stage_removed`.

## API

| Route | Purpose |
|---|---|
| `GET /training/me` | the caller's mentor, stages and mentor role, per organization |
| `GET /training/stage?org_id=&project_id=` or `?surface=word` | the caller's effective stage where a turn would run, whether a turn there needs their attempt (`attempt_required`) and the urgency pass in force there (`urgency_pass`, layer 2); the client only uses it to decide what to show |
| `GET/POST /orgs/:orgId/training/mentors`, `DELETE …/mentors/:userId` | owners and admins |
| `GET/POST /orgs/:orgId/training/pupils`, `DELETE …/pupils/:userId` | mentors (and owners or admins to move or release) |
| `PUT/DELETE /orgs/:orgId/training/pupils/:userId/stages` | the current mentor; `DELETE` takes `?practice=`, none for every practice area |

Payloads are declared in `packages/contracts` (`Training*`); the codes the
client acts on are in `CODE_KINDS`.

## «Tu turno primero»

Every user turn whose author's effective stage is `pasante` in that chat:

- carries `attempt`, at least 60 characters after trimming (counted as
  characters, not UTF-16 units) and at most 4,000; otherwise the server answers
  `400 training_attempt_required` before writing anything or calling a model,
  with a different message for "too short" and "too long";
- gets the same answer a lawyer would get. The attempt is **not** injected into
  the prompt and the message is stored as it is;
- leaves a private note (`training_turn_notes`, `contrast_status = 'pending'`)
  tied to the user message, with the attempt;
- once the final answer is persisted, triggers one more model call that
  produces the contrast. It runs on the **same provider, model and credential**
  the conversation is fixed to (governed BYOK, no fallback; not the title
  model), receives the attempt and the final answer fenced as data with a
  nonce, and answers in Spanish with three short sections: «Coincide», «No
  coincide», «Faltó». The result is stored in the note (`ready`). If the call
  fails or its answer lacks the sections the note is marked `failed` and the
  turn is unaffected. A contrast still `pending` ten minutes after the turn is
  reported as `failed` (its call was lost, for example in a restart).

The contrast runs in the same process right after the turn instead of as a
queued job (`lib/dbq`): a job would have to carry the decrypted credential, and
losing an in-flight call costs only a note that reads as failed.

For a junior or a lawyer, `attempt` is ignored and nothing is stored. The
surfaces are the web chat (`POST /chat`), the project chat
(`POST /projects/:id/chat`), the Word chat (`POST /word-chat`) and the tabular
review chat (`POST /tabular-review/:reviewId/chat`, which resolves the stage in
the review's organization and project). Answering an ask-inputs question
continues a turn and is not a new one; a turn paused by ask-inputs gets its
contrast from the answer so far. A Word chat with `storage: "local"` has no
server-side transcript: the attempt is still required but no note is kept.

### One wiring for the four surfaces

The four surfaces do not repeat this logic: each calls `lib/trainingTurn`
(`backend/src/lib/trainingTurn/`), which is in `lib/` and imports nothing from
`modules/`.

- `beginTrainingTurn` resolves the stage (`resolveTurnTraining`, or the one
  Word rule for Word), applies the behaviors listed in `index.ts` and returns
  either the `400` above or a plan (`stage`, `passActive`, `attempt`, `orgId`,
  `toolPolicy`, `afterTurn`). It throws if the stage cannot be read, and each
  surface answers its own internal error.
- `recordTrainingNote` writes the pending note once the user message is saved
  (nothing without an attempt, an organization or a persisted message).
- `finishTrainingTurn` launches the contrast once the answer is durable and the
  turn did not end in an error.
- `readTrainingBody` reads the training fields of a request body and ignores
  the rest. `trainingEnginePlan` turns the plan into the engine's single
  `trainingPlan` argument (extra system text and narrower tool limits); it
  asks nothing of the engine today.

A new training behavior is a file in that folder plus one line in `BEHAVIORS`;
it does not touch the surfaces again.

### Reading the notes

`GET /training-notes/chats/:chatId` (optionally `?message_id=`) returns
`{ notes }` for a chat of any surface. Only the author and the author's
**current** mentor (`training_pupils`) can read a note; owners, admins, other
participants of the chat and a previous mentor cannot. The mentor reads the
notes of a chat inside a matter only while they can open that matter's project
(`checkProjectAccess`), as with the layer-2 reviews. Any other case, and any
chat without readable notes, is the same `404`. Notes are deleted with the
membership, with the chat, and with the account.

Beside a message the panel finds its note by the message id. A message sent
in this session has no saved id in the client yet (the web leaves it out, the
Word add-in gives it one of its own), so it takes the unclaimed note whose
attempt is exactly the one it was sent with, newest with newest
(`matchTrainingNotes`). A message whose note was never created stays bare. The
one case left ambiguous is two turns just sent in the same chat with the
identical attempt: their notes may be shown swapped, and they differ only in
the contrast. After a reload every message has its id and the match is exact.
Using the id instead would mean the stream announcing the saved user message
id and each client (the web turn registry, the tabular panel and the Word
add-in, whose local chats keep their own ids) adopting it mid-turn, a change to
three separate stream pipelines that this narrow, read-only case does not
justify.

The composers (web and Word) show the required field
«Tu planteamiento (2–3 líneas)» with a counter when `GET /training/stage` says
`attempt_required` (a pasante without an urgency pass there); the server
decides either way. A composer in a project chat,
including one opened from the assistant's chat list, asks with that project
(`project_id`), so it shows the stage for the project's practice area.

## Settings

- **Organization → Formación** (owners and admins): members with a «Mentor»
  switch and whose mentor each one is.
- **Settings → Formación**: «Mi formación» shows a pupil their mentor and
  stages and, per organization, «Lo que mi mentor ve de mí» (layer 2, below);
  «Mis pupilos» lets a mentor take members without a mentor, set their
  stage per practice area («Todas las materias», the practice options, or
  another), and release them, and links to the mentor panel.
- **Settings → Formación → Panel del mentor** (`/settings/training/mentor`,
  layer 2, below).

## The pasante seal and its approval (layer 1b)

Migration `backend/migrations/20261106_51_litt_training_output_lock.sql` (also
in `backend/schema.sql`).

### Seal

`document_versions` has `training_author_user_id` and `training_stage`
(`'pasante'` or null; both set or both null). A sealed version is a pasante's
draft. Every insertion declares whose content it holds
(`VersionAuthorship` in `modules/documents/documents.lifecycle.ts`), and the
facade decides the seal before calling `create_document_version`:

| Paths | Authorship | Seal |
|---|---|---|
| A1 upload, A2 new version, A4 assistant edit, A6 generated file | the actor | sealed with the actor as author when the actor's effective stage (`resolveTrainingStage`, in the document's organization and project) is `pasante` |
| A3 version from another document, A5 replicate, A8 copy to workflow assets, A9 copy to another project | a copy of the source version | the source's seal and author, whoever copies |
| A7 workflow add-on from the catalog | catalog | never |
| A10 approved AI review report | the reviewer | the backend always states `training_stage` (`'pasante'` or `null`); `append_ai_review_export` refuses a contract without it |
| U1 accept/reject an edit, U2 same-turn edit, U3 replacement (editor save) | the actor (`updateDocumentVersion` requires `actorUserId`) | a pasante seals the version in place |
| U4 conversion (rendition only) | — | no change |

A seal is never removed or handed to somebody else: the trigger
`document_versions_training_seal_keep` restores it on every update, so a
lawyer's change to a pasante's version leaves it sealed. The author has no
foreign key on purpose; the seal outlives the account. A read failure while
deciding a seal fails the write, and so does a copy whose source version is
not found. A sealed copy is made only into a document with an organization,
where it can be approved: a workflow asset takes its workflow's
organization, and a copy that would have none (a chat or a workflow outside
an organization) is refused. Copying into a personal workflow answers `409`
with code `training_copy_needs_organization`, and the client says why. The
database holds the same rule for every writer
(`20261106_52_litt_training_seal_org.sql`):
`document_versions_training_seal_org` refuses a sealed version in a document
without an organization, and `documents_training_seal_org` refuses taking
the organization away from a document that holds one. Versions written
before 1b have no seal.

### Approval

`POST /single-documents/:documentId/versions/:versionId/training-approval`
(`modules/documents/documents.trainingApproval.ts`, payload
`TrainingVersionApproval` in `packages/contracts`) records the approval of
the version's **current** `content_sha256` in `training_version_approvals`.
It can be given by a member with `content.edit` in the document's project
(or, for a workflow asset, its workflow) whose effective stage there is none, or by the author's current mentor; never
by the author, a pasante or a junior. A person who can read the document but
may not approve gets `403`, whatever the reason; one who cannot read it gets
`404`. Approving the same bytes again returns the first approval. Each new
approval writes the audit event `training.version_approved` with
`{ org_id, target_user_id }` only.

`training_version_approvals` is insert-only (`ai_append_only_guard`), has RLS
with no policies, only `select, insert` for `service_role`, and no foreign
keys: deleting the document, the organization or an account leaves the
evidence in place.

### Releasable

`backend/src/lib/trainingRelease.ts` holds the one rule for an output
(`heldVersionIds`, with `assertVersionReleasable` for a loaded row and
`assertReleasable` for a version id): a version is releasable when it has no
seal, or when an approval exists for its current `content_sha256`. Changing
the bytes in place therefore needs a new approval. Otherwise the output
answers `409 { code: "training_approval_required" }` (in `CODE_KINDS`, shown
with the server's sentence and no Retry). A failed read never releases.

### The lock on outputs

The check runs on the version row each output actually resolves, so
`?version_id=` naming an older or non-current version is checked too.

| Output | With a pasante's unapproved version |
|---|---|
| `POST /single-documents/download-zip` | `409` for the whole archive when any selected document's current version is held |
| `GET /single-documents/:id/url` | `409`: no signed URL is issued. A URL already issued cannot be revoked and counts as released |
| `GET /download/:token` | `409` after the access check, on the resolved row. This one gate covers every token: chat events, accepted or rejected edits, generated and replicated files, playbook reviews, and the tokens kept in chat history or a chats export |
| `documents-zip` export (`POST /user/exports`) | the version is left out and named, with the reason, in `OMITIDOS.txt` inside the zip; a zip with only that list is still produced |
| `GET /projects/:projectId/ai-executions/:executionId/review/approved-report` | `409` while the report of a pasante reviewer (sealed when produced) is not approved |
| Drive publication of the approved report, and its reconcile | `409` before any claim or upload, although publication already fails closed outside the fake transport |

**Not locked (viewing inside LiTT):** `GET /single-documents/:id/display` and
`GET /single-documents/:id/file` (the pasante's own DOCX editor needs it)
answer `200` with `Content-Disposition: inline` and, for an unapproved
version, `Cache-Control: no-store`. Playbook sources and catalog add-on assets
are not document versions and carry no seal. Metadata (version lists, the
project manifest, the account and chats exports) carries no document bytes.

**Who approves:** see Approval above (a member with `content.edit` and no
stage in the project, or the author's current mentor; never the author, a
pasante or a junior). The approval binds the bytes, not the version id.

**What the lock is not:** it is the firm's governance control over what
leaves LiTT as a deliverable, not DRM. Whatever can be seen in the app (a
viewed PDF, an open editor, a screenshot) can be captured by the person who
sees it.

## Supervision data (layer 2)

Migration `20261107_60_litt_training_supervision.sql` adds the data a mentor
keeps while supervising a pupil. It is learning data, like the turn notes.

| Table | Key | Notes |
|---|---|---|
| `training_work_reviews` | `id` | the two-minute review of one piece of work: exactly one of `chat_id` / `word_chat_id` / `tabular_chat_id` (cascade with its chat, unique per chat); `status in ('pending','ready','failed')`; `proposed`, `ai_corrected`, `doubts`, `unverified` (JSON lists of `{ source, text, ref? }`, required when `ready`); the mentor's route (`model_provider`, `model`, `credential_ref`: identifiers only); `reviewed_at` / `reviewed_by` |
| `training_defenses` | `id` | an oral defense: `practice` (normalized or null), optional `work_review_id` of the same pupil (set to null if that review goes); `questions` ready = five, exactly one `cambio_de_hechos`; `outcome in ('approved','not_approved')` with `held_at` and `outcome_reason` (closed list), `outcome_note` up to 500 characters, recorded once (`LT002` on a change; `20261107_90`) |
| `training_urgency_passes` | `id` | a mentor's pass for one `project_id`: `starts_at < expires_at`, `reason_code in ('plazo','audiencia','cliente_urgente','otro')`, `reason_note` up to 500 characters, `revoked_at` / `revoked_by`; FK to `training_pupils` (cascade) |

**Who reads it.** One rule, in the database:
`training_can_read_learning(actor, org, trainee)` is true only for the person
themselves and for their **current** mentor (`training_pupils`), both members
of the organization. No role grants it: an owner, an admin, a previous mentor,
another mentor or another member get the same `404` from every route that
serves this data (`assertLearningAccess` in `modules/training-supervision/`).
RLS is on, with no policies or browser grants.

**When it goes.** Reviews and defenses hang off the pupil's `org_members`
row, so leaving the organization or erasing the account deletes them;
releasing the pupil keeps them (a new mentor sees them) and ends the pupil's
urgency passes. When a mentor's account goes, the ids of what they did
(`generated_by`, `reviewed_by`, `recorded_by`, `granted_by`, `revoked_by`)
become null and the pupil's rows stay. Audit events stay (insert-only).

`GET /training/me/supervision?org_id=` returns what the caller's mentor keeps
about them there: their work reviews, defenses and urgency passes. A
defense's questions, reason and note reach the pupil once its outcome is
recorded (before that they see that a defense exists), here and in the
account export (`training.work_reviews`, `training.defenses`,
`training.urgency_passes`).

The rule's role matrix, deletion and a generic check of every
`public.training_*` table with `trainee_user_id` run against PostgreSQL in
`backend/src/__tests__/sql/performance.litt-training-supervision.sql` (CI,
schema-drift workflow) and `trainingSupervision.postgres.test.ts` (local, with
`MIKE_TEST_POSTGRES_CONTAINER`).

### The two-minute review

A **work** is one chat of the pupil with turn notes, on any surface. Its
review has four lists, each line with its `source`:

| List | Source | Model? |
|---|---|---|
| `proposed` | the pupil's attempts, as written (`attempt`) | no |
| `ai_corrected` | the contrasts' «No coincide» and «Faltó», put in order (`contrast`) | yes |
| `doubts` | inferred from the counted signals and doubt in the attempts (`inferred`) | yes |
| `unverified` | citations the server did not verify (`citation`), the pupil's sealed drafts from that chat still without an approval for their bytes (`version`), and the contrasts' «Faltó» (`contrast`) | no |

The model sees only the attempts, the contrasts and the counts
(`signals`), never the transcript or a document's text, each in a block fenced
with a per-call nonce (`lib/promptFence.ts`); it must answer strict JSON
(`lib/trainingSupervisionAi.ts`), or the review is `failed`.

| Route | Who |
|---|---|
| `GET /orgs/:orgId/training/pupils/:userId/works` | the current mentor: the pupil's works, newest activity first, with their review and `has_new_work`; `works_without_access` counts the works in matters the mentor cannot open, which are not listed; `generation` says whether the mentor can generate and on which keys |
| `POST …/works/:surface/:chatId/review` | the current mentor: generate or regenerate (`{ credential_ref? }`); `surface` is `chat`, `word` or `tabular` |
| `PUT …/works/:surface/:chatId/review/reviewed` | the current mentor, on a `ready` review |

The pupil gets the same `404` on these; they read their reviews through
`/training/me/supervision`.

**Model.** A review runs on the **mentor's** route, never the pupil's
conversation route: the mentor's selected model on the key they choose (or
their default key), pinned with `pinChatRoute` and stored on the row. A
regeneration reuses that route; when it no longer serves the caller (another
mentor, a rotated key) the answer is `409 chat_route_credential_unavailable`
and no other model or key is tried. A mentor with no usable key is not offered
generation (`generation.available: false`) and a request answers
`400 training_review_key_required`. `llm.egress` (`surface:
"training_supervision"`) is recorded before the text is sent.

**States.** `pending` while the call runs (a second request gets
`409 training_review_in_progress`; a row pending for over ten minutes reads as
`failed` and can be generated again), then `ready` or `failed`. The lists are
filled, and returned, only when `ready`. Regenerating clears «reviewed»: the
mentor marks the new review again. The audit gets
`training.work_review_generated` and `training.work_review_marked` with the
chat id and `{ org_id, target_user_id }` only.

### Urgency pass

A pupil's **current** mentor may lift «Tu turno primero» for one matter's
project and a limited time (specification §6.3; open questions 1 and 2 of the
layer-2 plan, decided with their recommendation):

| Route | Who | Purpose |
|---|---|---|
| `POST /orgs/:orgId/training/pupils/:userId/passes` | the current mentor | `{ project_id, duration_minutes?, reason_code, reason_note? }` |
| `GET …/passes` | the current mentor | the pupil's passes, newest first |
| `DELETE …/passes/:passId` | the current mentor | revoke (again: `204`, nothing changes) |

- Anybody else (the pupil, a previous mentor, another mentor, an owner, an
  admin, another member) gets the uniform `404` of `assertLearningAccess`; the
  pupil sees their passes in `GET /training/me/supervision`.
- 30 minutes to 72 hours, 8 hours when omitted, at most 5 in force per pupil
  (`lib/trainingPass.ts`). The end is rounded down to the minute; the same
  grant twice is `409 training_pass_duplicate`, a sixth pass
  `409 training_pass_limit_reached`, a bad duration, reason or note
  `400 training_pass_invalid`.
- The mentor and the pupil must both be able to open the project, which must
  belong to the organization: one the mentor cannot open is a `404`, one the
  pupil cannot open `409 training_pass_pupil_no_access`.
- `reason_code` is one of `plazo`, `audiencia`, `cliente_urgente`, `otro`.
  The audit event `training.urgency_pass_granted` keeps who granted it
  (`user_id`), to whom (`target_user_id`), the project (`project_id`),
  `expires_at` and `reason_code`; `training.urgency_pass_revoked` keeps the
  project. The free `reason_note` is learning data: it stays on the row and
  goes with the pupil.
- The grant itself is `training_grant_urgency_pass`
  (`20261107_61_litt_training_urgency_pass_grant.sql`): it re-checks the
  current mentor and the project and counts the passes in force under a lock
  on the pupil's row. `performance.litt-training-urgency-pass.sql` and
  `trainingUrgencyPass.postgres.test.ts` prove that nobody else can grant.

**What a pass changes.** `resolveTurnTraining` (`lib/trainingPass.ts`) tells a
turn whether it needs the attempt: `attemptRequired = stage === "pasante" &&
!passActive`. While a pass is in force in the chat's project the turn needs no
attempt, keeps no note and makes no contrast call; the answer is the same as
ever (the attempt is never in the prompt). A pass is read at every turn, so
one that expires or is revoked asks for the attempt again; the web composer
reads `GET /training/stage` again at the pass's end and after a refused turn,
and shows «Pase de urgencia vigente hasta …» in place of the field. A failed
read of the passes asks for the attempt (a failed read of the stage fails the
turn).

**What it does not change.** The stage. `resolveTrainingStage` still decides
the seal, the approvals and the AI review's approved report, so a document a
pasante produces during a pass is sealed and its outputs answer
`409 training_approval_required` until it is approved. Any later behavior that
depends on the stage for the AI (layers 3 and 4) reads `resolveTurnTraining`;
the seal and the approvals read `resolveTrainingStage`.
`trainingUrgencyPass.lock.test.ts` holds this contract.

**Where it applies.** The web chat, the project chat and the tabular review
chat, in the chat's project. A chat without a project has no matter, so no
pass. The Word chat has no project either: Word never honors a pass, and a
pupil with one still sees the field there.

**When the mentor changes.** A pass is the mentor's who granted it. When the
pupil gets another mentor, every pass still in force for them ends at once:
a trigger on `training_pupils` (`20261107_90_litt_training_defense_outcome.sql`)
revokes them in the same statement that changes the mentor. `revoked_by` is
whoever moved the pupil (`20261107_91_litt_training_pass_revoked_by.sql`): the
session's user (`auth.uid()`) when the statement runs in one; otherwise, as
for the service role the app writes with, the `assigned_by` that same
statement writes. `assignPupil` sets `assigned_by` to the actor in the update
that moves the pupil, and any other service-role path that changes a mentor
must do the same: a change with neither a session user nor `assigned_by`
fails (`LT003`) rather than record a revocation nobody made. The new mentor
grants their own if they want one. Releasing the pupil deletes their passes
(cascade).

### Oral defense

The current mentor prepares and records an oral defense (specification §6.2):

| Route | Who | Purpose |
|---|---|---|
| `GET /orgs/:orgId/training/pupils/:userId/defenses` | the current mentor | the pupil's defenses, newest first, and `generation` (as for reviews) |
| `POST …/defenses` | the current mentor | create one: `{ practice?, work_review_id? }` |
| `POST …/defenses/:defenseId/questions` | the current mentor | generate (or regenerate) the questions: `{ credential_ref? }` |
| `PUT …/defenses/:defenseId/outcome` | the current mentor | record `{ outcome, reason, note? }`, once |

- Anybody else, the pupil included, gets the uniform `404`; the pupil reads
  their defenses through `GET /training/me/supervision`.
- `practice` omitted: the practice area of the linked work's matter, or every
  practice area (`null`) without one. A linked work in a matter the mentor
  cannot open is a `404`.
- **Questions.** Five: four that ask the pupil to justify their own
  reasoning and one change of facts («¿y si X hubiera sido distinto?»,
  `kind: "cambio_de_hechos"`), each with `listen_for`, what the mentor should
  hear. The model sees only the attempts and the contrasts of the linked
  work, or of the pupil's works in the defense's practice area the mentor can
  open (the newest notes), fenced with a per-call nonce. The answer must be
  strict JSON with exactly that shape, and it fails if it names an article, a
  fraction of an article, a thesis or a registry number that the pupil's text
  and the contrasts do not (`legalReferences` in
  `lib/trainingSupervisionAi.ts`). Each number of an enumeration counts on its
  own («artículos 1949, 2000 y 2001», «registros 2021234 y 2021235»), and a
  range («1949 a 1951») names every number in it (one wider than 100 names
  only its ends and itself). No work to rest on: `400`.
- **Model.** The mentor's route, exactly as for a review (stored on the
  defense, no fallback, never the pupil's key; `llm.egress` first with the
  defense's id), and the same states: one generation at a time
  (`409 training_review_in_progress`), `pending` → `ready` | `failed`.
- **Outcome.** `outcome` is `approved` or `not_approved`; `reason` is one of
  `razonamiento_solido`, `razonamiento_incompleto`,
  `cambio_de_hechos_no_resuelto`, `sin_sustento`, `otro`; `note` up to 500
  characters. It can be recorded without questions (the AI may be
  unavailable; a defense really held is not lost). It is recorded once: a
  second request, or asking for questions afterwards, is
  `409 training_defense_already_recorded`. A correction is a new defense.
- **Audit.** `training.defense_created` and `training.defense_recorded` with
  `{ org_id, target_user_id, defense_id }` only: never the outcome, the
  reason, the note or the questions.

### Promotion by evidence

LiTT proposes, the mentor decides (specification §6.4 and §10). The
proposals are computed on every read and never stored
(`proposePromotions` in `lib/trainingPromotion.ts`, a pure function).

| Route | Who | Purpose |
|---|---|---|
| `GET /orgs/:orgId/training/pupils/:userId/promotion` | the current mentor | one entry per stage the pupil holds, with its evidence |
| `POST …/promotion` | the current mentor | accept a proposal: `{ practice, to: "junior" \| "abogado" }` |

- For each stage (the general one first, then each practice area), the next
  step is proposed (`pasante → junior`, `junior → abogado`) when, **since that
  stage last changed** (`training_stages.updated_at`), there are at least
  `PROMOTION_MIN_APPROVED_DEFENSES` (2) approved defenses, no defense not
  approved after the last approved one, and at least
  `PROMOTION_MIN_REVIEWED_WORKS` (3) works the mentor marked reviewed
  (layer-2 plan, open question 3). A practice area counts only its own
  evidence; the general stage counts any.
- The answer lists the evidence (ids and dates of the defenses, the reviewed
  works and the pupil's drafts a mentor or a lawyer approved, which are shown
  but not required) and the two required counts: never a score, and nothing
  about other pupils. Works and drafts in matters the mentor cannot open do
  not count.
- Not proposed, with `blocked_by`: `not_approved_after`, or
  `general_stage_remains` for `junior → abogado` in a practice area while a
  general stage exists (removing the practice stage would leave the general
  one, not a lawyer). `blocked_by` says what would stop a proposal even with
  the counts met, so it is set whether or not they are met yet: the mentor
  learns about it before collecting more evidence, and the counts next to it
  say what is still missing.
- Accepting recomputes the proposal and requires it to still hold
  (otherwise `409 training_promotion_not_proposed`), then changes the stage
  only through `setStage` (to `junior`) or `removeStage` (to `abogado`) of
  the training module, so "only the current mentor" applies and
  `training.stage_set` / `training.stage_removed` is written as for any stage
  change, followed by `training.promotion_accepted` with
  `{ org_id, target_user_id }` only. The new stage starts its evidence
  again.
- Layers 3 and 4 add the gym and the confidence meter as further inputs of
  the same function.

### The mentor panel and «Lo que mi mentor ve de mí»

The web app's screens for layer 2 (`frontend/src/app/components/training/supervision/`,
client calls in `mikeApi.ts`). They are bilingual from the start (en-US and
es-MX, namespace `training` of `packages/i18n`); the learning data itself (the
pupil's attempts, the contrasts, the AI's lines, the questions and every
note) is shown as written and never translated.

**Panel del mentor** (`/settings/training/mentor`, also in the settings
search). For each organization where the caller is a mentor it lists their
pupils, most recent work first (never by performance), each with how many of
their works wait for review (no review, not marked reviewed, or new work since
the review) and the end of an urgency pass in force. There are no totals,
charts or comparisons between pupils. «Supervisar» opens one pupil in four
tabs:

| Tab | What the mentor does |
|---|---|
| Trabajos | Each work's four rows (propuso / corrigió la IA / dudó / sin verificar), lines from the model marked «inferido», when and with which model it was generated, «Generar resumen» / «Regenerar» and «Marcar como revisado». The works in matters the mentor cannot open are only counted. A sealed draft still held is counted, and its line in «Qué quedó sin verificar» carries `ref` (the version) and `document_id`, so the mentor can approve it in the row with «Aprobar esta versión» after a `ConfirmPopup`, through the existing `POST /single-documents/:id/versions/:versionId/training-approval` (no new route; the same rule decides who may approve). The pupil's own list shows the line without the button. A review generated before `document_id` existed has no button until it is regenerated; its document is where «Aprobar esta versión» already lives. |
| Defensa oral | Create a defense (from a reviewed work, which takes its matter's practice area, or for a practice area), generate the five questions (the change of facts named in text, with what to listen for) and record the outcome, reason and note. Recording asks for confirmation (`ConfirmPopup`) because it is final. A defense can be recorded without questions. |
| Pase de urgencia | Grant a pass on one of the organization's matters for 30 minutes to 72 hours (8 by default) with a reason and an optional note, list the passes (in force until, ended, revoked) and revoke one in force, with confirmation. The matter selector offers only matters the pupil can open too (`GET …/passes?project_ids=` answers `grantable_project_ids` with the grant's own test); the grant still refuses the rest with `training_pass_pupil_no_access`. The screen says that a pass does not apply in Word. |
| Promoción | Each stage with its proposal: the pupil's own counts against the required ones («Defensas aprobadas: 1 de 2»), the approved drafts, what blocks it (`blocked_by`) and «Aceptar propuesta», with confirmation. |

**Key and model.** The Trabajos and Defensa oral tabs read `generation`: with
no usable key they say so and offer no generation (a defense can still be
recorded); with more than one key a «Llave» choice appears, and with no
default the mentor must pick one before generating. The client never retries
on another key: `chat_route_credential_unavailable`, `training_review_in_progress`
and the other codes of these routes (all in `CODE_KINDS`) reach `notifyError`
with a sentence of their own.

**«Lo que mi mentor ve de mí»** (in «Mi formación», one per organization)
renders `GET /training/me/supervision` with the same components the mentor
sees: the reviews' four rows, the defenses (before the outcome only «Hay una
defensa programada»; questions and note afterwards, as the server sends them)
and the passes. It has the same data as the mentor's tabs, no more and no less: the server
lists only the reviews of works whose matter the pupil's CURRENT mentor can
open (the test behind the Trabajos tab's «works without access» count), and
none while the pupil has no mentor.

**Word.** The add-in is not changed by layer 2: Word does not honor a pass
(above), so its composer keeps asking for the attempt, and the panel is used
on the web.

## From correction to rule (layer 3)

A mentor can turn their corrections of a pupil's work into rules proposed for
a playbook. The mechanics (route, limits, origin and attribution) are in
`docs/playbooks.md`, "From a mentor's corrections"; what matters for learning
data is here.

- **Who.** An Editor or Owner of the playbook who is the pupil's *current*
  mentor (`assertCurrentMentor`, the one gate in front of learning data). Not
  an owner or admin by role, not a previous mentor, not a pupil: all get the
  uniform `404`. The stage grants nothing.
- **What is kept.** The corrections (the pupil's text, the mentor's text and
  comment) and the pupil's id live on the playbook import row until the job
  ends, then they are erased; the failure and interruption paths erase them
  too (an interrupted batch is cleared when its attempt is read, or at the
  latest at the next batch). No table of this feature keeps the pupil's text or a column for the
  pupil. The one place that keeps the pupil's id is the insert-only audit
  (below), which stores ids and counts only and no text. What stays is the
  rule, which belongs to the firm, and the mentor's name as its attribution; if the mentor's account
  is erased the attribution on the change goes to null.
- **Copies.** A copy of the playbook carries no attribution and no note from
  a correction: the rule is "suggestion without backing, review".
- **Audit** (insert-only, ids and counts, never text): `training.correction_proposed`
  (organization surface, like the other training audit rows: it keeps
  `org_id`, `target_user_id`, `playbook_id`, `import_id` and the `corrections`
  count, so the pupil is identified by id only) when a batch is sent, and `playbook.corrections_ready` when it
  ends.
- **Interface.** The playbook page has a **Corrections** panel for Editors who
  supervise someone: the pupil, up to ten corrections, the model, and the
  proposed changes with their accept and reject buttons. Strings are in the
  `training.criterion.corrections` namespace of the catalog.

## Periodic full reading (layer 3)

Migration `backend/migrations/20261108_68_litt_training_criterion_readings.sql`
(also in `backend/schema.sql`), module `backend/src/modules/training-full-reading/`,
pure logic in `backend/src/lib/trainingReading.ts`, screens in
`frontend/src/app/components/training/reading/`. Once a month a **junior** reads
one whole document **without the assistant**, writes what they found, and only
then sees what a model found in the same text and how the two lists compare. It
is evidence for the mentor, never a promotion requirement, and it adds no
score: the comparison is three lists.

**When.** `GET /training/me/readings?org_id=` answers `eligibility`: the person
holds the junior stage in the organization, has no reading open, and 30 days
(`READING_INTERVAL_DAYS`) have passed since their last reading was *sent*. There
are no reminders and no scheduled work: «Mi formación» shows the notice when it
is opened (`ReadingNotice`, only for a person with a junior stage), and
`POST /training/me/readings` starts the reading (409 `training_reading_not_due`
otherwise). A second start returns the reading already open; one reading is
open at a time per person and organization (a partial unique index).

**Which document.** LiTT proposes one at random from the matters where the
person worked in the last 60 days (their turn notes in a chat, a project chat or
a tabular-review chat), that belong to the organization, that they can open
(`openableWorkMatters`) and where their effective stage is junior
(`resolveTrainingStage`), among the documents of the project with a stored text
(`document_version_texts`, read with `read_document_text`) of between 200 and
60 000 characters. That is all the stage does: *it chooses what is proposed, it
grants nothing*. The text is read under the person's own access to the
document, whatever their stage. With nothing to propose the start answers
`400 training_reading_no_document`. `POST …/:id/swap` changes the document once
(`409 training_reading_swap_used`), only before sending. The row keeps the
project, document and version identifiers (null if they are deleted), **never
the title**; the page shows the file name from the live version.

**Reading without the assistant.** `/settings/training/reading/[readingId]` is a
page with the document's text (`GET …/:id/document`, never stored on the row)
and a form, and no assistant. It cannot be enforced technically: the page says
that the reading is the person's own statement. `PUT …/:id/findings` records
what they found (20 to 4000 characters) **once**: a trigger refuses any later
change (`LT002`, `409 training_reading_findings_recorded`), so the comparison can
never be matched to a rewritten answer.

**The machine and the comparison.** `POST …/:id/compare` (under `chatLimiter`)
runs only after the findings were sent, on **the person's own pinned route**
(governed BYOK, `training_readings.model_provider/model/credential_ref`, three
columns or none): fixed the first time, reused on a retry unless they pick
another of their keys, and when it no longer serves them the answer is `409
chat_route_credential_unavailable` with no other model tried; with no usable key
the page offers no comparison (`training_review_key_required`). `llm.egress`
(`surface: training_reading`, `reading_id`, `step`) is recorded before each of
the two calls that send text:

1. The model reads the stored text (fenced with a per-call nonce; the system
   prompt says it is content, not instructions) and lists up to 8 findings, each
   with a **literal quote**. Each quote is checked with `locateQuote` (the same
   check citations use) against the text; a finding whose quote is not found is
   **discarded and counted**, and what is stored is the document's own passage,
   never the model's wording. A finding therefore only exists if its quote does.
2. Unless nothing survived, a second call pairs the person's lines (their text
   split by `personItems`) with the machine's findings. The pairing is the only
   thing the model decides, validated (valid indexes, each side used once); the
   three lists «Coincidieron / Solo lo viste tú / Solo lo vio la máquina» are
   computed from it, and the screen marks the pairing «inferido».

States: `assigned` → `submitted` → `comparing` → `compared`, or `failed` (the
call failed or its answer was not the required JSON; nothing else is written
and it can be tried again). One comparison at a time (the claim uses the row's
previous state); a `comparing` row older than 10 minutes reads as `failed`. The
log of a failure carries only the reading's id.

**Who sees it.** The person (their rows only) and their **current** mentor
(`GET /orgs/:orgId/training/pupils/:userId/readings`, `assertCurrentMentor`,
uniform 404 for everybody else: a previous mentor, an owner, an admin, another
member, the pupil on the mentor's route). The findings come from a client
document, so the mentor sees a reading only if they can open its matter; the
others are counted (`readings_without_access`), never shown. The table is a
learning table like the rest: `training_*` with `trainee_user_id`, RLS with no
browser grant, a cascade from `org_members` (it goes with the membership or the
account), covered by the generic discovery in
`performance.litt-training-supervision.sql` and by
`performance.litt-training-readings.sql`. No score, average or ranking is
returned anywhere. The account export carries the holder's readings
(`training.readings`), without the credential reference.

**Audit** (insert-only, `surface: organization`, `{ org_id, target_user_id,
reading_id }` only): `training.reading_assigned` and `training.reading_submitted`.
The findings, the machine's list and the comparison are never audited.

**The mentor's section.** `MentorReadings` (`orgId`, `pupilId`) is a section of
the panel's «Criterio» tab. That tab does not exist yet, so it ships mountable
and unmounted; whoever creates the tab adds the section with one import.

**Product decisions taken without the plan** (the simplest that comply): the
person's findings take at least 20 characters; the compare step is a separate
action after sending (so the person never sees the machine's list in the same
step); a reading that cannot be compared stays `failed` and can be retried
instead of being discarded; `swapped`, `version_id`, `updated_at` and the
`comparing` state were added to the row of the plan.
