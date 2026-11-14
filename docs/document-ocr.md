# Scan reading (layer 6)

A scanned PDF has pages that are images and no text layer, so LiTT cannot read
them: the assistant, the text search and the Markdown conversion see nothing.
**Scan reading** reads those pages with LandingAI and gives the result to all
three. It is optional, off by default, and works only with a key that the person
or their firm saves themselves (bring your own key, like web search).

LandingAI is a third party the user chooses and pays. LiTT has no key of its own
for it: the environment is never read (`envApiKey("landingai")` is always
`null`), and there is no `LANDINGAI_API_KEY`. It is not an AI model, so it is
absent from the model catalog and from the chat's model picker.

## Behavior

- **No key (or key off):** nothing changes. A scanned PDF keeps today's warning
  (`textLayerWarning`, `textLayerNotice`, "no text layer").
- **Key saved and on:** on upload (`document_create`, new version, replaced
  version), if `extractPdfTextForIndex` finds pages without text and the PDF has
  **50 pages or fewer**, LiTT reads it in the background. The upload is not
  blocked.
- **More than 50 pages, or already uploaded:** nothing is sent by itself. The
  document panel shows **Read scan**, which first shows the estimated cost. This
  is always an explicit action.
- **Turning the key off or removing it:** new documents are not read; the text
  already read stays.
- **After a reading:** `read_document` and the chat context, the text search and
  PDF to Markdown (layer 4) use the text, and the warning disappears.

Pages that already have a text layer keep their own text; the reading fills only
the pages without one. A page LandingAI failed on stays unread, and **Read
scan** is offered again.

## Who can use the key

Resolved exactly like the web-search keys (`lib/providerCredentials`): inside a
firm, the firm's key first, then the member's own only if
`organizations.allow_personal_scan_keys` allows it (one switch per kind of key: AI, web search, scan reading); outside a firm, the person's.
Saving, replacing and removing a firm key is done by whoever already manages the
firm's keys (owners and admins, Organization > Keys; unchanged). The switch is the
saved key's own `enabled` flag (same pattern as the other keys).

`resolveScanKey` (`lib/ocr/key.ts`) is the only reader. The key never enters a
job payload, a log or an error message.

## Where the text is stored

Table `document_version_ocr` (migration `20261112_40_litt_document_ocr.sql`),
one row per version:

| Column | Meaning |
|---|---|
| `version_id` (pk) | The exact version. A new version has no row, so it needs its own reading. |
| `source_revision` | The `text_revision` of the bytes that were read. A reading of other bytes is ignored. |
| `status` | `processing`, `ready` or `failed`; `pages` is always set when `ready`, and is kept while a new reading runs or fails. |
| `pages` | `[{page, text}]`: the text LandingAI read, by **real PDF page number** (from `structure` page nodes: `grounding.page` and `grounding.range` over the Markdown; the `<!-- PAGE BREAK -->` marker if `structure` is absent; a reading that cannot be placed on real pages is rejected, never guessed). No `structure` and no boxes are kept. |
| `page_count`, `failed_pages` | LandingAI's page count and the pages it failed on. |
| `provider`, `model`, `credits` | Provenance: `landingai`, the model snapshot, credits charged. |
| `requested_by` | Who asked (provenance only; it is **not** AI evidence). |

RLS is on and every client role is revoked, like `document_version_texts`: only
the server reads it.

**Decision: merge into the existing index instead of adding a fourth reader.**
`document_version_texts` already feeds the assistant (`loadVersionTextState`),
the search (`find_document_text`) and tabular review. The extractor
(`extractAndPublishText`) merges a `ready` reading of the exact revision into
the PDF's own pages (`fillPagesFromOcr`): pdf.js text stays on pages that have it, LandingAI text goes only on the scanned pages, each under its own `[Page N]` marker, so the assistant cites "page N" as with a text PDF, and the warning clears only for the pages read and publishes the combined text with the
remaining textless count. Any re-extraction (revision change, extractor bump,
backfill) repeats the merge, so the reading survives it. The conversion to
Markdown (`extractPdfMarkdown`) merges the same way. After publishing, the job
sets `document_versions.textless_page_count` to the pages still unread, which is
what clears the warning in the list, the panel, conversion and comparison.

## The reading

`document.ocr` job (`documents.ocr.ts`, registered in `jobs/registry.ts`;
`OCR_MAX_ATTEMPTS = 2`, because a retry after a timeout can charge twice).

