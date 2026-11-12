# Document comparison (redline)

A person can compare two Word documents of a project and get a **third, new
Word document** that shows the differences as tracked changes (insertions,
deletions and formatting changes). The two documents keep their bytes, their
versions and their place. Nothing is created until the person has chosen the
other file, read the notice and confirmed. It follows the pattern of
[document conversion](document-conversion.md).

## What is compared

- **Base (the original):** the document whose menu entry «Comparar con…» was
  used, its current version.
- **Against (the negotiated one):** another `.docx` of the **same project**,
  chosen in the dialog, its current version.
- Accept all changes in the result gives the negotiated text; reject all gives
  the original.

Only `.docx`. A `.doc`, a PDF or a Markdown file is `compare_not_supported`;
LiTT does not convert silently first.

## The result

- A document in the **folder of the base** (same project), version 1,
  `document_versions.source = 'compared'`
  (`20261112_20_litt_compared_source.sql`). Nothing in the app branches on
  `source` (no label, filter or evidence rule), so nothing else changed.
- Named `<base> vs <other> (cambios).docx` in Spanish or
  `<base> vs <other> (changes).docx` in English, by the person's
  `user_profiles.ui_locale`. A name already taken in that folder gets `(2)`,
  `(3)`…
- **Authorship of the marks:** the fixed name **«LiTT»** and the **current
  date and time**. The person's own name is not written into the file: the
  document may leave the account, and the marks are produced by the tool, not
  typed by the person. (The engine's default date is a fixed 2000-01-01; LiTT
  sets the real one.) The rest of the engine's configuration is left at its
  defaults.

## Who may compare

The rules of downloading, for **both** documents, plus edit rights:

- Someone who cannot see either document and its project gets **404**.
- A trainee's draft that is not approved for its current bytes (either
  document) gets **409** `training_approval_required`.
- Creating the result needs `content.edit` where the **base** lives; a viewer
  gets **403**.
- The two must be in the same project; otherwise `compare_not_supported`. This
  stops text from one project from landing in another. Documents outside a
  project (the personal library), workflow files, library templates, and
  comparing a document with itself are `compare_not_supported` too.

## Route

`POST /single-documents/:id/compare` with `{ "against_document_id": "…" }`
creates the document (201; the body is `DocumentCompareResult` in
`@mike/contracts`, the same shape as a conversion result). There is no preview
route: the notice is fixed and the dialog lists candidates from the project's
document list the page already has.

Codes the client acts on (`CODE_KINDS`): `compare_not_supported`,
`compare_source_too_large`, `compare_unreadable`, `compare_unavailable`.
Diagnostic label: `documents.compare`.

## Where it runs, and what it costs

The engine is **Docxodus 15.1.0** (npm `docxodus`, MIT; a .NET engine compiled
to WebAssembly). It runs only in the **isolated parser process** as the
`docxCompare` extraction op, loaded through `docxodus/core` (the bare package
needs a bundler). It reads its `.wasm` from `node_modules`; it opens no network
connection (checked in the prototype with `--network none`).

- **Bounds:** each source is capped at 25 MB (as a conversion); the two travel
  to the parser as one buffer (≤ 50 MB, under the parser's 150 MB input cap);
  the redline that comes back is capped at 64 MB (binary results have their
  own cap, `EXTRACTION_MAX_BINARY_BYTES`); the parser's time and memory limits
  apply as for any op, and it is retired after an error or a deadline.
- **Memory budget:** the parser's default (`EXTRACTION_MAX_MEMORY_MB`, 1024)
  is enough; it was **not** raised. Measured peaks of a comparison: 357-389 MB
  resident in the review's runs through the real parser process (prlimit as in
  production), 247-257 MB for a real 6,200-word contract in a container capped
  at 300 MB. The parser's address-space bound is the budget plus 1 GB; a
  comparison reaches about 1.8 GB of address space (WebAssembly reservations),
  so budgets well below the default fail (`compare_source_too_large`). The
  parser runs inside the backend container, whose limit is 1024 MB in
  production (`deploy/prod/compose.yaml`) to leave room next to the API
  (~330 MB).
- **Time:** first comparison in a fresh parser, about 3 s on a loaded machine
  (process start + WASM load); the next ones in the same warm parser, 0.6–0.9 s.
  The parser stays warm for 60 s idle.
- `MONO_WASM: Jiterpreter … not yet initialized` lines appear on stderr of the
  parser; they are harmless and the parser's stderr is only kept for
  out-of-memory detection.

## Known limitations

- **Moved clauses are noisy.** When a clause moves, Docxodus can mark it as
  moved (`w:moveFrom`/`w:moveTo`) and also mark neighbouring clauses as moved
  when one is inserted; the reader sees blocks deleted and written again. It is
  correct on accept/reject, but harder to read. Measured on the prototype pairs:
  4 changes marked as a whole paragraph instead of by word. Turning move
  detection off is worse (genuinely moved clauses become whole deleted and
  re-inserted blocks), and raising the move similarity threshold to 0.95 does
  not remove the noise, so the engine's defaults stay. The dialog says so before
  creating.
- **Comments anchored on text that changes can be duplicated.** On a real
  contract of about 6,200 words with 36 comments, 2 came out duplicated in the
  redline; they were comments anchored on text that changed. LiTT does not
  post-process them. A synthetic case (one comment on text that changes) does
  not reproduce it: `docxCompare.test.ts` pins 1 comment in, 1 out, and would
  show a duplicate.
- **Not checked in Microsoft Word.** The result opens with python-docx and
  LibreOffice. In the first synthetic pair, all 8 `w:moveFrom` blocks (and one
  `w:del`) carry their text as `w:t`, where Word's own files use `w:delText`;
  accept/reject give the right text in both readers, but opening it in Word is
  still to be confirmed.
- **Documents that already carry tracked changes** are compared as the engine
  decides (it documents comparing them accepted); this was not verified here.
- Only one-page synthetic contracts and one real 6,200-word contract (owner's
  measurement) have been run; very long documents may take longer and use more
  memory (WebAssembly has a 32-bit address space).
- Pictures, footnotes and fields are whatever the engine keeps; the tests pin
  tables, a footer and comments.

## The interface

«Comparar con…» is in the document menu next to «Convertir a…»: explorer rows
and project tabs (`ProjectExplorer`, `ProjectDocumentTabs`) and the project
`DocTable` row menu. It appears only for `.docx` that is not a held trainee
draft, and where the person can edit content. The entry has the id `compare`;
the code never decides by its label. It opens a dialog with the project's other
`.docx` files (never the document itself, no other type), the notice «Se crea
un documento de Word nuevo con las diferencias como control de cambios… Tus
documentos originales no cambian» and the buttons «Comparar y crear documento»
and «Cancelar». On success the lists refresh and the assistant chat opens the
new document in a tab. Texts are in the `documents.compare.*` and
`errors.code.compare_*` catalog keys.
