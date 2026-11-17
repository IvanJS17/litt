# Client profile of a retainer matter

**Status:** Shipped in production (PR #220, deploy `20261116` to `20261117a`); no flag.

The client profile ("ficha del cliente") is the list of facts a lawyer knows
about a retainer client, taken from the matter's own documents: a contract, a
date, a power of attorney, an obligation, or anything else worth keeping. It
lives in the same matter as the [requests](matter-requests.md) and follows the
same access rules. This first layer is **manual capture only**: nothing here
asks a model for anything, and nothing here computes a deadline.

## Rules

- **Every fact carries its source.** A fact is saved with the document version
  it cites, the exact passage, the character offsets of that passage in the
  version's extracted text, and the SHA-256 of that whole text. A fact without a
  citation is refused (400, `citation_required`). A passage that is not in the
  version's text is refused (422, `quote_not_found`) and nothing is saved. The
  passage is found with the same locator the chat uses (`locateQuote`), so a
  paste that differs in case, spacing or punctuation still matches; the fact
  keeps the passage as the document words it.
- **A lawyer confirms it.** A new fact is *pending*. Confirming or rejecting
  writes an insert-only event (who, when, and for a confirmation the hash of the
  text it stood on). A fact counts as confirmed only after that event exists.
  Pending becomes confirmed or rejected; a confirmed fact can still be rejected;
  a rejected fact is final. The database refuses any other order.
- **Dates are data, not computations.** A date fact stores what was entered: the
  kind (`effective`, `expiry`, `renewal_notice`), an ISO date and/or the rule as
  the document words it, and an optional `notice_days` with `notice_day_type`
  (`calendar` or `business`). Turning those into a deadline is the radar's job
  (code, never a model), and a business-day notice is for it to flag for review.
- **No hours.** No column or screen measures time worked.

## Stale facts

Whether a fact still stands on its source is computed **every time it is read**:
the version's current text is hashed and compared with the hash saved with the
fact, and the version must still exist as a live version of a live document of
the matter's project. No job watches a document. A pending or confirmed fact
reads `stale` with a reason when:

| `stale_reason` | Cause |
|---|---|
| `version_missing` | the version was deleted, or its document was archived or left the project |
| `text_unavailable` | the version exists but its text is not ready |
| `text_changed` | the hash of the text today differs from the saved one |

`effective_status` is `stale` in those cases and otherwise equals `status`
(`pending`, `confirmed`, `rejected`). A stale fact does not count as confirmed
and cannot be confirmed (409 `fact_stale`) until it is captured again from the
current text; it can be rejected. A rejected fact is never stale. If the text
goes back to what was cited, the fact reads normally again: nothing was stored.

## Who can do what

Same model as requests (`authorizeMatterMember`): an active matter membership
plus a current organization membership. A firm owner or admin without a
membership, a removed member and a stranger get 404. Owners and editors of the
matter capture, confirm and reject; viewers and technical operators read.
Only a private matter marked as a retainer takes facts (409
`matter_not_retainer` otherwise; a public matter fails closed).

## API

All under `/projects/:projectId/matters/:matterId/profile`:

| Route | Who | |
|---|---|---|
| `GET /` | member | `{ retainer, can_write, facts, versions, people }`. `versions` (the live versions a fact can cite) is empty for readers |
| `POST /facts` | owner, editor | `{ kind, label, data, source: { version_id, quote } }` → 201 |
| `POST /facts/:factId/confirm` | owner, editor | optional `{ reason }` → the fact; 409 `fact_already_decided`, `fact_stale` |
| `POST /facts/:factId/reject` | owner, editor | optional `{ reason }` (≤ 500) → the fact |

Fields by kind (`data`, unknown keys refused): `contract` (`counterparty`,
`object`), `date` (`date_kind`, `date_on`, `rule_text`, `notice_days`,
`notice_day_type`), `power_of_attorney` (`grantee`, `scope`, `granted_on`,
`expires_on`), `obligation` (`description`, `periodicity`), `other` (`note`).

## Data

Migration `20261116_60_litt_matter_profile_facts.sql`:

- `matter_profile_facts`: one datum and its single source. Insert-only
  (trigger); only into a private retainer matter. The document and version
  columns have no foreign key on purpose, so a fact outlives a deleted version
  and reads as stale.
- `matter_profile_fact_events`: insert-only `created` / `confirmed` / `rejected`
  events. A trigger locks the fact row and allows only the order above. The
  latest decision is the fact's state; there is no mutable status column.

The actor columns (`created_by`, `actor_user_id`) have no foreign key to
`auth.users`, so erasing an account is never blocked and the author link is
lost, as with requests. RLS: read by the matter's active roster; every write is
the backend's (`service_role`).

The account/firm export carries the facts the holder captured and the events
they recorded, in the matters they can still open (`matterProfileExport.ts`).

## UI

`/projects/:projectId/matters/:matterId/profile`, linked from the project
header menu and from a small section nav shared with the requests page. Facts
are grouped by kind; each shows its fields, the quote, the source file and
version, who captured and decided it, and its state as plain text. Editors get
the add form (kind, fields, document version, pasted quote) and the confirm and
reject actions. The app has no deep link that opens a document at a quote, so
the quote is shown in place with its file and version.

## What builds on this

The radar reads confirmed, non-stale facts (`status = confirmed` and no
`stale_reason`) through `loadFacts` of the `client-profile` facade; the
structured date fields above are its input. A later assisted extraction would
propose facts into the same table with the same citation check.