1. Re-checks, as the request did: the authorization epoch of the firm
   (`assertAuthorizationStamp`), edit permission of the requester, and that the
   version is not held for training.
2. Resolves the key, downloads the PDF, finds its pages without a text layer
   (`pdfTextlessPages` op, in the parser process), calls LandingAI for **only
   those pages** (the file is still uploaded whole; `options.pages`, 1-indexed; a PDF scanned throughout goes
   whole, without the option) and saves the reading.
3. Re-extracts the text with the reading merged and publishes it.

Reading again keeps the previous reading in force (text, search and conversion
keep using it) until the new one is saved; a new one that fails leaves the previous
one in place with the row `failed`. For that, `pages` may be set while `status` is
`processing` or `failed` (migration `20261112_50_litt_ocr_keep_reading.sql`; the new
code needs it applied before it can read again). If the job cannot be queued, the
row is marked `failed` (`ocr_unavailable`) instead of staying `processing`. After
publishing the text, the job (and the upload's extraction) reads the reading again
and publishes once more if it changed, so the last write includes it.

A retry after step 2 only does step 3: it never pays twice. 401, 402, 403,
too-large and not-supported end the job as `failed` without retrying.

### LandingAI client (`lib/ocr/landingai.ts`)

REST v2 Parse Jobs with `fetch`; no new dependency (the official JS SDK was not
needed for three calls). Host `https://api.ade.landing.ai` (Gen2 / DPT-3; `api.va.landing.ai` is Gen1 and is not used), the United States
region the legal text names; the EU region (`api.ade.eu-west-1.landing.ai`) and
EU keys are **not** supported. `POST /v2/parse/jobs` (multipart: `document`,
`model=dpt-3-pro-latest`, `service_tier=standard`, `options`), then
`GET /v2/parse/jobs/{id}` until `completed` or `failed`. The key goes only in
the `Authorization` header; redirects are refused; the job id is validated before
it enters a path; total timeout 10 minutes; the PDF is capped at 50 MiB.

| Code | When |
|---|---|
| `ocr_key_invalid` | 401/403, or the job failed with `invalid_api_key` |
| `ocr_no_credits` | 402 |
| `ocr_unavailable` | 429, 5xx, timeout, network, malformed answer (retryable) |
| `ocr_too_large` | over the cap or LandingAI's limits |
| `ocr_not_supported` | 422 (encrypted, corrupt, unreadable) |
| `ocr_key_missing` | 409 on `POST`, no usable key |

All are in `CODE_KINDS` and `errors.code` (en-US and es-MX).

## API

- `GET /single-documents/:id/ocr` : state of the current version
  (`applicable`, `status`, `error_code`, `key_available`, `can_edit`,
  `needs_reading`, `page_count`, `textless_page_count`, `auto_max_pages`,
  `estimated_cost_usd`, `credits`). Same access as opening the document.
- `POST /single-documents/:id/ocr` : starts a reading (202). Needs edit rights,
  as for converting and comparing. 409 `training_approval_required` for a version
  held for training; 409 `ocr_key_missing`; 400 `ocr_not_supported` /
  `ocr_too_large`.

## Cost, limits and privacy

- About **US$0.01 per page** (measured: 5.5 credits for 7 pages and 36.9 credits for 34 pages, about
  1.1 credits per page, at the standard tier; 1 credit = US$0.01). Only the pages without a text layer are sent and billed
  (`options.pages`, documented at https://docs.landing.ai/dpt3/parse-input.md), so
  the estimate is `textless_page_count * 0.01`, shown before a manual reading.
- Up to 50 pages is read on upload; more needs the button. 50 MiB per PDF.
- The whole PDF file still goes to LandingAI in the United States (`options.pages` selects what is parsed and billed, not what is uploaded). Without LandingAI's zero
  data retention (Team and Enterprise plans only) it may keep documents and use
  them to improve and train its models. The user's account pays LandingAI
  directly. The wording shown in Settings, the Terms (clauses 2, 6.10-6.12) and
  the Privacy Notice (sections 3-7, 11, 13) is the final legal text; see
  `frontend/src/content/legal/` and `LEGAL_VERSION`.
- The user's alternative without LandingAI: upload the PDF already run through
  OCR (the scanner's searchable-PDF function or a PDF program).
- Only synthetic documents in tests, and `fetch` is mocked: the real API is never
  called from the suite.

## Not done

- No EU region, no spreadsheet or image inputs, no per-page progress.
- `read_document`'s fallback (index not ready) still extracts from the bytes
  without the reading.
