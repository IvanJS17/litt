# Split a case file (layer 7)

A PDF that arrives with several documents inside (an escritura with its annexes,
IDs, tax certificates, a Registro Público boleta) can be split into one PDF per
document. **LandingAI Split** proposes the groups, the lawyer adjusts the
proposal in a preview, and LiTT creates the new PDFs. The original is never
touched. It is optional and works only with the same LandingAI key as the scan
reading ([`document-ocr.md`](document-ocr.md)): the person's or the firm's own.

## Behavior

1. **«Separar expediente»** appears in the document panel of a PDF only when a
   LandingAI key is available in that context (the firm's first; the member's own
   only if `allow_personal_api_keys` allows it, the same `resolveScanKey` as layer 6)
   and the person can edit the document. A document held for training answers 409
   `training_approval_required`.
2. The dialog first shows the notice (`documents.split.notice` and
   `documents.split.noticeDetail`, no checkbox: pressing the button is the
   instruction), the number of pages and the **estimated cost**: Split charges 1
   credit per 5,000 characters of Markdown and 1 credit = 0.01 USD, rounded up to
   0.1 credit. This step is local: nothing is sent.
3. **«Enviar y proponer la separación»** sends the text to LandingAI and returns
   its proposal. Nothing is stored and nothing is created.
4. **Editable preview.** One row per proposed document with its page range, a
   checkbox, a type (a select with the types of the list) and a name. Pages move
   between documents with a select per page (to another document or to a new one)
   and a document can be split before a page. Unchecked documents (blank sheets,
   for example) are not created. Adjusting is free; only the first classification
   is paid.
5. **«Crear documentos»** makes one new PDF per checked group, with the **original
   pages** (images included), in the original's folder, version 1,
   `source = 'split'`. All or nothing: if one cannot be made, those already made
   are removed. The proposed name is `Type — identifier` (for example
   «Constancia de situación fiscal — GACM701119BH5»), numbered `(2)`, `(3)`… on a
   collision with the folder or with another new document.

## The text that is sent

Split separates pages with `<!-- PAGE BREAK -->`, so LiTT builds the Markdown
itself, one entry per real page, in order: pdf.js text where the page has a text
layer, and the scan reading (layer 6) where it has not. Pages with no text layer
and no reading make the request fail **before sending** with 409
`split_needs_scan_reading` (ask for «Leer escaneado» first). Limits: 400 pages,
4 MiB of Markdown and 19 types (`split_too_large`, no call made). The Markdown is
sent as the file `documento.md`: **the real file name is never sent**
(LandingAI echoes the name, and firm file names carry client names).
`markdown_url` is never used.

## Rules shared with layer 6

- Fixed host `https://api.ade.landing.ai/v1/split` (United States; the EU region
  is not supported). `Authorization: Bearer <key>` is the only place the key
  travels; redirects are refused; the key never enters a log, an error, a response,
  a job or the audit.
- `split_class` is sent as a **JSON string** (a list answers 422).
- No retries (a 401/402/403/422 will not change, and a retry after a timeout could
  bill the same text twice), no automatic calls and no preloading: the only call
  to LandingAI is the one behind the button.
- Errors are static codes in `CODE_KINDS`: `ocr_key_missing` (409),
  `ocr_key_invalid`, `ocr_no_credits`, `ocr_not_supported` (400), `ocr_unavailable`
  (503), and the new `split_too_large` (400), `split_needs_scan_reading` (409),
  `split_not_supported` (400, not a PDF it can read) and `split_invalid_groups`
  (400), all in `errors.code` in en-US and es-MX.
- Each send is audited (`document.split_sent`: document, version, characters,
  credits; never the text, the file name or the key).

## Design decisions

- **Synchronous, not a job.** Split answers on the same request (9 s for 34 pages
  in a real test), the call has a 120 s timeout, and a job would only add a state
  table, polling and a second place to charge twice. The scan reading is a job
  because it takes minutes and can be retried safely; Split cannot.
