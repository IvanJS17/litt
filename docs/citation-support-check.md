# Citation support check (TypeSafe, Jev) — silent store, hint for the low band

LiTT already checks that the text a citation quotes **exists** in the document
(`modules/chat/engine/verifyCitations.ts`). It does not check that the quote
**supports the claim** the answer makes. This capability asks Jev, the
TypeSafe model, that second question, and **stores the answer for the beta
statistics. The lawyer sees one thing from it:** a discreet hint, «Revisar esta
cita», next to a citation whose stored band is the low one (see «What the
lawyer sees»). Nothing is shown for any other band.

Design source: the 2026-11-14 report and pilot
(`artifacts/typesafe-20261114/INFORME.md`, `piloto/RESULTADO.md`).

## Status: built, on in production (silent)

| | |
| --- | --- |
| Server switch | `LITT_CITATION_CHECK=enabled`. Anything else, or unset, is off. On in production since 2026-11-16 (release `20261116a`). Off by default in the repository: `deploy/prod/compose.yaml` and `deploy/prod/.env.example` pass `disabled` unless the operator sets it. |
| Key | `TYPESAFE_API_KEY`, the **platform's**. There are no per-user or per-firm keys, no per-capability switch and no per-space switch. Without the key the check does not exist and nothing fails. |
| Who | Everyone who has accepted the current `LEGAL_VERSION`, with a personal **opt-out**: Settings › Privacidad y datos › «Verificar mis citas con TypeSafe» (`user_profiles.citation_check`, on by default). The card is not drawn where the deployment does not run the check. |
| Where | Every citation the chat engine verifies (the web chat, project chats and the Word add-in cloud chats), the citations of **tabular review cells**, the **tabular review chat**, and the verified **source quotes of playbook drafts**. See «Where it applies». The three newer paths need migration `20261116_10_litt_citation_support_scope.sql` applied before the backend that runs them is deployed. |
| What the lawyer sees | «Revisar esta cita» next to a citation in the low band, and nothing for the others. Owner decision «opción A», 2026-11-16 (see «What the lawyer sees»). |

### Legal texts (integrated in this change)

The owner decided the legal framing is the privacy notice plus the opt-out (no
activation dialog, no checkbox, no record of who accepted). socium-legal's
final texts for that model (task `t_661fa9a8`; they replace the BYOK-dialog
texts of `t_4a5e7fdb`) are in this same change:

- Terms (new 6.14; 6.1, 9.3.4, 15.6, 16.2.3), Privacy Notice (§5 table row and
  paragraph, §6, §7, §13) and the simplified notice, applied byte for byte
  from socium-legal's clean versions (the diff against `main` equals their
  redlines), with the `[NOTA]` dates filled with 15 de noviembre de 2026 and
  one edit: where the texts say «Ajustes → Privacidad» the screen is really
  **Ajustes → Privacidad y datos**, so they say that.
- `LEGAL_VERSION` is `2026-11-15` (frontend `content/legal/version.ts`, backend
  `user.profile.storage.ts`): everyone accepts again at the next sign-in.
- Interface text for the opt-out is `settings.citationCheck.enable` and
  `.help`, as delivered (es-MX and en-US).

**C1 (in code).** No citation is sent for a person whose
`terms_accepted_version` is not the current `LEGAL_VERSION`
(`citationCheckPermitted`). The check is silent about it; a person who has
not accepted yet (including anyone who only uses the Word add-in) is simply
not checked until they do.

Other promises the texts make, kept by the code: only the sentence, the quote
and a short piece of context go out (no file name, no user or firm data); the
result is stored without text and deleted with the answer; the opt-out is read
for the person whose turn it is; and **no human labels real citations** in the
silent stage (Terms 6.14.3 and 8.2).

### Turning it on in production

Production runs with `LITT_CITATION_CHECK=enabled` and the platform's
`TYPESAFE_API_KEY` in `/srv/litt/.env` (never in the repository). To turn it on
elsewhere: deploy a release that carries the legal texts and the current
`LEGAL_VERSION`, set both variables in `deploy/prod/.env` and redeploy the
backend. To turn it off, set `LITT_CITATION_CHECK=disabled` and redeploy; a
person can also opt out for themselves in Settings.

## What happens

After an assistant answer with citations is **saved** (and only if the answer
did not end in an error or a pause for input):

