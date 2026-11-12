# Document conversion

A person can convert a document between Markdown, Word and PDF. The result is
always a **new document**: the original keeps its bytes, its versions and its
place. Nothing is created until the person has read what the conversion loses
and confirmed.

## What converts to what

| From | To | With | What is lost |
|---|---|---|---|
| Markdown | Word | `marked` (read) + `docx` (write) | Raw HTML and formulas are ignored. The result uses LiTT's style (Times New Roman 11), not a template. Links other than `http(s)` and `mailto` keep their text and lose the link. |
| Markdown | PDF | Markdown → Word, then LibreOffice | The same, and fonts and page breaks can change if a font is missing. |
| Word | Markdown | `mammoth` (HTML) + `turndown` with `turndown-plugin-gfm` | Comments, tracked changes (the final text stays), headers and footers, fine formatting, legal numbering such as 1.1.a (a plain list), pictures (`[imagen]`), merged cells. Footnotes end as a list. |
| Word | PDF | The version's stored PDF, else LibreOffice | Fonts and page breaks can change; tracked changes appear as LibreOffice shows them. |
| PDF | Markdown | The text layer (`pdfjs-dist`) | Tables, columns, titles, numbering, images and notes: the result is plain text under `## Página N` headings. A PDF with no text needs OCR and is refused (`convert_pdf_without_text`). |

PDF → Word does not exist: a PDF keeps no paragraphs, tables or styles, so the
Word file would mislead. Do PDF → Markdown, then Markdown → Word. Pandoc is not
used.

**One Word → Markdown converter.** `backend/src/lib/docxMarkdown.ts`
(`docxToMarkdown`) serves the person's conversion and the text extraction that
tabular review and the assistant read (`extractDocxMarkdown`). It runs inside
the isolated extraction process (`docxMarkdown` op), so its imports stay
parser-only: turndown needs only its DOM library (`@mixmark-io/domino`), which
does no I/O. Its output never carries raw HTML, and a `<` typed in a document is
escaped.

## The result

- A document in the **same project and folder** (or the same library folder),
  version 1, `document_versions.source = 'converted'`
  (`20261112_10_litt_converted_source.sql`).
- Named `<name> (de Word).md`, `(de Markdown).docx`, `(en PDF).pdf` or
  `(de PDF).md` in Spanish, `(from Word).md`, `(from Markdown).docx`,
  `(as PDF).pdf` or `(from PDF).md` in English, by the person's
  `user_profiles.ui_locale`. A name already taken in that folder gets
  `(2)`, `(3)`…
- There is no column that says what it came from; the name does.

## Who may convert

The rules of downloading, plus one:

- Someone who cannot see the document and its project gets **404**.
- A trainee's draft that is not approved for its current bytes gets **409**
  `training_approval_required` (as a download does; the document is not converted, it would leave
  the seal behind).
- Creating the new document needs `content.edit` where the original lives; a
  viewer sees the notice but gets **403** on conversion.
- Workflow documents and library templates cannot be converted
  (`convert_not_supported`).

## Routes

- `GET /single-documents/:id/convert/preview?target=md|docx|pdf` returns the
  fixed list of losses for the pair (`losses`, codes the client turns into
  sentences), the counts found in the `.docx` itself (`detected`: comments,
  tracked insertions and deletions, images, footnotes, headers, footers, counted
  with `jszip`), `blocked` (`pdf_without_text`) and the name the new document
  would get.
- `POST /single-documents/:id/convert` with `{ "target": "md" }` creates the
  document (201). Types are in `@mike/contracts`
  (`DocumentConversionPreview`, `DocumentConversionResult`).

Source size is capped (25 MB; 5 MB for Markdown, which is parsed in-process) and
Markdown → Word and LibreOffice are bounded by `uploadConversionTimeoutMs`.
Codes the client acts on: `convert_not_supported`, `convert_pdf_without_text`,
`convert_source_too_large`, `convert_unreadable`, `convert_unavailable`
(`CODE_KINDS`).

## The interface

The document menu (explorer rows and project tabs) shows one entry per valid
target: «Convertir a Word…», «Convertir a PDF…», «Convertir a Markdown…». It
opens a dialog that lists what this document loses, says «Tu documento original
no cambia» and offers «Convertir y crear documento nuevo» or «Cancelar». On
success the new document opens beside the original. Texts are in the
`documents.convert.*` and `errors.code.convert_*` catalog keys.