- **The proposal is not stored.** `POST /split` returns it and `POST /split/create`
  receives the final groups. The server trusts nothing but page numbers, names and
  types: it re-checks access, edit rights, that `version_id` is still the current
  version (else 409 `document_version_conflict`), that every page exists in that
  version, that no page repeats, that each type is in the list that applies to the
  person, and cleans every name (no path, no control characters, no double `.pdf`).
- **Copying the PDF pages** is done with `pdf-lib` (MIT) in the isolated parser
  (`pdfCopyPages`, `lib/pdfSplit.ts`), under the same size, time and memory limits as the
  other operations. Text per page is `pdfPageTexts`. The new documents are stored
  with `storeDerivedDocument` (layer 4).
- **The reading is copied, not paid again.** For each new document the rows of
  `document_version_ocr` for its pages are copied to its version, renumbered
  from 1, with `credits = 0` and the same model, and the text is published once
  more (so the pages-without-text count is right). LandingAI is not called again.
  If the original has no reading, nothing is copied.
- **Where the list of types is stored.** One `jsonb` value, nullable:
  `user_profiles.split_classes` for a person and `organizations.split_classes` for
  a firm (migration `20261112_60_litt_split_expediente.sql`), the whole list replaced
  in one update, validated by the server on write and on read (a stale value falls
  back to the next). That is simpler than a table or a merge function: it is a small list
  that is always read and written as a whole, like the router-model lists, and
  the server is the only writer: client roles are revoked from `user_profiles`, and
  on `organizations` `authenticated` keeps only `SELECT`, limited by RLS to the
  firm's members (who may read the list anyway). **Resolution: the person's
  list, else the firm's, else the built-in one.** The firm's list is changed by
  whoever manages the firm's keys (owners and admins); any member reads it.
  API: `GET`/`PUT /user/split-classes` and `GET`/`PUT /orgs/:orgId/split-classes`
  with `{ classes: [...] }` or `{ classes: null }` (restore).

## The built-in list

Twelve Mexican case-file types (`DEFAULT_SPLIT_CLASSES`, `lib/ocr/splitClasses.ts`),
tried on a real 34-page file (16 of 17 groups right): carátula del instrumento,
instrumento notarial, acta protocolizada, constancia de situación fiscal (identifier
«RFC del contribuyente»), credencial para votar (INE) (identifier «Nombre del
titular»), pasaporte u otra identificación (same identifier), boleta del Registro
Público de Comercio, poder o documento de personalidad, comprobante de domicilio,
acta del Registro Civil, aviso o trámite notarial, and hoja en blanco o sello. It is
product data, not interface text: it is kept in Spanish and is not translated.
Editing it (up to 19 types, name, description and optional identifier; add, remove,
restore the included ones) is in Settings > Features for a person and in the
Organization page for a firm. The editor warns not to write client data in the
descriptions, because they are also sent to LandingAI.

## API

- `GET /single-documents/:id/split`: local state (`page_count`, `characters`,
  `estimated_credits`, `estimated_cost_usd`, `unread_pages`, `needs_scan_reading`,
  `too_large`, `key_available`, `can_edit`, `classes`, `classes_source`).
- `POST /single-documents/:id/split`: the proposal (`version_id`, `groups`
  `[{type, identifier, pages}]` with 1-indexed pages, `classes`, `credits`).
- `POST /single-documents/:id/split/create`: body `{ version_id, groups: [{pages,
  name, type}] }`, 201 with `{ documents: [...] }`.

## Not covered

- The type of a created document is not stored; it only names it.
- The real LandingAI Split API is never called by the test suite (`fetch` is a mock).
- The legal text: Terms 2, 6.10, 6.13 and Privacy Notice §3 to §7 and §13 are the
  final text of socium-legal (t_a4651c51); see [`followups.md`](followups.md).
