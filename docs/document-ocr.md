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
`organizations.allow_personal_api_keys` allows it; outside a firm, the person's.
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
| `status` | `processing`, `ready` or `failed`; `markdown` is set exactly when `ready`. |
| `markdown`, `page_count`, `failed_pages` | LandingAI's result. |
| `provider`, `model`, `credits` | Provenance: `landingai`, the model snapshot, credits charged. |
| `requested_by` | Who asked (provenance only; it is **not** AI evidence). |

RLS is on and every client role is revoked, like `document_version_texts`: only
the server reads it.

**Decision: merge into the existing index instead of adding a fourth reader.**
`document_version_texts` already feeds the assistant (`loadVersionTextState`),
the search (`find_document_text`) and tabular review. The extractor
(`extractAndPublishText`) merges a `ready` reading of the exact revision into
the PDF's own pages (`fillPagesFromOcr`) and publishes the combined text with the
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
2. Resolves the key, downloads the PDF, calls LandingAI, saves the reading.
3. Re-extracts the text with the reading merged and publishes it.

A retry after step 2 only does step 3: it never pays twice. 401, 402, 403,
too-large and not-supported end the job as `failed` without retrying.

### LandingAI client (`lib/ocr/landingai.ts`)

REST v2 Parse Jobs with `fetch`; no new dependency (the official JS SDK was not
needed for three calls). Host `https://api.ade.landing.ai`, the United States
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

- About **US$0.01 per page** (measured: 5.5 credits for 7 pages at the standard
  tier; 1 credit = US$0.01). The whole PDF is sent, so the estimate is
  `page_count * 0.01`, shown before a manual reading.
- Up to 50 pages is read on upload; more needs the button. 50 MiB per PDF.
- The whole PDF goes to LandingAI in the United States. Without LandingAI's zero
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

- The whole PDF is sent and billed, not just the textless pages (`options.pages`
  could cut the cost).
- No EU region, no spreadsheet or image inputs, no per-page progress.
- `read_document`'s fallback (index not ready) still extracts from the bytes
  without the reading.
