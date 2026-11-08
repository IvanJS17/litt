# @litt/i18n

LiTT's interface catalog, shared by the web app (`frontend/`) and the Word
add-in (`word-addin/`). It is a LiTT package (upstream MikeOSS has none), hence
the `@litt/` scope.

- `messages/en-US.json` is the source: English as upstream writes it.
- `messages/es-MX.json` has exactly the same keys and ICU arguments;
  `src/catalog.test.ts` (run by the frontend's Vitest) fails otherwise.
- Keys are semantic and stable (`settings.appearance.title`), grouped by area
  under one top-level namespace each (`common`, `auth`, `settings`, ...). A key
  used by both apps exists once.
- `src/index.ts` exports `LOCALES`, `DEFAULT_LOCALE` (`es-MX`),
  `LOCALE_COOKIE`, `negotiateLocale`, `parseAcceptLanguage` and
  `loadMessages`. It is framework-free and imports nothing by bare name.
  - `negotiateLocale(tags)` takes an **array** of bare tags already in order
    of preference (`[cookie, ...browserLanguages]`); it ignores `q` values
    and throws on a bare string. An `Accept-Language` header goes through
    `parseAcceptLanguage(header)` first, which sorts by `q` and drops `q=0`.
  - `loadMessages(locale)` returns that locale over `en-US`, so a missing
    translation shows the English text; an unsupported value loads `es-MX`.
- `src/catalog.test.ts` compares each `es-MX` message with its source: the
  same arguments and types (`isStructurallySame`), the same `select` options,
  `=N` cases, `offset` and number/date skeletons, and plural categories that
  exist in Spanish (`one`, `many`, `other`), keeping every one the source uses
  that Spanish also has. It also fails while a message in either catalog
  starts with `⟦por traducir⟧`, the mark `scripts/i18n/extract.mjs` gives a
  key it added and nobody has translated yet (see `docs/i18n.md`).
- `GLOSSARY.md` fixes how recurring terms are translated.

Applications import it by name, `@litt/i18n`, through the alias in
`frontend/tsconfig.json`; `frontend/Dockerfile` copies this directory into the
image at the path that alias resolves to.
