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

  In the personal space it is always none. A Word add-in chat belongs to no
  organization or project, so there only a stage for every practice area
  applies, from any organization the person holds one in, with `pasante`
  taking precedence over `junior`. A read failure fails the turn instead of
  answering "no stage".
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
goes through `backend/src/modules/training/`.

`chat_messages.training_attempt` and `word_chat_messages.training_attempt` keep
the approach a pasante wrote before a turn.

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

- carries `attempt`, at least 60 characters after trimming (at most 4,000);
  otherwise the server answers `400 training_attempt_required` before writing
  anything or calling a model;
- keeps the attempt with the user message (`training_attempt`), shown in the
  thread as «Tu planteamiento»;
- adds to the system prompt the instruction to open with a section
  «Contraste con tu planteamiento» (what is right, what is not, what is
  missing), then help in full, explain the reasoning and sources, and remind
  that the result is a training draft. The attempt is fenced like other user
  text and treated as data, not instructions.

For a junior or a lawyer, `attempt` is ignored. The surfaces are the web chat
(`POST /chat`), the project chat (`POST /projects/:id/chat`) and the Word chat
(`POST /word-chat`); answering an ask-inputs question continues a turn and is
not a new one. The tabular review chat is not a training surface in this
layer.

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
