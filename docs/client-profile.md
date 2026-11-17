# Client profile of a retainer matter

**Status:** Shipped in production (PR #220, shipped by deploy `20261117a`); assisted extraction shipped by deploy `20261117d` (PR #232); no flag.

The client profile ("ficha del cliente") is the list of facts a lawyer knows
about a retainer client, taken from the matter's own documents: a contract, a
date, a power of attorney, an obligation, or anything else worth keeping. It
lives in the same matter as the [requests](matter-requests.md) and follows the
same access rules. Facts are captured by hand, or proposed by the space's AI on the lawyer's click
(see "Assisted extraction"); nothing here computes a deadline.

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
| `GET /extraction` | member | `{ route }`: the provider and model the text of a version would go to, or `null` (no key or model, or the caller only reads): no button then |
| `POST /versions/:versionId/extract` | owner, editor | assisted extraction → `{ proposed, discarded_quote_not_found, discarded_invalid, discarded_duplicate, fact_ids }` |

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

## Assisted extraction

On the lawyer's click ("Proponer datos con IA"), the AI of the space reads **one
version** and proposes facts, each with a quote. It is a synchronous request
(the key never travels in a job) and the button never starts OCR or a split:
a version without ready text is refused (422 `source_text_unavailable`).

- **Same route as the chat, never LiTT's key.** The model is what the project chat would pick for
  this person (`resolveUserChatSelection`), the key is what the chat's key
  selector preselects for a new conversation (`listChatCredentialOptions`) but
  only if it is the person's own key, else the organization's: **never the
  deployment's key** (nor an operator route), even where the chat would fall to
  it (`source` of the preselected option must be `personal` or `organization`).
  With neither, `GET /extraction` answers `{ route: null }` (no button) and the
  POST fails with `missing_api_key` before any provider call or egress record.
  The route is governed
  like a chat's (`governChatRoute`): only that credential is in the key bag and
  every other provider is switched off. No key or model fails closed with the
  chat's own code (`model_required`, `missing_api_key`,
  `chat_route_credential_required`, …) before anything is sent. There is no
  fallback to another provider, key or model.
- **What is sent, and only this**: the fixed system prompt (`EXTRACT_SYSTEM_PROMPT`)
  and the version's text between two fence lines carrying a random code per call
  (`buildExtractionPrompt`). Not the file name, the matter or client name, the
  account, profile, instructions or memory, any chat, other documents or the facts
  already in the profile. No tools. The call leaves the server; it never goes to
  TypeSafe, LandingAI, a web search or Jev (a test reads the module's imports).
  The egress is recorded in the audit log (`llm.egress`, surface
  `profile_extraction`: provider, model, credential reference, host, matter and
  version ids; never content) **before** the call, and if it cannot be recorded
  nothing is sent.
- **Size.** Up to 120,000 characters of text, counted as JavaScript string length (UTF-16 code units) (`MAX_EXTRACT_TEXT_CHARS`); above
  it the run is refused (422 `extraction_text_too_large`). At most 25 items are
  read per run; the rest count as discarded.
- **Closed output.** The model answers one JSON array of
  `{ kind, field, label, value_raw, quote, page }` with `kind`/`field` from a short
  list (`date`: `effective`, `expiry`, `renewal_notice`; `obligation`:
  `description`; `other`: `note`). Anything else (other keys, other pairs, prose
  around the array) is discarded and counted; an answer that is not an array is
  refused (422 `extraction_output_invalid`) and saves nothing. The text of the
  contract is data: whatever it says to the model changes nothing, because the
  answer is only ever read through that schema.
- **Citations verified.** Each `quote` is looked up in the version's text with
  `locateQuote`, as the manual path does (case, spacing and line breaks may
  differ). Found: saved with the passage as the document words it, offsets and
  hash. Not found: discarded and counted (`discarded_quote_not_found`).
- **Dates by code.** The model copies `value_raw`; `client-profile.dates.ts`
  reads `2027-03-15`, `15/03/2027` (day first) and `15 de marzo de 2027`, and a
  notice period written with digits. A date it cannot read with certainty (for
  example `03/04/2027`) stays as the rule as the document words it, which the
  radar flags for review.
- **Pending, one by one.** A proposal is a normal fact (same insert as the manual
  path) with its `created` event marked `reason = assisted_extraction`, so it
  reads "proposed with AI" in its history. Nothing reaches the radar until a
  lawyer confirms it; confirming and rejecting are the existing per-fact actions.
  A passage already in the profile for the same fact and the same document
  version (rejected or not) is not proposed again (`discarded_duplicate`); the
  same text uploaded as a new version can be proposed again.
- **Rate limit.** 10 runs per person per 15 minutes
  (`RATE_LIMIT_PROFILE_EXTRACT_MAX`, `RATE_LIMIT_PROFILE_EXTRACT_WINDOW_MINUTES`), keyed by user.
- **Failures.** 422 `extraction_provider_failed` (the provider could not answer),
  `extraction_provider_refused` (it rejected the key or the request) and
  `extraction_output_invalid`; nothing is saved by a failed run. They are 422 and
  not 5xx on purpose: the API gateway rewrites every 5xx and drops the code.
- **Kinds not proposed.** `contract` and `power_of_attorney` need two required
  fields (counterparty and object, grantee and scope), so they stay manual.

UI: under the profile's header, writers whose space has a route see a panel
with the version picker, the button, the line "The text of this version will be
sent to {provider}, using your own key or your firm's key, never LiTT's. Each suggestion
stays awaiting confirmation until a lawyer reviews it." (the provider is the
route's, named before the click), the result of the run and the proposals
awaiting confirmation, each with Confirm and Reject.

## What builds on this

The radar reads confirmed, non-stale facts (`status = confirmed` and no
`stale_reason`) through `loadFacts` of the `client-profile` facade; the
structured date fields above are its input. Assisted extraction proposes facts
into the same table with the same citation check.
