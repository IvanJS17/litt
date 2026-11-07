# Training: mentors, pupils and stages (layer 1a)

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
- **Workflows.** A workflow and its assets have an organization but no
  project or matter, so no practice area: inside a workflow the effective
  stage is the stage for every practice area (`practice null`) in the
  workflow's organization, and a stage for one practice area alone never
  applies there. The workflow's own `practice` label is a catalog tag, not a
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

### Reading the notes

`GET /training-notes/chats/:chatId` (optionally `?message_id=`) returns
`{ notes }` for a chat of any surface. Only the author and the author's
**current** mentor (`training_pupils`) can read a note; owners, admins, other
participants of the chat and a previous mentor cannot. Any other case, and any
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
  stages; «Mis pupilos» lets a mentor take members without a mentor, set their
  stage per practice area («Todas las materias», the practice options, or
  another), and release them.

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
| `training_defenses` | `id` | an oral defense: `practice` (normalized or null), optional `work_review_id` of the same pupil (set to null if that review goes); `questions` ready = five, exactly one `cambio_de_hechos`; `outcome in ('approved','not_approved')` with `held_at`, recorded once (`LT002` on a change) |
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
about them there (empty lists until the layer-2 features land). A defense's
questions reach the pupil once its outcome is recorded, here and in the
account export (`training.work_reviews`, `training.defenses`,
`training.urgency_passes`).

The rule's role matrix, deletion and a generic check of every
`public.training_*` table with `trainee_user_id` run against PostgreSQL in
`backend/src/__tests__/sql/performance.litt-training-supervision.sql` (CI,
schema-drift workflow) and `trainingSupervision.postgres.test.ts` (local, with
`MIKE_TEST_POSTGRES_CONTAINER`).

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
