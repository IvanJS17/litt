# Retainer report

**Status:** Shipped in production by deploy `20261117d` (PR #230); no flag.

The retainer report ("reporte de la iguala") is the document a lawyer sends to
the client of a retainer matter: what was handled in the last 30, 60 or 90
days, which facts of the [client profile](client-profile.md) were confirmed,
and which [radar](deadline-radar.md) dates fall in the next 30, 60 or 90 days.
**LiTT sends nothing.** The lawyer downloads a Word file, sends it by their own
means and then records, by hand, that it was sent. The client has no account.

It lives in the same matter and follows the same access rules as the
[requests](matter-requests.md), the profile and the radar. No model is
involved: every number and date is computed by code.

## What it says

The period is the last N calendar days **ending today** in America/Mexico_City,
both ends included (90 days: today and the 89 before it); the look-ahead is the
N days after today. N is 30, 60 or 90 (default 90).

| Section | Content |
|---|---|
| Requests handled | Requests received in the period, closed in it, or still open at its end; counted by type, complexity, level of who handled them and state. |
| Closed in the period | One row per closed request: type, complexity, received and closed dates, **calendar days** to resolution, negotiation rounds (distinct round numbers). Total rounds and the mean of days. |
| Open requests | Received on or before today and not closed: state, days open so far, rounds. |
| Client profile | Number of confirmed, not stale facts today, and the facts confirmed in the period. |
| Upcoming deadlines | Radar items with a date from today to N days ahead that are open or acknowledged. Items without a date, dismissed, done or overdue are left out. |

**Only confirmed data.** A pending, rejected or stale fact yields nothing, in
the profile numbers or in the radar (the radar derives items only from
confirmed, not stale facts). The report carries two fixed texts, in the report's
language, under the title and again at the end:

1. The planning-aid text (*"Ayuda de planeación. La fecha no es un término legal
   y LiTT no calcula términos procesales."*).
2. Right after it, the scope note (*"Solo incluye los datos que el despacho
   confirmó en los documentos revisados; puede haber vencimientos que no
   aparezcan."*), because an unconfirmed fact never appears.

**Never hours.** The retainer is a fixed fee: the report counts requests,
rounds and calendar days. No field, column or label of the report, the table or
the Word file names hours, time worked, rates or estimates; the tests scan the
JSON keys and the document text for them.

## API

All under `/projects/:projectId/matters/:matterId/report`, optional
`?locale=es-MX|en-US` (default `es-MX`; the Word file is written in that language).

| Route | Who | Answer |
|---|---|---|
| `GET /:period` (`30d`, `60d`, `90d`) | owner, editor | the report as JSON (`RetainerReport`, `@mike/contracts`) |
| `GET /:period/docx` | owner, editor | the report as a Word file (attachment `reporte-iguala-YYYY-MM-DD.docx`), written by `lib/markdownDocx` |
| `POST /:period/sent` body `{ note? }` | owner, editor | 201 with the record of `matter_report_sent_events` |
| `GET /sent` | any active member | who marked a report as sent, when and for which period, newest first |

Access is the matter's: a person who is not an active member of the matter (an
organization owner or admin without membership included) gets 404; a viewer or
technical operator gets 403 `matter_write_required` on the report and may read
the history. A matter that is not a private retainer answers 404 (report) or
an empty history (`retainer: false`), and 409 `matter_not_retainer` on `POST`.
Generating the report or the file writes nothing.

## Storage

`matter_report_sent_events` (`20261117_40_litt_matter_report_sent.sql`): one
insert-only row per mark (matter, period start and end, period length, optional
note of at most 500 characters, actor, time). The period is recomputed by the
server from today, never taken from the client. A trigger refuses `UPDATE` and
`DELETE` and any matter that is not a private retainer; RLS shows the rows to
the matter's active roster; only the backend (service role) inserts. The actor
column has no foreign key to `auth.users`, so erasing an account is never blocked
by it. The report itself is never stored: it is computed on every read.

The account export carries the marks the holder made, in matters they can still
open (`matter_report_sent_events`), like the radar actions.

## UI

A **Reporte** page next to Requests, Client profile and Radar
(`/projects/:id/matters/:matterId/report`, also in the project's actions menu):
period selector (30, 60, 90 days), the preview, **Download Word**, **Mark as
sent** (with an optional note) and the history of reports sent. Members who
cannot write see only the history. Texts live in `packages/i18n`
(`retainerReport.*`, es-MX and en-US).
