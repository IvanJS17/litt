# Open follow-ups

Technical follow-ups that are not yet done, grouped by area. Each item names the
pull request where it was found. Items marked **(unverified)** were not confirmed
against the current code and need checking before they are scheduled.

Checked against `main` at `cf84ddd1`, 2026-11-08; the section «Markdown, version compare and web search (#150–#155)» against `3752c539`, 2026-11-11. Items closed by later pull
requests (including #132–#134 and the legal-reference rewrite in #134, which
removed the `lawReferences`/`lawNamedAt` logic) are not listed.

## Training: supervision and criterion (server)

- `listOwnReviews` runs one `workPlace` lookup per work, and `loadReviews` has no
  row limit. Batch the lookups and bound the query. (#107, #120)
- `listOwnReviews` checks access per row for the mentor view; batch it in one set
  read, as `grantableProjects` now does. (#101/#104)
- `training_can_approve` is computed for every version, so the cost grows with the
  number of versions. (#120) **(unverified)**
- Read-only mentors receive 403 instead of 404 on a playbook they can view but not
  edit, through the shared `editablePlaybook` contract. Decide the contract and
  align the routes. (#119)
- `locateQuote` accepts a quote cut in the middle of a word or number and reports it
  as verified. This affects every citation check, not only training. (#118)
  **(unverified)**
- A reading whose document or version disappears after the findings are submitted
  stays `sent`, and the open reading index blocks starting a new one. (#118)
  **(unverified)**
- A re-claim that loses the race returns 500 instead of the compared row. (#118)
  **(unverified)**
- Methodology review: `verifyBasis` compares article numbers only, so the same
  number in two laws matches. Add the cross-law test and compare by law and number
  (`lawReferences` no longer exists; use `legalReferences`). (#117)
- Methodology annex: «dato dado por la persona» is not
  checked against the message; the verified excerpt has no spotlight; the disclaimer
  text contradicts «Sin fuente». Also: the `isSubagent` guard has no test, and
  `allowDocumentMutation` is optional and fails open. (#117) **(unverified)**
- Word and tabular views do not render `doc_created`. (#117) **(unverified)**
- Subagent route ownership: the returned `project_id` is not re-checked against the
  person's current access. A lost access leaves a dead link; nothing leaks to
  third parties. (#128) **(unverified)**
- Subagent route N+1: up to 100 sequential `workPlace` queries. (#128)
  **(unverified)**
- The note «one route only» also appears when two routes are configured and only one
  works. (#128) **(unverified)**
- Missing tests: the HTTP case where every route is unusable; the third subagent with
  one route. (#128) **(unverified)**
- `orgIds` passed to `in()` is not split into batches, and the ownerless RPC makes a
  single unbounded read. (#107) **(unverified)**
- Name recall: names longer than ten words, names cut at a comma, and lowercase names
  are dropped or shortened to a shorter identity; the search fails closed. (#115)
  **(unverified)**
- Recall test: `trainingEgress` has no route-level test that its four exits use
  `recordChatEgressOrThrow`. (#115) **(unverified)**
- Deployment risk: a Word add-in pinned to an old image keeps getting 400 on the new
  confidence field until it reloads. The add-in is served from the VPS, so a reload
  picks up the new bundle. (#113)

## Training: verdicts, notes and contrast

- The contrast trailer is lost when a fence or a rule follows it, and the verdict
  becomes null. (#113) **(unverified)**
- A contrast that settles while in flight can overwrite a mentor's correction on a
  `pending` note. (#113) **(unverified)**
- `answer_unverified` is always false in tabular, because its annotations do not
  carry `verified`. (#113) **(unverified)**
- Missing tests: the HTTP path for a mentor correction, and the 400 on confidence
  must check that nothing was inserted. (#113) **(unverified)**
- An aborted mode turn leaves its note `pending` forever, and the UI shows it as a
  failed contrast. It should read as «hint not delivered» or be cleaned up. (#123)
  **(unverified)**
- Aborting turns on purpose until the 24-note window fills can restart the hint
  ladder. (#123) **(unverified)**
- A pending hint or counterpart note is not re-read after the turn ends, so a
  delivered hint shows as «not delivered» until reload. Keep polling for a few
  seconds while a note is `pending` after its turn ends. (#127)
- A round closed by an abort stays on «Generating contrast…». (#127)
  **(unverified)**
- The margin of 10 s uses `max(created_at, turnEndedAt)`, so an older pending note is
  hidden 10 s after any turn ends. (#132) **(unverified)**
- Reloading after the server deadline shows a pending mode or closing note as
  «failed contrast» instead of «not delivered». Only reloads are affected. (#132)
  **(unverified)**
- Test «keeps a mark already given through a hint» does not send a hint. (#127)
  **(unverified)**
- `docs/training.md` says two turns with the same approach differ only in the
  contrast; that is no longer always true. (#127) **(unverified)**
- The supervision loader for notes is duplicated to avoid an import cycle; move it
  to `lib/`. (#131)
- Missing test: a review done outside a matter. (#131) **(unverified)**

## Training: criterion map (web)

- The map shows «sin retomas» when `retakes_without_access` is above zero. (#125)
  **(unverified)**
- `docs/training.md` lacks the fifth section (criteria contrast) of the map. (#125)
  **(unverified)**
- After `source_gone`, the failed label says «no se pudo generar la pregunta» even
  when the retake has its question. (#125) **(unverified)**
- The skeleton has three blocks; the loaded screen has four sections. (#125)
  **(unverified)**

## Training: supervision screens and layout (web)

- The «Aprobada» marker in the Works tab keys on the version id, so it survives reload
  and regeneration. If the bytes change in place, the row still says «Aprobada» and
  hides the button until the component remounts. (#104)
- The skeleton of the supervision list has no switches, so rows move on narrow screens
  when the list arrives. Measure CLS at 390 px. (#104) **(unverified)**
- Missing test: the org-equality condition for a project from another organization
  that the mentor can open. (#104)

## Playbooks

- A playbook copy keeps `sourceIds` (origin and legal references) that point to
  documents the copy does not carry. (#98) **(unverified)**
- A copy of a playbook whose source is absent should set `verified: true` back to
  `unverified` and move the origin to `ai_general` with a «Sugerencia sin respaldo,
  revisar» note, since the source is not in the copy. (#98) **(unverified)**
- The copy should drop the `quote` of attachment clauses whose attachment it does not
  carry. (#98)
- If the questionnaire load fails, it should retry inline instead of using
  `describeError`/`notifyError`. (#98) **(unverified)**
- The counts in the «Mark as ready» confirmation are computed on the client and can
  differ from the audit when another editor saves first. (#98)
- In en-US, the 4xx `detail` of the training endpoints (`lib/training.ts`,
  `lib/trainingTurn/confidence.ts`) is written in Spanish and shown as is.
  Other 4xx details are English. (#98)

## Chat and composer (web)

- The side chat closes on its own when the Explorer expands, and the unsent draft in
  `ChatInput` is lost. Keep the draft in the parent or per chat, or do not close the
  side chat while it has text. (#106)
- The comment near the side-chat wiring in the project chat page is outdated (it says
  the side chat stays open off screen). (#106) **(unverified)**
- `ModelToggleUI`: the empty state uses `w-auto`, which is not pinned for non-compact
  hosts that pass square icon widths. (#106) **(unverified)**
- The model label in the composer is cut to «N.» at 390 px. Also affects #101.
  (#105, #101)
- Explorer rows are `<li onClick>`, so they cannot take focus from the keyboard; a
  click leaves focus on `body`. Predates the PR. (#105) **(unverified)**
- Layout: the side chat needs about 1418 px of window width when the sidebar is open,
  and the availability check ignores whether the Explorer is collapsed. (#105)
  **(unverified)**
- A side chat that stops fitting stays open but hidden and cannot be closed until
  there is room again. (#105) **(unverified)**
- When the space value is `null`, the fallback is the layout from before the fix.
  (#105) **(unverified)**
- Login page: at 1280×640 the layout fits with no margin when providers are active.
  Recover about 8 px of vertical spacing in `AuthPageShell`. (#103) **(unverified)**
- Login page overflows between 1280×701 and 727 px (27 px at 701, 8 px at 720), with
  or without the fix. (#103) **(unverified)**
- The e2e spec comment describes a loading skeleton that does not exist, and one
  selector in the spec does nothing. (#103) **(unverified)**
- Orange badge in `ProjectPageParts` and raw orange in `EditCard` are outside the
  warning-token guard. (#104)

## Word add-in and interface languages

- `GET /user/profile` may be requested twice, once for the theme and once for the
  locale. Unify them. (#102) **(unverified)**
- Race: a profile GET already in flight can re-apply the old language after the user
  changes it. (#102) **(unverified)**
- The literal detector skips lone lowercase words in a ternary
  (`n === 1 ? "folder" : "folders"`) and the `supportNote` diagnostics (English
  on purpose: they go to support). Only a hand review finds the first kind.

## i18n structure and tests

- `frontend/src/__tests__/i18n-literal-baseline.json` is one nested JSON file, so
  parallel i18n pull requests conflict on it (#98, #101, #103). Split it into one
  file per entry, or one sorted line per entry with `merge=union` in
  `.gitattributes`.
- The message catalogs are single files per locale. Split them by namespace, one file
  per area, so parallel cards do not touch the same file.
- Flaky (existing): `TabularReviewView.generation.test.tsx` «hides unsafe server error
  details» fails on «Stop generation» in some runs. (#107 CI, #131) **(unverified)**
- Flaky (existing): `settings/byok/page.test.tsx` reported an unhandled
  `ReferenceError: window is not defined` after jsdom teardown. Vitest counts it as a
  failure even when all tests pass. (#132 CI) **(unverified)**
- The ReDoS guard test in `legalReferences.redos.test.ts` uses an absolute 200 ms
  limit that can fail on a loaded runner. (#124)
- Test-only: the `skipped` value in `contrast_status` is documented; check the
  documentation list matches the enum. (#113) **(unverified)**

## Markdown, version compare and web search (#150–#155)

- The version diff has no button to expand the context around a change. (#155)
- UTF-8 validation of an uploaded or saved `.md` reads the whole file. (#155)
- The playbook diff changed from LCS to Myers (jsdiff) when the text diff was
  unified; check that playbook changes still read the same. (#155)
- `saveMarkdownEdit` does not set `archived_at`, as the upload path does not
  either. (#155)
- `read_webpage` shares its URL with the search service. (#150–#155)
- Search may use a firm's key or the platform's, depending on how it is
  configured. (#150–#155)
- There is no test of the search wiring in the project chat. (#150–#155)
- There is no test that `chatId` reaches the four auxiliary calls. (#150–#155)
- The «overloaded» message, like the other provider failure sentences in
  `backend/src/lib/llm/providerErrors.ts`, is written in English by the backend,
  so a person using es-MX reads it in English. The BYOK modal is translated. (#152)
- The SDK warns that it does not know `claude-fable-5-2`. (#154)
- Search: Brave answers 429 when several searches run in parallel. (#150–#155)

## Structural (merge conflicts across parallel cards)

Each merge to `main` conflicted every open training pull request in the same files:

- the `schema_migrations` list and the body of `schema.sql`: store the ledger as one
  insert per line, or generate it;
- `app.ts`: an index of routers that can be extended without editing `app.ts`;
- `buildJsonExport.ts`: a column added to an exported table is not exported, and
  nothing reports it; add a guard;
- the message catalogs and the literal baseline (see above);
- the supervision fixture;
- `docs/training.md`.

Also: the plural guard covers only «times», «veces» and «marked turns» (#133).

## Review feedback still to decide

- PR #114 (bulk review designer) left four documentation, UI and test reservations
  (W1–W4). They were recorded in the review thread, not in this file; re-raise them
  there or open a card. (#114)

## Scan reading (layer 6)

- The wording in `settings.scanReading.*`, the Terms and the Privacy Notice is
  the **final** legal text (socium-legal, task t_c639f00f), not a draft. Its own
  open points: whether a firm key shared by several members meets LandingAI's
  terms (2(c)(vi), 2(d)), and confirming that production holds no platform keys
  for AI or search (the Privacy Notice says LiTT has none).
- EU region (`api.ade.eu-west-1.landing.ai`) is not supported; the legal text
  says "Estados Unidos".
- `read_document`'s fallback path (text index not ready) extracts from the bytes
  and does not include the reading.
- A reading of other bytes of the same version (replace file) is ignored, not
  deleted; it is replaced by the next reading or removed with the version.
- The real LandingAI API was run once, with a **synthetic page** generated by the
  test script (not a real document). A real scanned document, the migrations
  against a database (`backend/src/__tests__/sql`) and the browser flow were not
  run here.
- The automatic reading on upload still uses the whole page count against the
  50-page limit, though only the scanned pages are billed now.

## Split a case file (layer 7)

- The wording in `documents.split.*`, Terms 6.13 and the Privacy Notice (§6, §13) is
  the **final** legal text (socium-legal, task t_a4651c51), not a draft. Its own
  open points: confirming that LandingAI's zero data retention covers Split (its
  page names only Parse and Extract), and updating the working versions of the texts
  in `IvanJS17/legal-ai-mx`.
- Who may use Split with the firm's key: Terms 6.13.4 puts that use on the firm
  without naming roles, so Split follows the scan reading: whoever can edit the
  document and resolves a usable key (the firm's, then the member's own where the
  firm allows it). If the firm wants fewer people to spend its key, that is a new
  rule for both features.
- The firm audit records every send to LandingAI (`document.split_sent`: document,
  version, characters, credits; never the text or the key). It has no screen of its
  own yet.
- A page that has no text layer and no reading blocks Split (`split_needs_scan_reading`);
  an unreadable page that LandingAI failed on during the scan reading blocks it too.
  A "read the scan and then split" shortcut would save one click.
- The proposal is not stored: closing the dialog loses a paid proposal. Keeping it
  for a few minutes (a table with the proposal, deleted after use) was left out to
  keep the first version simple.
- The preview moves pages with selects, not drag and drop.
- The type of a created document is only used for its proposed name; no column keeps it.
- Not run: the real LandingAI Split API from this code, the migration against a
  database, a browser flow and a real case file.
