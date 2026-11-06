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
(`prepare_account_org_departures`) and the deletion of the account row itself
release that mentor's pupils instead. Audit events are insert-only and stay.

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

Nobody is their own pupil. Each change writes one insert-only audit event, with
ids and labels only: `training.mentor_designated`, `training.mentor_removed`,
`training.pupil_assigned`, `training.pupil_released`, `training.stage_set`,
`training.stage_removed`.

## API

| Route | Purpose |
|---|---|
| `GET /training/me` | the caller's mentor, stages and mentor role, per organization |
| `GET /training/stage?org_id=&project_id=` or `?surface=word` | the caller's effective stage where a turn would run (the client only uses it to decide what to show) |
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

The composers (web and Word) show the required field
«Tu planteamiento (2–3 líneas)» with a counter when `GET /training/stage` says
`pasante`; the server decides either way.

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
| A10 approved AI review report | the reviewer | `append_ai_review_export` seals it when the backend passes `training_stage: 'pasante'` |
| U1 accept/reject an edit, U2 same-turn edit, U3 replacement (editor save) | the actor (`updateDocumentVersion` requires `actorUserId`) | a pasante seals the version in place |
| U4 conversion (rendition only) | — | no change |

A seal is never removed or handed to somebody else: the trigger
`document_versions_training_seal_keep` restores it on every update, so a
lawyer's change to a pasante's version leaves it sealed. The author has no
foreign key on purpose; the seal outlives the account. A read failure while
deciding a seal fails the write. Versions written before 1b have no seal.

### Approval

`POST /single-documents/:documentId/versions/:versionId/training-approval`
(`modules/documents/documents.trainingApproval.ts`, payload
`TrainingVersionApproval` in `packages/contracts`) records the approval of
the version's **current** `content_sha256` in `training_version_approvals`.
It can be given by a member with `content.edit` in the document's project
whose effective stage there is none, or by the author's current mentor; never
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
| Drive publication of the approved report | `409` before any claim or upload, although publication already fails closed outside the fake transport |

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
