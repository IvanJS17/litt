# Obligation rules of a retainer matter

**Status:** Shipped in production by deploy `20261117d` (PR #231); no flag; each rule is turned on per retainer matter by the lawyer.

Obligation rules extend the [deadline radar](deadline-radar.md). A rule is an
obligation of the law whose date LiTT **counts, in code, from a confirmed date
of the [client profile](client-profile.md)**: the annual shareholders' meeting
four months after the close of the fiscal year, the renewal window of a
trademark, the validity of an e.firma. The lawyer turns each rule on for a
retainer matter; the radar then shows one item per active rule. A model never
writes a rule, an operation or a date.

The screen carries the same notice as the radar: *planning aid; the date is not
a legal deadline and LiTT does not calculate procedural deadlines.*

## The catalog is data in code

`backend/src/modules/radar/data/radar_catalogo_s5_lote1.json` is the catalog as
the legal team delivered it, with the literal quotes untouched. 20 rules in the
first batch, all `verificada`: each carries one or more citations (law, article
and paragraph, literal text, official URL, last reform), legal's notes, the
consultation date, and the operations that count the date.

`radar.rules.catalog.ts` only maps those fields to the engine's types
(`radar.rules.ts`, pure). **Adding or changing a rule is editing the JSON** (a
changed rule gets a new `version`), plus its three sentences (name, "applies
when", the date it counts from) in `packages/i18n` under
`radar.rules.catalog.<code with dots as underscores>`, es-MX and en-US. No code
changes. `radar.rules.test.ts` validates every rule (citation with quote, URL
and last reform; valid operations; both languages worded; the Spanish wording is
legal's own) and that the batch still has the 20.

| Field | Meaning |
|---|---|
| `codigo`, version | `area.name` and a version (1 until a rule changes). A new version starts **off** in every matter |
| `tipo` | `plazo` (a last day), `ventana` (opens and closes), `vencimiento` (a validity that ends) |
| `calculo` | milestones `vence`, or `apertura` and `cierre`, each a chain of operations applied **in order** |
| operations | `dias`, `meses`, `anios` (negative counts back), `ajuste` `inicio_mes` / `fin_mes`, or `dias_habiles` |
| `ancla` | name of the date it counts from (shown as `dato_partida`) |
| `derivar_ancla_primer_ciclo` | how the first expiry is worked out from the grant date, with `solo_si` and `tope` shown to the lawyer, not computed |
| `estado` | `verificada` or anything else (loads as unverified) |

`verified` means a lawyer checked the rule against the official source. **A rule
that is not verified, or that fails validation, cannot be turned on**: 409
`obligation_rule_unverified`. If an active rule stops being verified in a later
release it is shown off and yields no items.

## Date rules

Over ISO dates, in code (`radar.dates.ts`, `radar.obligations.ts`), independent
of the server's zone; "today" is in America/Mexico_City. Never hours.

- Days are added as calendar days. **Months and years** keep the day of the
  month, and when the target month is shorter use its last day: 31 January + 1
  month = 28 February (29 in a leap year); 29 February + 1 year = 28 February.
  This is a conservative product convention, not a legal rule (CFF art. 12
  moves to the next business day, a later date).
- Operations apply in order: PTU is +3 months, **then** +60 days.
- `inicio_mes` / `fin_mes` move to the first / last day of that month.
- A window's item has `starts_on` (opening) and `due_on` (closing). A `cierre`
  with no operations is the anchor date itself.
- **Business days ("hábiles") are never computed**: the item has no date, is
  "por revisar" (`business_days`).
- A date that would leave years 1000 to 9999 is "por revisar", never a wrong date.
- Non-business days are not moved: the calendar date is shown.
- **No chained cycles.** A renewal needs the new expiry confirmed as a new fact;
  the radar never derives the next cycle by itself.

## Turning a rule on

Per retainer matter, by an owner or editor; members read. Turning a rule on
**names the anchor**: one confirmed, not stale `date` fact of the matter (the
list is `anchor_choices`), kept in the activation event with its mode:
`direct`, or `first_cycle` when the fact is the date the right was granted and
the rule works the first expiry out (`derivar_ancla_primer_ciclo`). To change
the anchor, name another while the rule is on: the system records an off and an
on. Repeating the current state changes nothing.

If the anchor fact later becomes pending, rejected, stale (its cited text
changed) or loses its date, the item is **"por revisar"** with
`review_reason: anchor_unavailable` and no date; it returns when the fact does.
Items show the rule name, how each date is counted, the citations with their
official URL, and legal's notes in plain text. Six rules carry a doubtful point
in those notes.

## Storage

Migration `20261117_30_litt_matter_obligation_rules.sql`, two **insert-only**
tables, no foreign key from the actor to `auth.users`, RLS (the matter's active
roster reads, every write is the backend's), explicit grants to `service_role`:

- `matter_obligation_rule_events`: `activate` (with `anchor_fact_id`, a fact of
  the same matter, and `anchor_mode`) or `deactivate`, per (matter, rule code,
  version). On → off → on; the database refuses the same state twice.
- `matter_obligation_item_events`: `ack`, `dismiss` (reason required), `done`
  on an item named `<rule_code>@<version>:<anchor fact id>`, in the same one-way
  order as the radar actions. Items themselves are computed on read. The order
  is per item **and per date**: re-anchoring the same fact in another mode
  (direct or first cycle) gives the item another date, which reads open again, so
  the guard (`20261117_50_litt_radar_item_guard_due_on.sql`) looks only at the
  events of the same key and the same date, as the read model does; before it, that
  item could not be acknowledged again (409 `radar_item_closed`).

The account export carries the decisions and actions the holder recorded, in
matters they can still open.

## API

Under `/projects/:projectId/matters/:matterId/radar` (private retainer matters
only; admins without a membership get 404):

| Route | Who |
|---|---|
| `GET /rules` | any active member: the catalog, which rules are on and from which fact, and `anchor_choices` |
| `POST /rules/:ruleKey/activate` | owner or editor; body `{ anchor_fact_id, anchor_mode? }`; `ruleKey` is `code@version` |
| `POST /rules/:ruleKey/deactivate` | owner or editor |
| `POST /items/:itemKey/{ack,dismiss,done}` | as for every radar item; obligation items use their key |

Client error codes: `obligation_rule_unverified` (409), `obligation_anchor_required`
(400: no, malformed or unavailable way of counting) and
`obligation_anchor_unavailable` (409: not a confirmed dated fact of the matter),
with `errors.code.*` sentences in both languages.

## UI

The **Reglas** section at the end of the Radar page lists every rule with its
name, kind, status (on, off, not verified), when it applies, what it counts
from, how each date is counted, the citations with quote and official link,
legal's notes and the verification. Editors turn a rule on by choosing the
confirmed date it counts from (and, where the rule allows, that the date is the
grant date), change that date, or turn it off. A rule that is not verified is
shown disabled with the reason. Items in the radar and in "Hoy" show the rule
name; "Hoy" also carries the fixed planning-aid notice.

## Rule suggestions

**Status:** built (slice S8a); not deployed until a reviewed release says so.

On the lawyer's click ("Sugerir reglas con IA", under **Reglas**), the AI of the
space reads **one version** of a client document already in the matter (articles
of incorporation, trademark titles, a REPSE certificate…) and says **which rules
of this catalog may apply** to the client, each with a literal quote. It only
chooses among rules that already exist and that a lawyer already verified: it
never writes a rule, an operation or a date. The lawyer decides whether the rule
applies to this client, with the quote in view.

### What leaves LiTT, per click, and what does not

It is a synchronous request from the server (the key never travels in a job).
**Leaves**, to the provider of the route the project chat would use in this
space, with that route's key:

1. The text of one version that has ready text (never the file, never OCR or a
   split).
2. The fixed instructions and the closed output schema
   `[{ rule_code, quote, reason, page }]`, at most 20 items
   (`buildSuggestSystemPrompt`).
3. The list of **verified** catalog rules, each with `codigo`, name and "aplica
   cuando" as legal worded them in Spanish. No citations, no notes, no
   operations. **The same list in every matter, whatever the client has turned
   on**: a list filtered by the rules a client has on would reveal them. Which
   rules are already on only decides what is discarded afterwards.
4. The technical data of the call (model, token cap, the credential of the
   route, the timeout), which go out from the server.

**Does not leave:** the file name, the matter or client name, the account, the
client profile (its facts), the instructions or memory of the person or the
firm, any chat, other documents or other versions, the decisions on earlier
suggestions. No tools. It never goes to TypeSafe, LandingAI, a web search or
Jev (a test reads the module's imports), and nothing is truncated: a text above
120,000 characters (UTF-16 code units, `MAX_EXTRACT_TEXT_CHARS`) is refused with
422 `suggestion_text_too_large` before any route lookup, call or egress record.

**Stored:** the quote as the document words it, with offsets and the SHA-256 of
the whole text; the model's explanation (`reason`, plain text, at most 200
characters, shown as "not verified"); and the decisions as events. The quotes
may contain third parties' data (partners, attorneys-in-fact): they follow the
rules of the client profile and live in the private retainer matter.

### Route, key and audit

Same as [assisted extraction](client-profile.md#assisted-extraction): the model
the chat would pick for this person and the key its selector preselects, **only
the person's own key or the firm's, never the deployment's**, governed like a
chat (`resolveExtractionRoute`, `governChatRoute`). With no key or model the
button is hidden (`GET .../rules/suggestions/route` answers `{ route: null }`) and
the POST fails with the chat's own code (`missing_api_key`, `model_required`,
`chat_route_credential_required`) before any call or egress record: no fallback
to another provider, key or model. The egress is recorded in the audit log
(`llm.egress`, surface `rule_suggestion_catalog`: provider, model, credential
reference, host, matter and version ids; never content) **before** the call, and
if it cannot be recorded nothing is sent (`recordChatEgressOrThrow`).

### How each suggestion is checked, in this order

1. `rule_code` is a rule of the catalog and verified, else
   `discarded_unknown_rule`.
2. The rule is not already on in the matter, else `discarded_already_active`.
3. The quote is found in the version's text with `locateQuote` (case, spacing,
   line-end hyphens), else `discarded_quote_not_found`; the quote saved is the
   document's, not the model's.
4. One suggestion per rule and rule version, **per version of the document**,
   decided or not, and one per run, else `discarded_duplicate` (a unique index
   also settles two runs that race).

An item with any key besides `rule_code`, `quote`, `reason` and `page` (a date, a
term, an operation) is out of the schema: discarded and counted
(`discarded_invalid`), as is anything beyond the 20th. An answer that is not a
JSON array is refused (422 `suggestion_output_invalid`) and nothing is saved.
Failures of the call are 422 `suggestion_provider_failed` /
`suggestion_provider_refused`. A quote proves the passage **exists** in the
document, not that it **justifies** the rule: that judgement is the lawyer's.

### Decisions

A suggestion has no status column: the latest event (`accepted`, `discarded`) is
its state, none means pending, and the database allows only
nothing → accepted or discarded, and accepted → discarded. **Accepting turns
nothing on**: it records the event and opens the existing turn-on form of that
rule, where the lawyer picks the confirmed date and confirms
(`POST .../rules/:ruleKey/activate`, unchanged). With no confirmed date, that form
says so and the suggestion stays accepted with the rule off. A suggestion is
**out of date** (computed on read) when the version's text changed or the version
is gone, or when the rule changed version or is no longer verified; an out-of-date
suggestion cannot be accepted (409 `suggestion_obsolete`), only discarded.

### Storage and API

Migration `20261119_20_litt_rule_suggestions.sql`, two insert-only tables (no
foreign key from the actor, document or version columns, RLS read by the matter's
active roster, writes only the backend's `service_role`):
`obligation_rule_suggestions` and `obligation_rule_suggestion_events`. The
account export carries what the holder suggested and decided, in matters they can
still open.

Under `/projects/:projectId/matters/:matterId/radar/rules/suggestions` (private
retainer matters only; an admin without a membership gets 404):

| Route | Who |
|---|---|
| `GET /` | any active member: the suggestions with their state, and the versions a run can read (writers) |
| `GET /route` | owner or editor: where the text would go, or `{ route: null }` |
| `POST /versions/:versionId/suggest` | owner or editor; MFA if enrolled; 10 runs per person per 15 minutes (`RATE_LIMIT_RULE_SUGGEST_MAX`, `RATE_LIMIT_RULE_SUGGEST_WINDOW_MINUTES`) |
| `POST /:suggestionId/accept`, `/discard` | owner or editor; body `{ reason? }` |
| `POST /batch` | owner or editor; `{ action: "accept" \| "discard", suggestionIds (≤ 50), reason? }`: each id goes through the same decision as the single route, one event each, a partial result is normal |

UI: in **Reglas**, owners and editors whose space has a route see the version
picker, the button and the line "The text of this version and the list of catalog
rules will be sent to {provider} using the key the chat uses in this space.
Suggestions are not exhaustive, and no rule is turned on until a lawyer reviews
it." Each pending suggestion shows the rule's name, "AI suggestion, not
verified", the quote with its file and version, the AI's explanation marked "not
verified" and its state as plain text, with Accept and Discard (optional
reason); two or more pending ones can be reviewed in a batch.
