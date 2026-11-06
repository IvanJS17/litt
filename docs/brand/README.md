# LiTT brand, v1.0

The rules for the LiTT wordmark and monogram live in [`DESIGN.md`](DESIGN.md),
the brand package's own specification. It is copied here unchanged and wins
over any summary, including the one in
[`docs/design-system.md`](../design-system.md#marca-litt-v10).

| Path | What it is |
| --- | --- |
| [`DESIGN.md`](DESIGN.md) | Concept, modular construction in u and X, colors, versions, minimum sizes and the 13 prohibitions. |
| [`CHANGELOG.md`](CHANGELOG.md) | Decisions behind v1.0. |
| [`svg/`](svg/) | Outlined masters with the 4u protection area: wordmark in color (light and dark) and one-color (light and dark), and the serif «L.» monogram. |
| [`qc/qc-sheet.png`](qc/qc-sheet.png) | The package's QC sheet for small sizes and backgrounds. |
| [`licencias/`](licencias/) | SIL OFL 1.1 for Newsreader and Departure Mono, the faces the marks are outlined from. |

Where the marks are used in the code:

- `frontend/src/shared/ui/LittBrandUI.tsx` draws the wordmark (paths copied
  from `svg/litt-wordmark-color-*.svg`) and the pixel «L.» monogram at 16, 32
  and 48 px. The Word add-in imports it as `@mike/litt-brand-ui`.
- `frontend/src/app/favicon.ico` (16, 32 and 48 px) and `icon.svg` are the
  pixel monogram; `frontend/public/apple-touch-icon.png` (180 px) and
  `word-addin/assets/icon-80.png` are the serif monogram rendered from
  `svg/litt-monograma-oscuro.svg`; `word-addin/assets/icon-16.png` and
  `icon-32.png` are the pixel favicons.
- `frontend/public/link-image.jpg` is the dark color wordmark at X = 176 px on
  tinta.

The package's build scripts are not part of the repository. Raster files above
were produced from the SVG masters and checked against the package: the 16 and
32 px favicons are pixel-identical to its `favicon-16.png` and
`favicon-32.png`, and every pixel-monogram file has exactly three colors.
