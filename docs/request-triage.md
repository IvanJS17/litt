# Donna triage of requests

**Status:** In review (feature PR). On for every project as soon as it ships; no feature flag.

When a new request is created in a retainer matter (docs/matter-requests.md), Donna
reads it and proposes: its **type**, **complexity** and **urgency**, the **candidate
lawyer**, and a starting **strategy**, **follow-up questions** and **documents to draft**
with the playbooks linked to the type. Everything is a proposal. The lawyer accepts,
edits or discards each item; Donna never assigns anybody, never writes a request field
by itself and never sends anything to the client.

## Who does what

| Part | Engine | Key |
|---|---|---|
| Type, complexity, urgency, candidate | **Jev** (TypeSafe, `jev-1.14.0`) through `lib/jev.ts` | The platform's `TYPESAFE_API_KEY` (the one the citation check uses). Never the firm's key |
| Strategy, questions, documents to draft | The firm's own AI route (same route and governance as the project chat and the S8 suggestions) | The person's or the firm's key. Never the platform's or the deployment's |
| Alarm words | Code (`ALARM_WORDS`, versioned) | None |

- **No silent fallback.** If Jev fails, the card says «clasificación no disponible»; the
  firm's key is never used to classify instead. If the firm has no AI key the drafts do
  not run and the classification does.
- Jev is asked with **Choice** (type, complexity, candidate) plus a companion **Noul**
  («ninguna aplica») for type and candidate, and **Score** (three levels) for urgency.
  Under 0.3 on the Noul nothing is suggested; under 0.7 the card says «confianza baja».
- **What Jev is sent about people:** only an opaque key per candidate (`abogado_1`…) and
  their function in the matter («Responsable del asunto», «Colabora en el asunto»). No
  name, email or id. Types go as index keys with the firm's own names.

## What it reads

The request's **title** and the text of **all the documents linked to it as rounds** (the
latest round of each document, newest first), up to `TRIAGE_TEXT_BUDGET_CHARS`
(80,000 characters, below Jev's 32k-token limit per question). The card always says
«Leí N de M documentos» and names those not read (no text yet, or over the limit); a first
document that alone passes the limit is read in part and the card says so. Nothing else
leaves LiTT: no matter name, client profile, memory, chat, other requests, file names or
people other than the candidates' function.

> A request has no free-text body today (only a title), so «the text of the request» is its
> documents.

## When it runs

- **Automatically** on creating a request, in the background (`scheduleAutoTriage`
  in `requests.triage.run.ts`; the creation never waits for it and never fails with it),
  when the project's switch is on and the month's cap is not reached.
- **When a document is linked** to a request (a round), the same background run happens
  again, with no button (`scheduleDocumentTriage`). A burst of links waits 5 s and makes one
  run; a link while a run is going makes one more when it ends; and nothing runs when the
  documents (ids and versions) are exactly those the last run saw. It counts against the cap.
- A request that **already existed** is never analysed by itself: not when the switch is
  turned on, not when the card is opened.
- **Manually** with «Analizar ahora» / «Volver a analizar» (owner or editor of the
  matter, not in training). It counts against the cap.

## The project switch

`projects.donna_enabled` («Activar Donna en este proyecto»). Shown, checked, when a
project of a firm is created, with the legal help text under it. **On by default for new
and existing projects** (the column default backfills). The project owner or a firm admin
changes it (`PATCH /projects/:id { donna_enabled }`, the same gate as every project
setting); everyone else sees it read-only in the project details. Turning it off stops new
runs; saved cards stay. A private matter's project is closed to a firm admin who is not
on its team (404), as for any project setting.

## The monthly cap and the usage view

`DONNA_MONTHLY_RUN_CAP = 1000` runs per firm per calendar month (Mexico City), automatic
and manual together (`requests.triage.shared.ts`; change that one constant). At the cap a
manual run answers `429 donna_monthly_cap` («Límite mensual de Donna alcanzado para este
despacho») and an automatic one does not start; saved cards stay; it resumes on the 1st.

A person also has a daily cap: `DONNA_DAILY_RUN_CAP_PER_PERSON` (default `100`, environment
variable, positive integer) runs per calendar day (Mexico City), counting every run the
person causes, manual and automatic (an automatic run belongs to the person who created the
request or linked the document). At it, a manual run answers `429 donna_daily_cap`
(«Alcanzaste el límite diario de análisis de Donna. Se reanuda mañana.») and an automatic
one does not start. Another person of the same firm still runs.

**A run takes its place before anything is sent.** Once Donna is on, the request exists and
the documents are not the ones the last run saw, the run calls `public.reserve_donna_run`:
in one transaction, under an advisory lock per firm, it counts the firm's places in the month
and the person's places in the day and inserts the place only if both are under their cap
(`ok`, `monthly_cap` or `daily_cap`). Only then is anything sent. A run refused because the
documents are unchanged takes no place; a run that fails after taking it keeps it. «Runs used
this month» (the cap and the usage view) is the number of places, from
`matter_request_triage_reservations` (migration `20261124_20_litt_donna_run_reservation.sql`,
insert-only; it also counted the runs that existed). The usage view's tokens, cost and
per-project figures still come from `matter_request_triage_runs`, so a place whose run never
got written counts as used and adds nothing to those figures.

`GET /orgs/:orgId/donna/usage` (firm owner or admin, shown in Ajustes del despacho ›
General): runs used and left, Jev runs with input/output tokens and cost
(`input_tokens × 0.042 / 1e6` USD), drafts runs, and runs per project under an opaque
«Proyecto N». Counts only: no title, no text, no project name.

## API

| Route | Who |
|---|---|
| `GET …/requests/:requestId/triage` | any active matter member: the card (latest run, items, decisions, playbooks, usage, `can_decide`, `pending`) |
| `POST …/requests/:requestId/triage` | owner or editor, not in training; a new run (409 `donna_disabled` if the switch is off, 429 at the cap, 409 `triage_in_progress`) |
| `POST …/requests/:requestId/triage/items/:itemId/decision` | the same; `{ action: accepted\|edited\|discarded, … }` |
| `GET /orgs/:orgId/donna/usage` | firm owner or admin |

**Deciding.** Accepting or editing a *type* or *complexity* changes the request through
the usual `PATCH` (`version`, `409 request_version_conflict`). An *urgency* or *candidate*
is recorded as the lawyer's decision and nothing more (the request has no urgency field and
Donna never assigns). A draft accepted or edited is the lawyer's own text in the decision
row. One decision per item; only the latest run's items can be decided. **People in
training see the card and cannot run or decide** (403 `triage_trainee`), as with rule
suggestions.

