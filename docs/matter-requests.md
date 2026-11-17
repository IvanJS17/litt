# Requests inside a retainer matter

A retainer matter (an *iguala*) is a matter whose client sends the firm a
stream of small requests. LiTT keeps those requests inside the matter: what each
one is, its type, complexity, who has it and at what cost level, where it stands,
and the negotiation rounds of the documents that belong to it. The UI calls them
**Solicitudes** / **Requests**.

LiTT records **dates and a round count, never time worked**: no table, column,
API field or text holds hours, minutes or an estimate. The number of distinct
negotiation rounds is the effort measure.

## Decisions (S0)

- **The unit is the matter.** A request belongs to exactly one existing matter
  (`matter_requests.matter_id`). There is no client entity. A matter is marked as
  a retainer with `matters.is_retainer`; only a **private retainer** takes
  requests. A public matter fails closed everywhere: it cannot be marked, and a
  request insert into it is refused by a trigger. A matter that is not a
  retainer (a lawsuit, say) is an ordinary matter and nothing here applies.
- **Who reads and writes.** Both need the project gate (`checkProjectAccess`:
  private matters are closed to everybody outside their team, and leaving the
  organization ends access) **and** an *active explicit matter membership*. An
  organization owner or admin without a membership gets the same `404` as a
  stranger. Writing needs the `matter_owner` or `editor` role; `viewer` and
  `technical_operator` read and get `403 matter_write_required`. The marking of
  the retainer is the `matter_owner`'s alone.
- **No cached decision.** Every request reads the current membership rows, so
  removing a matter member or an organization member ends their access on their
  next request. The tables hold no permission state and do not touch the
  authorization epoch. SQL read access (RLS) is
  `public.matter_role(matter_id) is not null`, the same helper the matter tables
  use.
- **Assignee.** An active `matter_owner` or `editor` who is still an
  organization member. Anyone else is refused (`400 assignee_not_eligible`). The
  **cost level** (`apprentice`, `junior`, `senior`, `partner`) is stored on the
  request, and is required whenever there is an assignee. The roles cannot name
  it alone, so the API only *suggests* it: a training stage (`pasante` is an
  apprentice, `junior` a junior) first, then the organization role (owner:
  partner, admin: senior), otherwise the lawyer chooses. A pasante can be
  assigned work, at the apprentice level.
- **Export.** The firm-workspace account export (`account`, organization scope)
  carries `matter_requests` that **name the holder** (creator or assignee) and
  `matter_request_events` the holder recorded, only for matters whose project the
  holder can still open **and** where their membership is active. Other people's
  requests and matters the holder was removed from stay out. Personal's export
  carries none: requests live in a firm's matters.
- **Account erasure.** `created_by`, `assignee_user_id`, `actor_user_id` and the
  catalog's `created_by` have **no foreign key** to `auth.users` (the pattern of
  `audit_events`), so deleting an account is never blocked and the request,
  its history and its rounds stay with the firm. The person then reads as a
  former member. The Postgres test deletes an account named on a request.
- **No deletion.** A request ends as `closed` or `cancelled`. There is no
  `DELETE` for requests, and the database refuses one (events reference it).

## Data

Migration `20261116_30_litt_matter_requests.sql`.

| Table | Content |
|---|---|
| `matters.is_retainer` | the retainer mark |
| `matter_request_types` | the firm's catalog. A default has `seed_key` and no `name` (the app words it in the reader's language); renaming stores a name. Archived, never deleted |
| `matter_requests` | `title`, `type_id`, `complexity` (`routine`, `standard`, `complex`), `status`, `assignee_user_id` + `assignee_level`, `received_on`, `closed_on`, `version` |
| `matter_request_rounds` | an existing `document_versions` row linked to a request with `round_number` and `round_date` |
| `matter_request_events` | insert-only: `created`, `edited`, `status_changed`, `assigned`, `unassigned`, `round_linked`, `round_unlinked`, with field names, states and ids only (never the title) |

The states are `received`, `in_review`, `with_client`, `with_counterparty`,
`closed` (signed or closed) and `cancelled`. `closed_on` is set exactly when the
state is `closed` or `cancelled`; reopening clears it. The default types are
contracts with clients, contracts with suppliers, intellectual property,
shareholder meetings, corporate books and other; they are created for a firm on
its first read.

`matter_request_events` has a `before update or delete` trigger that raises, like
`audit_events`. RLS is on every table: members read, nobody in the browser
writes (only `service_role`).

## API