1. The engine hands over, for each verified document citation, the **claim**
   (the sentence or table row of the answer that carries the `[n]` marker),
   the **quote** (the exact text found in the document; the quotes of a
   citation with several are joined with `[...]`) and the **context** around
   it (`lib/citationSupport/inputs.ts`). A citation whose text was not found,
   whose marker is not in the prose or whose document cannot be read is
   skipped: the text check already flags the first and there is nothing to ask
   in the others.
2. Detached from the turn (`createCitationSupportTurn().finish`, not awaited),
   **one request per citation, in parallel** (6 at a time, at most 25
   citations per answer) goes to `POST https://api.typesafe.ai/v1/systemone`.
3. Each answer is written to `citation_support_checks`.

Not on the hot path: the stream has already ended and the answer is saved when
this starts. It is an in-process task, not a `db_jobs` row on purpose: a durable
job would have to carry the claim, quote and context in its payload, and the
point is that no text is stored.

### The question (the pilot's winner)

The Noul question with the rich instructions, verbatim
(`SUPPORT_QUESTION` in `lib/citationSupport/typesafe.ts`, from
`piloto/scripts/questions.py` `NOUL_RICO_V2`), over the state
`{afirmacion, cita, contexto}`. Model **`jev-1.14.0`, pinned** (never
`jev-latest`; the bands were measured on this version). `QUESTION_VERSION =
noul-rico-v2` is stored with every result; change the question, the bands or
the model and it must change.

| p(supports) | band |
| --- | --- |
| `< 0.3` | `not_supported` |
| `0.3 – 0.7` | `review` |
| `≥ 0.7` | `supported` |

Pilot result (192 hand-written test cases, one contract, one annotator): 97.2 %
of the bad citations below 0.5, 0/50 false alarms, 6.3 % in the review band,
p95 189 ms. See the pilot report for the limits. **A `supported` is a signal,
never a seal** (1 of 49 `supported` was an exaggeration).

### Context

Same as the pilot: the quote's paragraph, or ±450 characters around it snapped
to sentences when the paragraph is longer. The pilot's contexts averaged 796
characters and reached about 1,400. `MAX_CONTEXT_CHARS = 1400` is a **technical
ceiling** so a document without paragraph breaks never goes whole to the
service; the legal texts say «un fragmento breve» and promise no number.

### Errors

Errors are static codes (`CitationSupportError.code`); the message never
contains the key, the claim, the quote, the context or TypeSafe's response
text.

| Response | Behaviour |
| --- | --- |
| 401, 402, 403 | Never retried. The remaining citations of that answer are not sent. |
| 429, 5xx (529) | Retried **once**, after `Retry-After` (capped at 5 s) or 1 s. |
| Other 4xx, redirect, network, timeout, malformed 200 | Not retried. |

Any failure leaves one `[report]` (warning, tag `component=citation-support`,
`failure_code`, counts) per answer and nothing else. No answer is delayed,
changed or failed by this. Redirects are refused (`redirect: "manual"`) so the
key cannot follow one to another host.

## What leaves LiTT

