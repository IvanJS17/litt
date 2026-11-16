# Citation support check (TypeSafe, Jev) — silent mode

LiTT already checks that the text a citation quotes **exists** in the document
(`modules/chat/engine/verifyCitations.ts`). It does not check that the quote
**supports the claim** the answer makes. This capability asks Jev, the
TypeSafe model, that second question, and **stores the answer for the beta
statistics. The lawyer sees nothing.** Showing it is a later, separate
decision.

Design source: the 2026-11-14 report and pilot
(`artifacts/typesafe-20261114/INFORME.md`, `piloto/RESULTADO.md`).

## Status: built, off

| | |
| --- | --- |
| Server switch | `LITT_CITATION_CHECK=enabled`. Anything else, or unset, is off. **Off by default** (`deploy/prod/compose.yaml` passes `disabled`). |
| Key | `TYPESAFE_API_KEY`, the **platform's**. There are no per-user or per-firm keys, no per-capability switch and no per-space switch. Without the key the check does not exist and nothing fails. |
| Who | Everyone who has accepted the current `LEGAL_VERSION`, with a personal **opt-out**: Settings › Privacidad y datos › «Verificar mis citas con TypeSafe» (`user_profiles.citation_check`, on by default). The card is not drawn where the deployment does not run the check. |
| Where | Every citation the chat engine verifies: the web chat, project chats and the Word add-in (cloud chats). |
| What the lawyer sees | Nothing changes. |

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

`LITT_CITATION_CHECK` stays `disabled` in the repository and in
`deploy/prod/compose.yaml`. The coordinator turns it on at deploy time, after
the release carrying these texts and the new `LEGAL_VERSION` is live:

1. Deploy this release (texts, `LEGAL_VERSION`, migration `20261114_20`).
2. Set `TYPESAFE_API_KEY` and `LITT_CITATION_CHECK=enabled` in
   `deploy/prod/.env` and redeploy the backend.

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

`citation_support_checks` (migration `20261114_20_litt_citation_support.sql`):

| Column | Meaning |
| --- | --- |
| `message_id` / `word_message_id` | The answer: a `chat_messages` row or a `word_chat_messages` row (exactly one). `on delete cascade`. |
| `organization_id` | The firm of the space, or null in a personal space. A count reference, not a foreign key. |
| `citation_ref` | The `[n]` of the citation. |
| `document_id`, `version_id`, `start_char`, `end_char` | Where the quotes are (offsets, no text). |
| `probability`, `band` | Jev's answer and its band. |
| `model`, `question_version` | The model that answered (the response's own `model`) and the question. |
| `latency_ms`, `input_tokens` | For cost and speed. |

- **No text** of the claim, the quote or the context, no key, no person.
- **It lives and dies with the answer.** Deleting the message (or its chat, or
  the Word chat) deletes the results. It is **not** independent evidence and
  not part of the insert-only AI/audit records; rows are only never *updated*
  (a trigger refuses it).
- Unique per `(answer, citation_ref, question_version)`.
- RLS is on and the only policies are the backend's (`service_role`); the
  browser roles have no grant. The migration also adds
  `user_profiles.citation_check boolean not null default true`.

## Owner's query

Settings › Estadísticas de la beta (platform administrators only) has a
section «Verificación de citas (modo silencioso)»: counts per **band and UTC
day** over the last 30 days, with a total row (`citation_check` in
`GET /platform/stats`). No text.

## Where it applies, and where it does not

- **Connected:** `modules/chat/chat.routes.ts`, `project-chat/projectChat.routes.ts`
  and `word-chat/wordChat.routes.ts` pass the engine's
  `onCitationSupportInputs` hook (`modules/chat/engine/streaming.ts`, only
  where `verifyCitations` ran and never for subagents).
- **Not connected, on purpose:** the **tabular review** builds its citations
  with its own builder (`buildCitations`), which bypasses `verifyCitations`:
  it is another path, with another shape. **Playbooks** produce no citations
  through this verifier. Word chats kept only on the device (no saved message)
  are not checked, because there is no answer to attach the result to.
  `__tests__/scope.test.ts` pins this.

## Not done / next

- Showing the result to the lawyer (labels like «Probablemente respalda
  (estimación automática)», «Revisar», «Puede no respaldar»; never a check mark).
  It needs its own text from socium-legal.
- Measuring false alarms on real citations (the pilot's 300-citation sample,
  two annotators). Reading real client text to label it is a separate
  permission question; the stored numbers alone give distributions, not
  accuracy.
- Fragments with ellipses or page breaks and OCR text were not tested in the
  pilot.
- Zero-data-retention is TypeSafe-enterprise only; the contract sets no
  deletion period without it (report §3).
