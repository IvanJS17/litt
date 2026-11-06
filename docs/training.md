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