| Route | Who |
|---|---|
| `GET /projects/:projectId/matters/:matterId/requests` | active matter member. Answers `retainer`, the requests (with `round_count`), the catalog, the assignable people (owners and editors only see them) and `can_write` |
| `POST` the same path | matter owner or editor; the matter must be a private retainer |
| `GET .../requests/:requestId` | member; with rounds and events |
| `PATCH .../requests/:requestId` | owner or editor; carries the `version` read, a stale one answers `409 request_version_conflict`; one event per kind of change, none for a no-op |
| `POST .../requests/:requestId/rounds` | owner or editor; links a live version of a document **of the matter's project**; the round number defaults to the next one; a version is a round of a request once (`409 round_already_linked`) |
| `DELETE .../requests/:requestId/rounds/:roundId` | owner or editor; unlinks the round, the document stays |
| `PUT /projects/:projectId/matters/:matterId/retainer` | matter owner; unmarking is refused while requests exist (`409 retainer_has_requests`) |
| `GET/POST /orgs/:orgId/request-types`, `PATCH .../:typeId` | read: any member of the team organization; write: owner or admin (audited) |
| `GET /orgs/:orgId/requests/counts?period=month\|quarter&date=YYYY-MM-DD` | firm owner or admin, **counts only** (see below). A member, a matter editor or viewer: `403 org_admin_required`; not in the firm, or a personal organization: `404` |

Rounds reuse the documents' versions: this module only **reads**
`document_versions`/`documents` to check ownership and never writes a version row
(`modules/documents/` owns them).

The matter's project detail (`GET /projects/:id`) adds `matter_id` and
`matter_retainer` for a private matter, which is how the project page offers the
**Requests** entry (its header menu). The page is
`/projects/:id/matters/:matterId/requests`; the catalog is a section of
**Ajustes del despacho › General**.

## Firm counts

An owner or admin who is not on a private matter's team cannot open it, so they
never read its requests. What they get is **numbers**: `GET
/orgs/:orgId/requests/counts`, drawn in **Ajustes del despacho › General**
(section "Request counts", owners and admins only, beside the type catalog).

- **Source.** The `security definer` function `matter_request_counts(org, user,
  start, end)` (`20261116_50_litt_matter_request_counts.sql`; ordinal 50 on
  purpose, another branch may add 40). Fixed `search_path`, `execute` for
  `service_role` only, and it re-checks that the user is an owner or admin of a
  team organization (`42501` otherwise), so a service bug cannot widen it.
- **No text, no names.** The answer holds counts, a day count and an opaque
  label per matter. A private matter's **name is not shown**: outside its team
  nobody sees it (not even the firm's owners; they already see ownerless matters
  without titles), so each retainer is **"Iguala N"**, N being its position among
  the firm's retainer matters by creation date. Types are the firm's catalog
  (visible to every member). No title, person, id of a request or matter.
- **Period.** `period` is `month` (default) or `quarter`; `date` is any day in
  it (default today in `America/Mexico_City`). The window is the whole month or
  quarter, both ends inclusive.
- **What is counted.** Every breakdown (per matter, type, complexity, assignee
  level, and state) counts the requests **received in the period**, in their
  state today (`total`, `open`, `closed`, `cancelled`; `unassigned` is a level).
  The totals add `open_at_end` (not closed or cancelled when the period ended),
  `closed_in_period` and `cancelled_in_period` (by `closed_on`, whenever
  received), `rounds` (distinct negotiation rounds of the received requests) and
  `median_days`: the **median of calendar days** `closed_on - received_on` of the
  requests *closed* in the period (never hours; cancelled ones are left out;
  `null` when none).
- **Audit.** Every read writes `request_counts.read` to `audit_events` (insert
  only) with the organization and period, **before** the numbers are returned;
  if the event cannot be written the read fails (`500`) and hands nothing over.

## Tests

- `src/__tests__/integration/matterRequests.routes.test.ts`: the permissions
  matrix (owner, editor, pasante, viewer, technical operator, stranger, firm
  admin, other firm, removed member), the lifecycle and its events, rounds, the
  catalog.
- `src/__tests__/integration/matterRequests.postgres.test.ts` (opt in with
  `MIKE_TEST_POSTGRES_CONTAINER`): the migration twice over the final schema,
  the retainer guard, constraints, insert-only events, RLS, no browser write,
  account deletion with no foreign key to `auth.users`.
- `src/__tests__/integration/matterRequestCounts.routes.test.ts`: owner and admin allowed (no matter membership), editor, viewer, stranger, other firm and personal organization refused, nothing but numbers in the answer, audit before the answer, bad period/date. The function's grouping, medians, privileges and the absence of any title or matter name are in `matterRequests.postgres.test.ts`.
- `src/application/exports/__tests__/buildJsonExport.matterRequests.test.ts`.
- `frontend/src/app/components/requests/*.test.tsx`.

## Not here

Hours, estimates or time tracking; a client entity; the public request form;
notifications; classification of requests by a model; the client's own view.