## Validation in code

A closed schema for the drafts (an extra key, a wrong type or an overlong line rejects the
whole draft output: «no se pudo proponer», no retry). A type, candidate, complexity or
playbook not in the list that was sent is dropped. A cited passage must be found in its
document with `locateQuote`, otherwise the step is dropped and counted
(`quotes_rejected`). Alarm words («emplazamiento», «notificación», «inspección», «demanda»)
force *urgente* and only ever raise it, even when Jev failed. Documents are data: the
prompt is fixed, has no tools, and delimits each document.

## What is stored (migration `20261119_80_litt_donna_triage.sql`)

All insert-only (update, delete and truncate raise), RLS read by the matter's roster, no
foreign key to `auth.users`:

- Each call of either engine also writes its tokens, engine and cost to `ai_call_usage`
  through `lib/aiCallUsage` (surfaces `donna_triage_jev`, `donna_triage`; docs/ai-call-usage.md).
- `matter_request_triage_runs`: engine, models, tokens, cost, hash of what was sent,
  characters, documents total/read/partial, ids of the versions read and not read,
  `quotes_rejected`, schema failures, duration. **No document text, no title.**
- `matter_request_triage_items`: a classification is an id or an enumeration; a draft is
  the model's own words (≤ 400 characters); a citation is a position and a hash, never
  the passage.
- `matter_request_triage_decisions`: accepted / edited / discarded, with what the lawyer
  chose or wrote.
- `matter_request_events` gains `triage_proposed`, `triage_accepted`, `triage_edited` and
  `triage_discarded` (ids and kinds, never text).
- `projects.donna_enabled boolean not null default true`.

An egress record (`llm.egress`, surfaces `donna_triage_jev` and `donna_triage`) is written
**before** each engine receives text; if it cannot be written, nothing is sent.

## Never

No message to the client; no assignment; no request written without a click; no time,
hours or estimate; no use of the learning history or the person's memory; no Jev outside
classification; no firm key for Jev; no platform key for the drafts.

## Tests

`lib/__tests__/jev.test.ts` (client contract), `requests.triage.shared.test.ts`,
`requestTriage.routes.test.ts` (auto-run, switch, permissions, cap, BYOK absent, no text
stored, decisions, usage), `projects.donna.test.ts`, `requestTriage.postgres.test.ts`
(opt in with `MIKE_TEST_POSTGRES_CONTAINER`), `dbDonnaReservation.supabase.test.ts` (the function and its lock, in CI), and the frontend `TriageCard`,
`DonnaUsageSettings`, `NewProjectModal` and `ProjectDetailsModal` suites.
