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
  `LOCALE_COOKIE`, `negotiateLocale` and `loadMessages`. It is framework-free
  and imports nothing by bare name.
- `GLOSSARY.md` fixes how recurring terms are translated.

Applications import it by name, `@litt/i18n`, through the alias in
`frontend/tsconfig.json`; `frontend/Dockerfile` copies this directory into the
image at the path that alias resolves to.