Per citation: the claim sentence, the quote and the context, plus the key in
the `Authorization` header. The body is exactly `{model, state, questions}`;
the headers are `authorization`, `content-type`, `accept`. **No** file name,
document, matter, firm or user id, name or email, and no custom `User-Agent`.
(TypeSafe knows whose account the key is: LiTT's.) Tests pin this.

## What is stored

`citation_support_checks` (migrations `20261114_20_litt_citation_support.sql` and `20261116_10_litt_citation_support_scope.sql`):

| Column | Meaning |
| --- | --- |
| `message_id` / `word_message_id` / `tabular_cell_id` / `tabular_chat_message_id` / `playbook_id` | The row the result belongs to: a chat message, a Word chat message, a tabular cell, a tabular review chat message or a draft playbook (**exactly one**, `citation_support_checks_one_owner`). Which path a result came from is the column that is set. `on delete cascade` for each. Migration `20261116_10_litt_citation_support_scope.sql`. |
| `organization_id` | The firm of the space, or null in a personal space. A count reference, not a foreign key. |
| `citation_ref` | The `[n]` of the citation. |
| `document_id`, `version_id`, `start_char`, `end_char` | Where the quotes are (offsets, no text). For a playbook draft, `document_id` is the stored source's id and the offsets are in its text. |
| `probability`, `band` | Jev's answer and its band. |
| `model`, `question_version` | The model that answered (the response's own `model`) and the question. |
| `latency_ms`, `input_tokens` | For cost and speed. |

- **No text** of the claim, the quote or the context, no key, no person.
- **It lives and dies with its owner.** Deleting the message (or its chat, or
  the Word chat), the tabular cell (or its row or review), the review chat
  message (or its chat) or the draft playbook deletes the results. It is **not** independent evidence and
  not part of the insert-only AI/audit records; rows are only never *updated*
  (a trigger refuses it).
- Unique per `(owner, citation_ref, question_version)` (one partial index per owner column).
- RLS is on and the only policies are the backend's (`service_role`); the
  browser roles have no grant. The migration also adds
  `user_profiles.citation_check boolean not null default true`.

## What the lawyer sees

Owner decision «opción A» (2026-11-16): next to a citation whose stored band is
`not_supported` (p < 0.3, «may not support»), the screen shows the plain-text
hint **«Revisar esta cita»** (en-US «Check this citation»), small, in the
warning tone (`text-warning`, no pill, no icon). Its description, for assistive
technology and as the tooltip, is «La revisión automática indica que el texto
citado podría no respaldar lo que se afirma. Revísalo antes de usarlo.»
(`assistant.citationReview.label` / `.description`). **Nothing is shown for the
`review` and `supported` bands**: no check mark, no «verified», no number. This
is screen text only; no legal text changed.

What the server returns is only the list of citation numbers in the low band
(`review_refs`, ascending), never a probability or another band:

| Surface | Where it travels | Authorization (the same as reading the owner) | Where it is drawn |
| --- | --- | --- | --- |
| Web chat, project chat | `review_refs` on each assistant message of `GET /chat/:chatId` | `getAccessibleChat` (visibility) before the transcript is read | after the citation pill in the answer and in the sources list (`MarkdownContent`, `CitationsBlock`) |
| Cloud Word chat | `review_refs` on each assistant message of `GET /word-chat/:chatId` | the Word document and chat access checks | **not drawn yet**: the add-in's markdown renderer (`word-addin/src/shared/chat/Markdown.tsx`) has no per-message context; the data is already in the payload |
| Tabular review cells | `review_refs` on each cell of `GET /tabular-review/:reviewId` | `ensureReviewAccess`, and only the cells whose row the reader may see | after the pill in the grid cell, the expanded cell and the side panel (summary then reasoning, as the refs are numbered) |
| Tabular review chat | `review_refs` on each assistant message of `GET /tabular-review/:reviewId/chats/:chatId/messages` | `ensureReviewChatReadAccess`, and only the messages the reader may see | after the pill in the answer |
| Playbook drafts | `reviewSources` (`{ ruleId, legalIndex }[]`) on `GET /playbooks/:id` | `getPlaybook` (playbook access) | in the rule's origin: next to the quote of a clause origin and next to the flagged legal reference |

`lib/citationSupport/review.ts` reads with the service role and performs **no**
authorization of its own: every caller passes only owner ids it already
authorised and attaches the answer to the same payload. It returns nothing when
`LITT_CITATION_CHECK` is not `enabled`, counts only the current
`QUESTION_VERSION`, and a failed read is one `[report]` and no hint, never a
failed payload. The person's opt-out is not consulted on read: what exists is
shown.

**Playbooks.** A draft's refs are positions of the quotes in the content as it
was drafted (`citedQuotes` in `playbooks.citationSupport.ts` is the one walk
used both to check and to read the result back). Once the playbook changes (its
`updated_at` is later than its first stored result; marking it ready counts) the
positions could point at another rule, so nothing is returned: the hint belongs
to the draft under review.

**Timing.** The check runs after the answer, the cell or the draft is saved, so
its result arrives seconds later. The web app reads the results again **twice**,
10 s and 40 s after an answer, a run, a cell regeneration or a freshly drafted
playbook is on screen (`useDelayedReviewRefs`), and takes only the refs from the
reply. No polling, no sockets. A tabular run is read through the review detail,
a chat through the chat, the review chat through its message list.

## Owner's query

Settings › Estadísticas de la beta (platform administrators only) has a
section «Verificación de citas (modo silencioso)»: counts per **band and UTC
day** over the last 30 days, with a total row (`citation_check` in
`GET /platform/stats`). No text.

## Where it applies, and where it does not

Every path uses the same code (`lib/citationSupport`: the runner, the inputs,
the TypeSafe client) and the same rules: the platform key, the server switch,
the opt-out and acceptance of **the person whose action triggered the
generation**, the same payload, the same question and model, silent, after the
result is saved, never awaited. Each path has a thin adapter that builds the
inputs from what it already holds.

| Path | Adapter | What is checked | Owner of the result (`citation_support_checks`) |
| --- | --- | --- | --- |
| Web chat, project chats, cloud Word chat | `engine/streaming.ts` hook `onCitationSupportInputs` (only where `verifyCitations` ran, never for subagents) | each verified document citation | `message_id` / `word_message_id` |
| Tabular review **cells** | `modules/tabular/tabular.citationSupport.ts`, called from `extractRowColumns` (the generate stream and the extraction worker) and from the single-cell regenerate | each inline `[[document:ID\|\|page:N\|\|quote:…]]` of the cell's summary and reasoning whose quote is found in the source document the row holds | `tabular_cell_id` |
| Tabular review **chat** | `checkTabularChatCitations`, after `saveTabularChatTurn` | each `<CITATIONS>` entry whose quote is found in the cited cell | `tabular_chat_message_id` |
| **Playbook drafts** | `modules/playbooks/playbooks.citationSupport.ts`, after the draft is saved in `compilePlaybookDraft` | each rule with `origin.kind = "clause"` and each `legalRefs` entry that `verifyDraftProvenance` kept as verified, and whose quote is located in the attachment | `playbook_id` (the draft) |

Per path:

- **Cells.** Claim: the sentence of the cell text that carries the marker (the
  citation markers become plain `[n]` and the chat's `claimForRef` finds the
  sentence). Quote: the cited text, as found in the document. Context: the
  quote's paragraph in the cited document's text (the row's own source text,
  already in memory), capped at 1,400 characters. A citation without a document
  id belongs to the row's only document, or is skipped. A quote the server
  cannot find in the document is skipped, as in the chat. `citation_ref` is the
  marker's order in the cell (summary first, then reasoning). A cell is
  regenerated in place, so the check of its previous content is deleted before
  the new one is written, also when the new content has nothing to check (the
  only place the table is ever deleted from besides the cascade; `service_role`
  has `delete` for it).
- **Tabular chat.** The chat's citations quote the review's **own cells**, not
  the source documents. The claim is the answer's sentence with the marker, the
  quote is the cited cell text, and the context is that cell's paragraph (the
  cell's words, without its citation markers). The citation's `col_index` is
  the `COL:n` position the prompt lists, translated to the column's own index
  before the cell is read (indexes have gaps once a column is deleted). This tests whether the assistant
  represented the cell faithfully, not whether the cell is right about the
  contract (the cell check does that).
- **Playbook drafts.** Claim: the rule's name and its standard's criteria (or
  its concept, or its guidance), clipped; for a legal reference, the rule's name
  and the reference text. Quote: the verified quote. Context: the attachment's
  text around it (`locateQuoteInSource` finds it under the same comparison as
  `verifyDraftProvenance`, without accents or case). `document_id` holds the
  stored playbook source id. A rule from the questionnaire (`origin.kind =
  "answer"`) or from general practice has no quote and is not checked. The
  correction-based and proposal paths (`playbooks.corrections.ts`,
  `playbooks.proposals.ts`) are not connected.
- **Not checked:** Word chats kept only on the device (no saved message), and
  anything whose quote the server could not place in a text.

`__tests__/scope.test.ts` pins which files may reach the library.

## Not done / next

- Showing the result to the lawyer: **done for the low band only** («Revisar
  esta cita», see «What the lawyer sees»). Not done and not decided: any label
  for the `review` and `supported` bands (never a check mark), and the hint in
  the Word add-in's markdown renderer (the payload already carries `review_refs`).
- Measuring false alarms on real citations (the pilot's 300-citation sample,
  two annotators). Reading real client text to label it is a separate
  permission question; the stored numbers alone give distributions, not
  accuracy.
- Fragments with ellipses or page breaks and OCR text were not tested in the
  pilot.
- Zero-data-retention is TypeSafe-enterprise only; the contract sets no
  deletion period without it (report §3).
