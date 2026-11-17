# Deadline radar of a retainer matter

The radar ("radar de vencimientos") lists the dates that matter in a retainer
client's life (a contract that expires, the last day to give notice of
non-renewal, a power of attorney that lapses) **computed by code from the
confirmed facts of the [client profile](client-profile.md)**. A model never
produces a date. It lives in the same matter and follows the same access rules
as the [requests](matter-requests.md) and the profile.

The screen says it plainly: *planning aid; the date is not a legal deadline and
LiTT does not calculate procedural deadlines.*

## What counts

Only facts that are **confirmed** by a lawyer and **not stale** (the cited text
is unchanged; see "Stale facts" in the profile). A pending, rejected or stale
fact yields no item. The radar is **computed on every read**, so an item appears
when a fact is confirmed and disappears the moment it is rejected or its source
changes; if the text goes back to what was cited, the item comes back. Nothing
about the items themselves is stored.

## Date rules

All arithmetic is in **calendar days** over ISO dates (`radar.dates.ts`, pure and
unit-tested), independent of the server's zone or daylight saving. Months are
never computed: a fact stores a number of days, so "31 January + 1 month" cannot
arise; a notice written in months must be entered as days (or as the rule's
words, which computes nothing).

| Fact | Item |
|---|---|
| date / `expiry` with `date_on` | `expiry` on `date_on` |
| ... and `notice_days` in calendar days | also `notice` on `date_on - notice_days` |
| date / `renewal_notice` with `date_on` and `notice_days` | `notice` on `date_on - notice_days` |
| date / `renewal_notice` with `date_on`, no period | `notice` on `date_on` (the stored date is the notice day) |
| power of attorney with `expires_on` | `power_expiry` on `expires_on` |
| `effective` date, contract, obligation, other | nothing |

Boundaries are covered by tests: the exact day (today is "next", yesterday is
"overdue"), 29 February (leap and non-leap years, 1900/2100/2000 rules), the
year change, and the end of 28/30/31-day months.

**Business days ("hábiles") are never computed.** A notice in business days
becomes an item with **no date** and `review_reason: business_days`; it is shown
under "Por revisar" for a lawyer to resolve. **Missing data gives no date**: a
period or a rule with nothing to count from becomes a "to review" item
(`missing_date`); a date fact with nothing at all yields nothing. A date that
would leave years 1000 to 9999 is also "to review", never a wrong date.

**Today** is the date in **America/Mexico_City** (UTC-6, no daylight saving).
Buckets: `overdue` (before today), `next_30` (today through 30 days ahead),
`later`, and `review` (no date). Never hours.

## Actions and storage

Items have a stable key, `<fact id>:<type>` (`expiry`, `notice`,
`power_expiry`); a fact is never edited, so the key always names the same item.
The only stored data is what people did, in `matter_radar_item_events`
(migration `20261116_70_litt_matter_radar_events.sql`): **insert-only** events
`ack` (seen; the item stays open), `dismiss` (a reason of 1 to 500 characters is
required) and `done`. An item moves one way: ack, then dismiss or done; the
database refuses any other order (409 `radar_item_closed`). Each event keeps the
`due_on` the item had; an event recorded against another date is ignored, so an
item whose date changed starts over (a safeguard: with immutable facts it does
not happen today). The actor has no foreign key to `auth.users`. RLS lets the
matter's active roster read; every write is the backend's.

Note on re-running that migration: its header comment says constraints and
triggers are dropped before they are created. Only the trigger and the policy
are; the table's CHECK and foreign-key constraints are part of `create table if
not exists`, so a re-run leaves them as they are. The file shipped, so it is
not edited; `backend/schema.sql` carries the corrected comment. Events and the
"today" memberships are read in full, paged past PostgREST's `max_rows`.

This is the "compute on read + small insert-only table" option: there is no
materialized item table and no `superseded_by` column.

## API

| Route | Who |
|---|---|
| `GET /projects/:projectId/matters/:matterId/radar` | any active member |
| `POST .../radar/items/:itemKey/{ack,dismiss,done}` | matter owner or editor; body `{ "reason" }` (required to dismiss) |
| `GET /orgs/:orgId/radar/today` | member of the firm; only matters where the caller is an **active matter member** |

An organization owner or admin without a matter membership, a removed member and
a stranger get 404 on the matter routes and an empty "today". Only private
retainer matters have a radar (409 `matter_not_retainer` for actions; an empty,
`retainer: false` answer for reads). "Today" returns open items that are overdue,
due within 30 days, or to review, ordered by date, for at most 50 matters
(`truncated: true` says more were left out).

New client error codes: `radar_reason_required`, `invalid_radar_action`,
`radar_item_closed` (with `errors.code.*` sentences in both languages).

## UI

A **Radar** page next to **Solicitudes** and **Ficha del cliente**
(`/projects/:id/matters/:matterId/radar`, also in the matter's actions menu),
grouped into *Vencidos*, *Próximos 30 días*, *Más adelante*, *Por revisar* and
*Atendidos*. Each item shows the fact, its date and distance, how it was
calculated, and the cited passage with document and version. A **Hoy** block on
the home of a firm's workspace lists the caller's open items, with the empty
state *Sin vencimientos confirmados*.

The account export carries the radar actions the holder recorded, in matters
they can still open (`matter_radar_item_events`).
