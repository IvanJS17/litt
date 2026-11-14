# Design system

Mike uses Tailwind v4 with shadcn-derived `new-york` primitives for selected
controls, alongside its own liquid-glass component system. Lucide supplies the
icon set. This page documents what already exists so contributors can reuse it
instead of re-deriving it. It is a description of the current system, not a
proposal for a new one.

Everything below lives in `frontend/src/app/globals.css` unless stated otherwise.

## Where components live

| Location | What belongs there |
| --- | --- |
| `frontend/src/app/components/ui/` | Shared web primitives. Small, unopinionated, no data fetching, no feature knowledge. |
| `packages/ui/` (`@mike/ui`) | Primitives shared by the web app **and** the Word add-in. Framework-light: React, `lucide-react`, `clsx`, `tailwind-merge`, the Radix dropdown, and `@mike/client` only. |
| `frontend/src/app/components/shared/` | App-level building blocks that assume the app shell — the table layer (`TablePrimitive.tsx`, `TableToolbar.tsx`), page headers, sidebars. |
| `frontend/src/app/components/<feature>/` | Feature components. Compose the above; do not restate their markup. |

`packages/ui/` may not import from either application (`frontend/src/app/`,
`word-addin/src/`): it is compiled into the add-in build, which has no Next.js
app directory, as well as into the web app. Both targets consume it by name
through a `paths` alias (`frontend/tsconfig.json`, `word-addin/tsconfig.json`,
`word-addin/webpack.config.js`), and both register the whole package for
Tailwind class scanning with one `@source "../../../packages/ui/src"` entry, so
a new file needs no per-file registration. What it does need is an export from
`packages/ui/src/index.ts`, the package's public surface: a file that is not
re-exported there is internal.

Cross-target primitives use the `XxxUI.tsx` convention and are imported from
`@mike/ui` by both targets, for example `import { PillButtonUI } from
"@mike/ui"`. Do not add a web-only re-export whose only job is to rename
`XxxUI`: it adds another file, test, and catalog entry without adding behavior.
`GlassCardUI`, `PillButtonUI`, `GlassIconButtonUI`, `TabPillButtonUI`, and
`ToggleSwitchUI` are the canonical implementations used by both targets. To
style a link as a pill, apply `pillButtonUIClassName` (also from `@mike/ui`)
directly to the link; this keeps the correct link semantics and is safe in
server components.

The package's colocated tests run with the frontend's Vitest (`npm test
--prefix frontend` includes `packages/ui/src/**/*.test.tsx`), and its stories
in `packages/ui/stories/` are part of the Ladle catalog.

## Icons

Use the existing skeuomorphic feature, folder, file-type, and legal-source
icons where available; use Lucide for other controls. Web SVG assets render
through `components/ui/svg-asset-icon.tsx` with static imports from
`frontend/public/icons/`. Static imports produce content-hashed URLs that can
be cached immutably; avoid literal `/icons/...` URLs and manual version queries
for these assets. Small UI icons load eagerly so they appear with their labels.
The app layout preloads navigation and account-menu icons during the loading
screen, before opening a menu can trigger an image request.
`frontend/public/_headers` preserves immutable caching for `/_next/static/*`
on Cloudflare, whose asset server otherwise revalidates even hashed files.

## Marca LiTT v1.0

The norm is [`docs/brand/DESIGN.md`](brand/DESIGN.md), the brand package's
specification, copied unchanged. This section summarizes it for UI work and
says where it lives in code; when the two disagree, `DESIGN.md` wins. The
outlined masters are in [`docs/brand/svg/`](brand/svg/), the QC sheet in
[`docs/brand/qc/`](brand/qc/qc-sheet.png) and the OFL licenses of the two
source faces in [`docs/brand/licencias/`](brand/licencias/).

**The marks.** The wordmark is a Newsreader **L** followed by Departure Mono
**ıTT**; the dot of the i is a square amber cursor. The reduced mark is the
«L.» monogram: the L with that square, never the L alone. Both are drawn by
`packages/ui/src/LittBrandUI.tsx`, which the web app and the add-in both
import from `@mike/ui`:

| Component | Use | Sizes |
| --- | --- | --- |
| `LittWordmark` | Auth and onboarding pages (`SiteLogo`), the sidebar in personal work, the add-in login (`WordAddinLogo`). | `x` = 22, 33, 44, 55, 66 or 88: X is the Departure Mono size and must be a multiple of 11 below 66. The box includes the 4u protection area (u = X / 11). |
| `LittMonogramPixel` | Anywhere with less room than the 22px wordmark: the collapsed sidebar, an organization without its own logo, the chat greeting. | 16, 32 or 48 px only, drawn natively at each size. |

The serif «L.» monogram is only for 64 px and up (avatars, the 180 px
`apple-touch-icon.png`, the add-in's 80 px icon), and there is no component for
it: use the rendered files.

**Rules to keep in code** (the full list of 13 prohibitions is in
`DESIGN.md`):

- Never retype the wordmark in a font, and never set the monogram next to the
  name typed out as if it were a lockup. In running text the name is
  **LiTT**, in the text's own font, without imitating the mark.
- The amber is the square's alone. Letters take `--litt-mark-ink`, the square
  `--litt-mark-accent`; nothing else in a mark is amber.
- Each theme gets its own version: tinta letters and ámbar tinta square on the
  light theme, papel letters and ámbar fósforo square on the dark one. The
  marks are transparent and their colors switch with `.dark`, so place them
  only on papel or white surfaces in light and on tinta surfaces in dark.
- Do not deform, tilt, rotate, outline, shadow, tint or rescale the marks, and
  never animate the square: no cursor blink, no pulse. The wordmark links on
  the auth pages and in the sidebar have no hover effect; they show focus with
  the ring. The chat greeting's monogram stays still; only the greeting text
  beside it fades in. The one exception is the response-status indicator,
  `LittStatusMarkUI`, whose motion, green done rule, dimmed waiting amber and
  error outline the owner approved on 2026-11-13 (see
  [Status mark](#status-mark-approved-exception-2026-11-13) and DESIGN.md
  rules 9 and 10).
- Do not scale the pixel monogram between its sizes, and keep
  `shape-rendering="crispEdges"`. Favicons are used at their native sizes:
  `favicon.ico` holds 16, 32 and 48 px, and `icon.svg` switches to the native
  geometry of each size with width media queries.

**Color.** `DesignTokensUI.css` declares the palette once for both targets:

| Token | Hex | Where it may go |
| --- | --- | --- |
| `--litt-tinta` | `#151A26` | Dark-theme canvas; text on the light theme. |
| `--litt-papel` | `#ECECE6` | Light-theme canvas; text on the dark theme. |
| `--litt-ambar-fosforo` | `#FFB21E` | On tinta only (dark theme). |
| `--litt-ambar-tinta` | `#965900` | On papel or white only (light theme). |

`--litt-accent` resolves to the amber that belongs to the current theme. Its
only use outside the marks is the keyboard focus ring (`--focus-ring-color`,
`--ring`). Do not use amber for fills, text, buttons or status: it is a point
accent. Primary actions are tinta on the light theme and papel on the dark one.

Tailwind's gray scale is redefined from tinta and papel, so `text-gray-900` is
tinta and the neutral fills keep the paper's warmth. Measured WCAG contrast of
the pairs in use (minimum is 4.5:1 for text and 3:1 for the focus ring):

| Pair | Contrast |
| --- | --- |
| Tinta on papel / on white | 14.66:1 / 17.39:1 |
| `text-gray-500` `#5D6169` on papel / white / selected row `#E2E2DD` | 5.24:1 / 6.21:1 / 4.78:1 |
| Ámbar tinta on papel / white / selected row | 4.75:1 / 5.64:1 / 4.34:1 |
| Papel on tinta / on the lightest dark surface `#2A2F3A` | 14.66:1 / 11.31:1 |
| Dark `text-gray-500` `#9B9D9F` on tinta / `#2A2F3A` | 6.39:1 / 4.93:1 |
| Ámbar fósforo on tinta / `#2A2F3A` | 9.64:1 / 7.43:1 |
| White on the `black` pill tone over white | 13.58:1 |
| Ámbar fósforo on papel | 1.52:1, prohibited |

`text-gray-400` stays below 4.5:1 in both themes (2.71:1 on papel, 4.82:1 on
tinta but 3.72:1 on a selected dark row), as it did before: keep it for
placeholders, disabled text and decoration, not for information.

**Sin azul.** No blue, indigo, violet, purple, sky or cyan appears anywhere in
the UI: not in utilities, not in token values and not in LiTT's own SVG
illustrations (`public/icons/features`, `file-system`, `legal-sources`, which
were moved to the tinta-papel neutral of the same luminance). Do not
reintroduce those Tailwind families. This must return nothing:

```bash
grep -rnE '(blue|indigo|violet|purple|sky|cyan)-[0-9]{2,3}' frontend/src word-addin/src \
  --include=*.tsx --include=*.ts --include=*.css | grep -vE '\.test\.|stories'
```

The only exceptions are third-party marks drawn in their owners' colors (file
types, AI providers, Google), which stay as their owners publish them. The
`slate` family, a blue-grey, is replaced by the tinta-derived `gray` scale,
and so are Tailwind's stock cool greys: the shading inside LiTT's own SVG
icons sit on the tinta→papel neutral of the same luminance, with no
exception.
The `blue` tone of `PillButtonUI` and the `"blue"` modal variant keep their
names for API stability and render the interactive tokens.

**Semantic interactive tokens.** Primary actions, active toggles, selection,
action links and active-state indicators use these roles instead of a raw
palette. They are declared in `DesignTokensUI.css` as `--litt-interactive-*`,
switch with `.dark`, and are exposed to Tailwind through `@theme inline`:

| Role | Utility | Light | Dark | Use |
| --- | --- | --- | --- | --- |
| Accent | `bg-interactive`, `text-interactive`, `border-interactive`, `ring-interactive` | tinta `#151A26` | papel `#ECECE6` | Primary fill, active toggle track, selected chip, action link text, drag and drop indicators. |
| Accent hover | `hover:bg-interactive-hover`, `hover:text-interactive-hover` | `#2E333D` (tinta 86 % → papel) | `#CACBC8` (papel 86 % → tinta) | Hover on a primary fill or an action link. |
| Accent pressed | `active:bg-interactive-pressed` | `#454A53` (tinta 74 %) | `#ADAFAF` (papel 74 %) | Pressed primary fill. |
| Text on accent | `text-interactive-foreground` | papel | tinta | Text, icons and the toggle thumb on a solid accent fill. Never `text-white`, which disappears on the dark theme's papel fill. |
| Soft accent | `bg-interactive-soft` | tinta at 6 % | papel at 8 % | Selected table rows and cells, hover tints. |
| Soft accent, strong | `bg-interactive-soft-strong` | tinta at 11 % | papel at 14 % | Informational chips, role and type badges, selected citations, spreadsheet highlight. |
| Accent border | `border-interactive-border`, `ring-interactive-border` | tinta at 50 % | papel at 42 % | Selection rings and drop-zone outlines (3:1 non-text minimum). |
| Focus | `ring-focus`, `outline-focus`, `focus:border-focus` | ámbar tinta | ámbar fósforo | Keyboard focus only, as `--litt-accent`. |

Measured WCAG contrast of the new pairs:

| Pair | Contrast |
| --- | --- |
| Papel on accent / hover / pressed (light) | 14.66:1 / 10.69:1 / 7.51:1 |
| Tinta on accent / hover / pressed (dark) | 14.66:1 / 10.67:1 / 7.89:1 |
| `text-interactive` on soft-strong over white / papel (light) | 13.92:1 / 11.79:1 |
| `text-interactive` on soft-strong over tinta / `#1B202C` (dark) | 10.04:1 / 9.20:1 |
| Accent border over white / tinta | 3.36:1 / 3.60:1 |
| Focus ring on soft-strong, light / dark | 4.51:1 / 6.60:1 |

Document and spreadsheet highlights (`ThemeTokensUI.css`) are tinta tints:
PDF and DOCX pages stay white on the dark theme, so their marks are tinta in
both themes. Status colors (red for errors and destructive actions, green
for success, orange for warnings) are functional, not brand. Warnings used
Tailwind `amber`, whose 700-800 steps sit next to ámbar tinta, so they moved
to `orange` (`text-orange-700` on `bg-orange-50` is 4.88:1) and Tailwind
`amber` is no longer used anywhere: the brand ambers belong to the square
and the focus ring. A warning surface reads the shared warning tokens
(`text-warning`, `bg-warning-surface`, `border-warning-border`,
`bg-warning-fill` with `text-warning-fill-foreground`, and
`hover:bg-warning-fill-hover`) instead of raw `orange-*` classes, so the web
app and the Word add-in show the same orange: orange-700 on orange-50 in the
light theme, and a soft orange-300 on a tinta-tinted surface in the dark one.
`frontend/src/__tests__/warningPalette.test.ts` checks AA contrast in both
themes and rejects raw `orange-*` or `amber-*` classes in the notice
surfaces it lists: the add-in banner, `NoticeCardUI`, the warning popups, the
memory conflict notice, playbook warnings and the document panel's text-layer
warning. Categorical palettes (tags, currencies, avatars, column formats,
subagent marks) keep their own hues and use non-blue, non-amber ones.

## Color tokens

Two families coexist. Prefer a token over a raw Tailwind palette class whenever
one exists; prefer either over a hex literal.

Both families, and their `@theme inline` utility mappings, are declared once in
`packages/ui/styles/DesignTokensUI.css`. The web app's `globals.css` and the
Word add-in's `word-addin/src/taskpane/styles.css` both import that file, so a
token change reaches both targets. Do not redeclare one of these tokens in either
entry stylesheet; `DesignTokensUI.test.ts` fails if you do.

### App surfaces (Mike's own)

These back the "liquid glass" chrome and are the ones most feature code needs.

| Token | Utility | Light value | Intent |
| --- | --- | --- | --- |
| `--app-background` | `bg-app-background` | papel `#ecece6` | Page canvas behind panels, including the auth and onboarding pages. |
| `--app-surface` | `bg-app-surface` | `#f9f9f7` | Resting surface of a panel, table header, menu. |
| `--app-surface-hover` | `hover:bg-app-surface-hover` | papel `#ecece6` | Row/item hover. |
| `--app-surface-active` | `bg-app-surface-active` | `#e2e2dd` | Selected or pressed row/item. |
| `--app-floating` | `bg-app-floating` | `#fcfcfb` | Detached floating elements above a surface. |

Dark values are tinta `#151a26` for the canvas and tinta lifted toward papel
for the rest (`#1b202c`, `#222732`, `#2a2f3a`, `#1f2430`). Tailwind's gray
scale is redefined from the same two colors; see
[Marca LiTT v1.0](#marca-litt-v10).

Use the class-name constants in `components/ui/liquid-surface.ts` rather than
retyping the utilities. Liquid-glass controls use
`LIQUID_GLASS_HOVER_CLASS`/`LIQUID_GLASS_SELECTED_CLASS`; modal rows use the
modal-specific pair documented under elevation below.

### Component color roles

Theme-sensitive colors that do not describe elevation live in
`packages/ui/styles/ThemeTokensUI.css`. This includes document tabs,
workflow-editor prose and tables, document/citation highlights, dropdown hover
and selected states, chat fades and shimmers, and spreadsheet canvas overlays.
The file is imported by both the web app and Word add-in and provides light and
`.dark` values.

Dropdown primitives use `theme-dropdown-item` and
`theme-dropdown-selected`. They consume the same general liquid-glass hover
and selected color tokens as the liquid-glass state classes, so menu and
surface interactions remain visually consistent without copied palette
utilities. Text inputs and search fields inside `theme-dropdown-surface` use
a flat grey fill with no glass shadow or blur, retaining their keyboard focus
rings. The treatment applies to dropdowns and submenus in both web and add-in.

### shadcn semantic tokens

The standard shadcn set is present and wired through `@theme inline`:
`background`/`foreground`, `card`, `popover`, `primary`, `secondary`, `muted`,
`accent`, `destructive`, `border`, `input`, `ring`, the `sidebar-*` family, and
`chart-1`…`chart-5`. Values are `oklch()`; a `.dark` block overrides them.

Use these when you pull a component from the shadcn registry, or when you want
the meaning ("this is the destructive action") rather than a specific color.

The chart series are not brand colors either: `chart-1` is the interactive
neutral (tinta on light, papel on dark) and `chart-2`…`chart-5` take the
categorical hues below (teal or emerald, rose, lime, stone), so no shadcn
default indigo, purple or amber survives in them.

### Primary actions use the interactive tokens

There is no brand blue and no `--color-*` override of a Tailwind hue. A
primary action, selection or action link uses the semantic interactive
tokens listed under [Marca LiTT v1.0](#marca-litt-v10) (`bg-interactive`,
`text-interactive-foreground`, `bg-interactive-soft-strong`…), and keyboard
focus uses `ring-focus`.

### Categorical palettes

Categorical color tells items apart; it never carries brand or state. Every
categorical palette draws from these Tailwind families and steps only, with
no blue family and no amber:

| Family | Steps used | Where |
| --- | --- | --- |
| stone | 100–600 (`#f5f5f4` … `#57534e`) | chart series 5; status-mark hue (500 light, 400 dark) |
| teal | 100–600 (`#ccfbf1` … `#0d9488`) | chart series 2 (light); status-mark hue (700 light, 400 dark) |
| rose | 100–600 (`#ffe4e6` … `#e11d48`) | chart series 3 |
| lime | 100–600 (`#ecfccb` … `#65a30d`) | chart series 4; status-mark hue (700 light, 400 dark) |
| pink | 100–600 (`#fce7f3` … `#db2777`) | status-mark hue (600 light, 400 dark) |
| emerald | 100–600 (`#d1fae5` … `#059669`) | chart series 2 (dark) |

`LittStatusMarkUI` (the response-status indicator) takes a `hue` from
`LITT_STATUS_MARK_HUES`, in the order `teal, pink, lime, stone`. The four are
tokens, `--litt-status-hue-*`: teal-700 `#0f766e`, pink-600 `#db2777`, lime-700
`#4d7c0f` and stone-500 `#78716c` in the light theme, and the 400 steps
(`#2dd4bf`, `#f472b6`, `#a3e635`, `#a8a29e`) in the dark one. Each is at least
3:1 against white, papel, `#f9f9f7` and `#e2e2dd` (light) and against tinta
(dark). Rose and emerald are left out of it because they read as error and as
done. Tags, currencies, avatars and column formats keep their own lists in
their components, under the same rule: no blue, indigo, violet, purple, sky,
cyan or amber. The mark's own amber is never a hue.

#### Send button (approved exception, 2026-11-13)

`COMPOSER_SEND_BUTTON_CLASS` + `SendArrowUI` ("A · flecha ámbar sobre tinta")
is the one place amber is not the square: the 7×7 pixel arrow (u = 2 px) is
ámbar fósforo on tinta, in both themes, **only when there is something to
send**. Disabled is gray and Stop is a papel square; neither has amber. The
owner approved it as an exception to DESIGN.md rule 7. Colors are the
`--litt-send-*` tokens in `DesignTokensUI.css`; the arrow advances 2 px on
hover (160 ms) and nothing moves under `prefers-reduced-motion`.

#### Reasoning ladder (approved exception, 2026-11-13)

`ReasoningLadderUI` replaces the reasoning slider in `ModelToggleUI`: one step
per level the model offers, not counting "none" (`reasoningLevelsForModel`).
Beside the model's name, `ReasoningMiniUI` draws it in tinta (papel in dark),
steps of 4 to 10 px. Inside the menu the filled steps are amber, 6 to 12 px, an
exception to DESIGN.md rule 7 that covers only them: ámbar tinta at 70 to
100 % (light), ámbar fósforo at 55 to 100 % (dark), each mixed onto the menu
surface and opaque; empty steps are an outline. Tokens: `--litt-ladder-*` in
`DesignTokensUI.css`. It is a `slider` (arrows, Page Up/Down, Home, End). A
step fills once when the level changes, 160 ms up and 110 ms down, and there is
no motion for the keyboard, a drag, `prefers-reduced-motion`, a working LiTT or
the menu opening.

#### Status mark (approved exception, 2026-11-13)

`LittStatusMarkUI` ("A · Cursor") replaces the MikeOSS `MikeIcon` as the
response mark. It is a LiTT square, not the logo: `state` is `idle | working |
waiting | done | error`. The owner approved its motion as an exception to
DESIGN.md rule 10, and its error outline against rule 9; the wordmark and the
monogram stay still. Its colors, as tokens in `DesignTokensUI.css`:

- The square is `--litt-mark-accent` (ámbar tinta / ámbar fósforo), or a
  subagent hue.
- **Done** is the one green: `--litt-status-done`, emerald-700 `#047857`
  (4.22–5.48:1 on white, papel, `#f9f9f7`, `#e2e2dd`) in light and emerald-400
  `#34d399` (6.97–9.05:1) in dark. It colors only the rule under the square.
- **Waiting** is the same amber at 0.55 opacity, with three dots at the same
  opacity, as the owner asked for a dimmer amber. Measured, that is 2.11–2.35:1
  on the light surfaces and 3.29–3.77:1 on the dark ones, so on light the dots
  and the motion carry the state, not the color alone.
- The rule and the error outline are `--litt-status-line` (gray-500 `#5d6169`,
  `#9b9d9f` in dark).
- With `prefers-reduced-motion: reduce` nothing animates: a static rule while
  working, three fixed dots while waiting, the full rule when done.

### Theme: Claro, Oscuro, Automático

`@custom-variant dark (&:is(.dark *))` — class-based. The shadcn tokens,
`--app-*` surface tokens, and shared liquid-glass material tokens all have
`.dark` values, so semantic surface and material classes switch without
component-level `dark:` shadow recipes.

The theme is one preference with three values, `light`, `dark` and `system`
(`user_profiles.theme`; new accounts start on `system`). **Automático**
(`system`) follows `prefers-color-scheme` and changes live when the device
does (`applyTheme` in `app/lib/theme.ts`, with `resolveTheme` and
`watchSystemTheme` from `@mike/client`). The class on the document root is the
*resolved* theme; the preference itself is what is stored, in the profile and in
`localStorage["litt:theme"]`. `THEME_BOOT_SCRIPT` (a constant, run in `<head>`
before the first paint, like the text-size one) reads that key and resolves
`system` with `matchMedia`, so a returning visitor never sees the wrong page
first. `meta[name=theme-color]` follows the resolved theme. In the Word add-in
`system` follows Office's theme (`officeTheme.isDarkTheme`) when the host
reports it and the device otherwise; the pane has no control for it.

Two accesses, one control: `ThemeSegmentedUI` (`@mike/ui`), a `radiogroup`
with arrow-key movement and the same look as the text-size control, in the
**account menu** (`AccountMenuTheme` in `AppSidebar`: after the workspace,
before Settings, icons, 28 px buttons and 44 px on a phone, choosing does not
close the menu, and Automático says "now: dark" or "now: light") and in
**Settings > Appearance** (words only). Both use `useThemeChoice`, so a change
in one moves the other, shows at once and rolls back if the save fails. There
is no keyboard shortcut and no loose button in the sidebar.

The LiTT marks (`LittBrandUI.tsx`) and the status mark
(`LittStatusMarkUI.tsx`) need no theme subscription: their fills are
`var(--litt-mark-ink)`, `var(--litt-mark-accent)` and the `--litt-status-*`
tokens, which `.dark` switches.

### User avatars

`components/ui/user-avatar.tsx` renders profile photos and the monogram fallback
for the account button, People/share rows, member pickers, organization members,
and audit-log identities. Pass the identity's email, display name, and
`profile_photo` from the existing authorized roster response. Table avatars use
`size="sm"`: 16px across with 8px white serif initials. Pickers and detail views
use the default 20px size. Loading placeholders match the table's 16px size.
The background colour is stable and keyed to the
normalized email, falling back to the display name. A missing or
unreadable image restores those initials.

The general email lookup returns only identity fields. New direct-share
recipients show a monogram until their photo is available through an authorized
roster response; organization pickers can use their existing member photos.
Audit logs resolve photos only for actors on the authorized organization page;
personal activity and CSV exports do not fetch photos. Affected members and
invitation recipients prefer their current display name, falling back to the
recorded email, which also keeps their monogram color stable. These lookups
fetch names only for affected people on the authorized page. The Performed by
filter searches distinct actors from the organization audit log, including
former members, in a scrollable list of 20 people per page. Selecting a person
filters by their ID and preserves that filter in CSV exports.

Settings > Profile offers upload and an Edit button (`bg-interactive`) for saved images. Profile photos
and organization logos share `ImageCropModal`: both support dragging, keyboard
positioning, zoom, preview, and explicit saving. Edit reopens the saved image.
The footer places Save (`bg-interactive`) on the right and red Remove on the left.
Save stays disabled until the image or framing changes.
Photos use a circular preview
and a crop that fills it. PNG, JPEG, and WebP source files up to 10 MB are
rendered to a 256px PNG before upload; the API limits stored images to 512 KB.

## Typography

Three faces, all SIL OFL 1.1, all served from this repository (no Google Fonts
request, in the web app or in the Word add-in). `frontend/src/app/fonts/fonts.css`
declares them and sets the CSS variables; `DesignTokensUI.css` maps them to
Tailwind. Licenses sit next to the files (`Inter-OFL.txt`, `Newsreader-OFL.txt`,
`DepartureMono-OFL.txt`) and in `CREDITS.md`.

| Face | Variable | Utility | Used for |
| --- | --- | --- | --- |
| Inter | `--font-inter` → `--font-sans` | `font-sans` (body default) | All UI text: buttons, menus, tables, forms, the user's own messages. |
| Newsreader | `--font-newsreader` → `--font-serif` | `font-serif` | The serif of the interface: greeting, page and settings titles (`PAGE_HEADER_TITLE_CLASS`), markdown headings, the text of the assistant's answers (`MarkdownContent`, Word's `ProseBlock`), legal documents, document titles and the initials of avatars. |
| Departure Mono | `--font-departure-mono` → `--font-pixel` | `font-pixel` | Short details only, at a fixed 11 px (see below). |

- Newsreader is served as one roman file with optical size pinned at 16 and
  weights 400 to 600, plus an italic pinned at 400, each split into latin and
  latin-ext (`unicode-range`; the family has no Greek or Cyrillic, which fall
  back to the system serif). The italic downloads only when a page really sets
  italic text. Its fallback face (`Newsreader Fallback`, on Times New Roman)
  carries the metrics next/font computes, so text does not jump while the font
  loads. Asking for a weight above 600 or below 400 gets the nearest real
  weight: `font-light` and `font-bold` do not belong with `font-serif`.
- `:root { font-synthesis: none }` (`globals.css`): the browser never invents a
  bold or an italic.
- **Departure Mono is the one exception to "type sizes are in rem".** It is
  used only at `text-[11px]` (`PIXEL_TEXT_CLASS` in `@mike/ui`), on purpose and
  fixed: a pixel font is crisp only on its own grid. Measured in Chromium at 1×,
  11 px draws with two colors, 12.4 px with 60 and 13.75 px with 54. It
  therefore does not follow the text-size setting (the browser zoom does
  enlarge it). Because of that, use it only for pieces of 1 to 12 characters
  that are also written in normal text or in the accessible label: shortcuts,
  counters, model routes ("OpenRouter") and versions or commits ("V3").
  `pixelTextClass(text, fallback)` applies the rule to text that is translated.
  Never in sentences, buttons, model names or headings.
- The interface never combines an "L" in Newsreader with letters in Departure
  Mono, nor writes "LiTT" in Departure Mono: that imitates the wordmark (rules 1
  and 2 of `docs/brand/DESIGN.md`).
- The document metadata line ("Fecha: …") is Inter `text-sm`, not serif.

The Word add-in imports the same `fonts.css` (the `@litt/fonts` webpack alias;
`word-addin/Dockerfile` copies the directory), so `shared/ui` components render
identically in both targets. Only the pane changes letters: the documents in
Word keep their own fonts.

De facto type scale in the app chrome, most to least common: `text-xs` (dense
table and control text — the default for most chrome), `text-sm` (body copy,
normal-size buttons), `text-3xs` (10 px: badges, superscript citations; `text-2xs` is 11 px; both in rem so they follow the text-size setting, never `text-[Npx]`),
`text-2xl font-serif` (display headings and empty states), `text-xl font-serif`
(page titles and breadcrumbs). There is no separate heading component; use
`EmptyState` for empty-state headings and `PageHeader` for page titles so the
display style stays in one place. A plain page title is an `<h1>` passed as
`PageHeader`'s children with `PAGE_HEADER_TITLE_CLASS` (from
`shared/pageHeaderStyles.ts`), which is also what its breadcrumbs use. `PAGE_HEADER_ROW_CLASS` is what
keeps that title on the line of the sidebar's logo text. The settings areas
(`SettingsShell`) have a larger display title of their own, `text-3xl`.

## Spacing and radius

There is no bespoke spacing scale — Tailwind's default applies. The de facto
subset actually in use across `frontend/src/app/components`, by frequency:

- Horizontal padding: `px-3` (dominant), `px-2`, `px-4`, `px-2.5`
- Vertical padding: `py-2` (dominant), `py-1.5`, `py-1`, `py-0.5`
- Gaps: `gap-2`, `gap-1.5`, `gap-1`, `gap-3`
- Control heights: `h-7` (compact chrome: pills, icon buttons, table rows are
  `h-10`), `h-8`, `h-9`, `h-10`

Stick to those steps. A one-off `px-[13px]` is the kind of drift this document
exists to prevent.

Radius comes from one token, `--radius: 0.625rem`, with the shadcn scale derived
from it (`--radius-sm/-md/-lg/-xl` = `radius -4px / -2px / radius / +4px`). In
practice the app uses the plain Tailwind radii directly: `rounded-full` (pills,
icon buttons), `rounded-lg`/`rounded-md` (rows, list items), `rounded-xl`
(inputs, cards), `rounded-2xl` (panels, dropdown surfaces).

### Fit content before making a card compact

Account identity, permission level, and action controls must remain readable at
ordinary lengths. For example, `alex.morgan@example.com` and `Read-only` should
both be visible without a tooltip, opening a dialog, or horizontal scrolling.

- Give independent information its own line: service name, account email, then
  permission/status. Do not concatenate everything into one truncated subtitle.
- Use `min-w-0` on flexible children and `[overflow-wrap:anywhere]` for long
  unbroken identifiers. Prefer natural wrapping and card growth to ellipsis,
  clipping, smaller text, or fixed heights. Do not use `overflow-hidden` to hide
  a layout defect.
- Let action controls wrap and choose columns using the available container
  width, including space consumed by application sidebars. Viewport width alone
  does not describe a card's actual space.
- A shared minimum height can align short cards and loading states; it must not
  prevent longer content from increasing the height. Loading, connected, empty,
  and error states use the same outer layout.
- Verify realistic emails and deliberately long addresses at mobile, tablet,
  and desktop widths in light and dark mode. Check the text nodes as well as
  the outer card: a card can fit while its subtitle silently clips.

Truncation is appropriate only when the omitted text is genuinely secondary and
the user has an accessible way to inspect it. Account identity and permissions
in connector cards are essential information.

### Side-by-side chats

The Assistant and the IDE can each show two chats at once (`?side=<chatId>` in
the URL; see `useChatRoute`). Both keep their widths honest by shrinking the
neighbours, never by clipping content:

- **Assistant.** The two chat columns share the page and are split by a
  hairline (`AssistantChatDivider`) that drags or moves with the arrow keys.
  The document side panel reserves 400px for each chat and opens at two
  fifths of the page beside two chats rather than at half.
- **IDE.** The document view takes what the explorer and chat panels leave and
  never less than 320px. `app/lib/workspacePanelWidths.ts` owns that maths;
  route every new resizable panel through it rather than clamping inline.
- In the Assistant the second chat needs a wide page: below `md` only the
  primary chat renders, at full width, and the action that opens the side
  chat is not offered. The IDE is a desktop workspace and has no such gate.

The IDE's Open project picker and project switcher list projects in the active
workspace that the user created or was directly added to, whether public or
private. Public visibility alone does not make someone a participant. Switching
workspace clears the picker cache and selection. Inherited organization permissions and
audited private-content access do not put projects in this picker. The backend
applies this participation filter to its already-authorized project list.
The picker and FileDirectory share the compact native `SelectionCheckbox` in
`components/ui/selection-checkbox.tsx`, including its mixed and disabled states.

The app sidebar's History combines assistant chats, tabular reviews, and the
caller's own playbook runs from the active workspace, including reviews inside
projects. Chats and reviews are fetched by last update and runs by start time,
then merged newest first. Older rows stay buffered until
every paginated source reaches them, so fetching another page does not reveal
newer items below older ones. Review rows use the tabular-review SVG icon and
open the review's project or standalone route. Project reviews prefix their
title with the project name. Project prefixes and chat Shared labels use the
same muted `text-gray-400` treatment. Edits and generation starts/completions
advance review activity and promote it in History; lease heartbeats do not.
Running reviews show a spinner, including after navigating away. A review
that finishes successfully while elsewhere shows a tick using the Excel SVG's
green gradient until
opened, matching unread chat completion. Failed, stopped, and incomplete
reviews do not get the completion icon. Status polling reads small authorized
snapshots only for running reviews; it never downloads their documents.
Playbook run rows use the playbook SVG icon, prefix the document name with the
playbook's name in the same muted treatment, and open the run on its
playbook's Runs tab. They show the same spinner while running and the same
green tick once finished, until the run's results are on screen; a failed or
interrupted run gets no tick.
Activity refreshes keep the loaded History rows and pagination visible; only
the affected review's icon changes. A workspace change still clears the old list.
Review overview project filters, create choices and move destinations also stay
within their workspace; selecting a project filter must not disable workspace
scoping. A workspace switch resets those filters and dialogs. Detail pages opened
by link follow the item's own workspace, with project children inheriting theirs.
Late list pages and chat creations must not populate a newly selected workspace.
Chat Share, Rename and Delete actions are visible only to owners. Directly shared
standalone chats offer Leave to viewers and editors; project chats never offer
Leave because their access comes from project membership. Audited organization
access is not a direct sharing grant and does not offer Leave.
When opening a chat, missing workspace metadata means the detail is still loading;
only an explicit null organization means Personal. Prefer the matching chat detail
over a lightweight History row for workspace and attachment scope.

## Elevation and the glass surface

The signature surface combines a light fill, hairline border, inset highlight
shadows, and soft elevation. Each liquid-glass class owns all three material
properties—background, border, and shadow—through light/dark CSS variables in
`LiquidGlassUI.css`; components should not repeat a surface border utility. The
flat tier uses a solid fill so broad surfaces and sticky table cells render as
one continuous plane. The float tier is also solid so menus and persistent
chrome fully obscure content beneath them; subtle and overlay tiers retain
their translucency where depth or underlying content matters.
Elevation is centralized in
`packages/ui/styles/LiquidGlassUI.css`, with class-name constants exported
from `@mike/ui` (`packages/ui/src/LiquidGlassUI.ts`). Do not write a new
`shadow-[...]` recipe for a general glass
surface.

Use the lowest tier that communicates the required depth:

| Material | Class | Use for |
| --- | --- | --- |
| Flat | `liquid-glass-flat` | Solid-fill assistant response/message surfaces, tables, glass cards, and signup/login/onboarding cards. |
| Subtle | `liquid-glass-subtle` | Modal inputs, dropdown triggers, tab pills, PageHeader actions, and search/select controls. |
| Float | `liquid-glass-float` | Solid-fill open dropdowns/submenus, `AppSidebar`, and persistent app/assistant/document/tabular side panels. Uses the original AppSidebar shadow depth. |
| Modal | `liquid-glass-modal` | The modal frame only; modal contents use the appropriate general tier. |
| Translucent | `liquid-glass-translucent` | Ask-input surfaces and other translucent content overlays that float over messages. The chat composer is not glass (see Composer). |
| Composer | `COMPOSER_SURFACE_CLASS` (`litt-composer`) | The chat composer on the web and in Word, and its menus (model picker, slash menu): an opaque sheet with a 1 px ring and one soft shadow, `--litt-composer-*` tokens in `DesignTokensUI.css`, and a neutral (tinta or papel, never amber) focus ring and caret. Radii: 17 px, 20 px with a finger, 18 px in Word. |
| Translucent action modifier | `liquid-glass-translucent-action` | Compact over-message actions such as scroll-to-bottom; use with `liquid-glass-translucent`. |

Interactive color is separate from elevation so every tier can share one
state treatment:

| State | Class constant | Rendered class | Use for |
| --- | --- | --- | --- |
| General hover | `LIQUID_GLASS_HOVER_CLASS` | `liquid-glass-hover` | Liquid-glass controls and rows outside a modal. |
| General selected | `LIQUID_GLASS_SELECTED_CLASS` | `liquid-glass-selected` | Selected liquid-glass controls and rows outside a modal. |
| General pressed | `LIQUID_GLASS_PRESSED_CLASS` | `liquid-glass-pressed` | Momentary press feedback where needed. |
| Modal row hover | `LIQUID_GLASS_MODAL_ROW_HOVER_CLASS` | `liquid-glass-modal-row-hover` | FileDirectory, Quick Actions, workflow picker, and other rows on a modal frame. |
| Modal row selected | `LIQUID_GLASS_MODAL_ROW_SELECTED_CLASS` | `liquid-glass-modal-row-selected` | Selected rows on a modal frame. |

The modal row pair is intentionally distinct because `liquid-glass-modal` has
a darker resting fill. Do not use it for inputs or buttons merely because they
happen to appear inside a modal; it is for selectable list rows on the modal
frame.

Every material owns its base light- and dark-theme fill, border, and elevation.
Interactive state classes may override the base fill for selected, hovered, or
focused states. The translucent material additionally owns its blur and hover
treatment because chat messages visibly pass underneath it.

Compose the material classes through the established primitives and constants:

- `GlassCardUI` — cards
- `LIQUID_FLOAT_PANEL_SURFACE_CLASS`,
  `LIQUID_SUBTLE_PANEL_SURFACE_CLASS`, and `LIQUID_TABLE_SURFACE_CLASS` in
  `components/ui/liquid-surface.ts` — panels and tables
- `DropdownContent` / `DropdownSurface` — menus
- `GlassIconButtonUI` — circular icon buttons

### Dropdowns

Every menu a button or a right-click opens is built from
`packages/ui/src/dropdown.tsx`, exported from `@mike/ui` for both the web app
and the Word add-in. There is no separate web wrapper. Do not hand-build a menu
from a positioned
`div` and buttons: that loses keyboard navigation, menu roles, focus return,
and viewport collision handling.

- `Dropdown`, `DropdownTrigger`, `DropdownContent`, `DropdownItem` (with
  `selected` and `variant="destructive"`), `DropdownRadioGroup`,
  `DropdownRadioItem`, `DropdownCheckboxItem`, `DropdownLabel`,
  `DropdownSeparator` — a menu opened from a button.
- `DropdownAtPoint` — a right-click menu opened at the cursor.
- `RowActions` / `RowActionMenuItems` (`components/shared`) — a table row's
  `···` menu and the same actions as a right-click menu.
- `SelectionActionsMenu` (`components/shared`) — the toolbar "Actions" menu a
  table shows while rows are selected.
- `DropdownSurface` / `DropdownButton` — the menu's look for popovers that are
  not menus, such as a combobox's option list where focus must stay in the
  text field.

Menus stack at `z-[250]`, above modals and side panels, so call sites do not
set a z-index. Pass a `z-*` class to `DropdownContent` only when a menu must
sit under or over something specific.

Rows sit 4px apart (`DROPDOWN_ROWS_CLASS`, `flex flex-col gap-1`), applied by
`DropdownContent` and `DropdownRadioGroup`. Do not add `space-y-*` to a menu;
give any element that wraps rows inside one (a scrolling list, a group)
`DROPDOWN_ROWS_CLASS` instead. Every focus ring inside a menu is inset, and the
surface enforces that for controls that bring their own offset ring.

### Scrollbars

Scroll areas get a thin scrollbar with a transparent track from a global base
rule in `globals.css`, so a classic scrollbar (mouse connected, Windows, Linux)
does not draw an opaque gutter over a glass surface. Do not restyle scrollbars
per component; an `overflow-auto` container needs no extra class. The
spreadsheet (`.fortune-container`) and DOCX editor (`.docx-editor`) are
excluded because they size and style their own scrollbars.

For modal body scroll areas, add `data-modal-scroll="vertical"` to the scrolling
element. `ModalUI` supplies matching 8px horizontal negative margins and padding
to leave room for shadows and focus rings while keeping content aligned. Use
`data-modal-scroll="horizontal"` for scrolling tab strips; these also get 8px
vertical margins and padding. Keep this spacing in the shared modal rather than
adding margin/padding workarounds in its children. Nested menus and inset panels
keep their own spacing and should not receive this attribute.

## UI primitives

| Primitive | Location | Use it for |
| --- | --- | --- |
| `PillButtonUI` | `shared/ui` | Primary action button (`tone`: black/white/blue/danger; the `blue` tone keeps its name for API stability and renders the interactive tokens, not a blue). |
| `TextButtonUI` | `shared/ui` | Background-free actions, with optional icons and loading state. Use `textButtonUIClassName` from `TextButtonUI.styles` for links. No background, border, or shadow; hover changes text color. |
| `TabPillButtonUI` | `shared/ui` | Segmented filter/tab pills. Pass `active` to get `aria-pressed`. Resting text matches PageHeader actions (`text-gray-500`), with `text-gray-900` on hover or selection. |
| `GlassIconButtonUI` | `shared/ui` | Circular glass icon button — modal close, panel dismiss. Requires `aria-label`. |
| `CloseButton` | `shared/ui` | The small white ✕ that dismisses a modal, side panel, confirmation, toast, or `WarningPopup`. `size`: `sm` for side panels, confirmations, and notices; `md` for modals. |
| `GlassCardUI` | `shared/ui` | Canonical liquid-glass card surface. |
| `TextSlabUI` | `shared/ui` | Inset slab holding quoted or proposed text inside a card — citation quotes, tracked-change diffs, and their loading/empty states. Owns shape, padding, and fill; the caller owns typography. |
| `ToggleSwitchUI` | `shared/ui` | `role="switch"` toggle with an optional text label. |
| `CitationPillUI` | `shared/ui` | Canonical numbered citation control for web, tabular review, and Word. Uses neutral gray by default, red for verification errors, and the neutral interactive tint for the selected state (`bg-interactive-soft-strong` with `text-interactive`). |
| `TrainingConfidenceUI` | `shared/ui` | The training thermometer: a named radio group of four levels, the chosen one `aria-checked` with a check mark (state is never colour alone). Takes its words from the host; web and Word share it. |
| `InputUI` | `shared/ui` | Canonical shadcn input for the web app and Word add-in. |
| `form-field` | `components/ui` | `FormTextInput` (glass/minimal variants) and `FieldLabel` for app forms. |
| `NoticeCardUI` | `shared/ui` | The one card every notice is drawn with: glass surface, tone icon (error/success/info), title, message, action row, close button. Do not use it directly in a screen; use one of the two wrappers below. |
| `WarningPopup` | `components/popups` | The `NoticeCardUI` for every warning. A component opens and closes it with `open` / `onClose`; `AppToasts` renders one per `notifyError`. |
| `search-bar` | `components/ui` | Search input with clear button. Pass `label` for a meaningful accessible name. |
| `dropdown` | `shared/ui` | The one dropdown for the web app and the Word add-in: Radix menu behaviour with the liquid-glass look. See "Dropdowns" below. |
| `liquid-surface` | `components/ui` | Web-only shared surface class constants. |
| `empty-state` | `components/ui` | Icon + display heading + copy + optional action, for "nothing here yet". Wrap in `TableEmptyState` inside a table. |
| `check-square` | `components/ui` | The selection square used by directory/picker rows. Decorative by default; the row owns the ARIA state. |

For a real standalone checkbox use `<input type="checkbox">` with
`TABLE_CHECKBOX_CLASS` (see `TablePrimitive.tsx`), not `check-square`.

## Settings

Settings has two homes («Ajustes» for what is mine, «Ajustes del despacho» for
what the firm decides) with tabs in groups, written once in
`frontend/src/app/lib/settingsMap.ts` and described in
[settings-map.md](settings-map.md). The frame is `SettingsShell`; do not draw
another sidebar, and every tab or section a screen adds goes in the map (the test
`settingsMap.test.ts` fails otherwise). Its names and help texts follow
[the writing rules in i18n.md](i18n.md#writing-the-text-of-settings).

**Group titles** («Mi cuenta», «Mis llaves y servicios»…) are in ink and in the
page-title serif (`font-serif`, `text-[1.0625rem]` on the desktop bar and
`text-[1.1875rem]` on the phone list, in `rem` so they follow the text size),
with air above; the options under them stay `text-sm text-gray-500`. The phone
rows are 44 px or more.

**Signals.** Six small components in `components/settings/SettingsText.tsx` say
what a text is: `SettingsTag` (optional, recommended, who it applies to),
`SettingsNotice` and `SettingsNoticeLine` (a notice, or the one red notice of
what cannot be undone), `SettingsManagedRow` («Lo administra tu despacho») and
`SettingsMoreInfo` («Más información»). Each keeps its icon from lucide
(`aria-hidden`) next to a text that is always visible. Their rules and the
tokens `--litt-note-rule`, `--litt-danger-rule` and `--litt-danger-text` are in
`DesignTokensUI.css`; `warningPalette.test.ts` keeps amber and orange out.

## Reporting failures

Every failure that stops something the user asked for must be shown to them,
with a concise and accurate message and honest next steps. "Notices: toast or
WarningPopup" below says what the notice looks like; this section says what
goes in it and when.

1. **Classify once.** `describeError` from `frontend/src/app/lib/userFacingError.ts`
   (the shared classifier in `packages/client/src/userError.ts` plus the
   web app's fixed sentences for server-reported codes such as
   `schema_out_of_date`) turns any thrown value into
   `{ kind, title, message, retryable, supportable, requestId }`. Pass
   `action` in the imperative ("save the document") so the title reads
   "Couldn't save the document". 4xx `detail` from the backend is written for
   users and is shown; 5xx bodies and stack text never are.
2. **Show it in the right place.**
   - A form field the user is editing: inline text next to the field, using
     the description's `message`.
   - Anything else (saves, deletes, loads, exports, background refreshes):
     `notifyError(error, { action, onRetry, dedupeKey })`. `AppToasts` draws
     it as a `WarningPopup` with "Retry" (only when the failure is retryable
     and a closure is given) and "Contact support" (only for a failure the
     user cannot fix: a pre-filled email to `SUPPORT_EMAIL` carrying the
     request id, code, page and time). A component may call it for a failure
     on its own screen when it needs those actions; render a `WarningPopup`
     directly only for a warning with its own content or action.
   - A batch that failed for some items (a bulk delete, a multi-file move or
     upload): `notifyPartialFailure(message, { action, onRetry })`, one notice
     naming what did not happen, with a Retry that re-runs only those items.
   - A whole screen that cannot render: `EmptyState tone="error"` (wrapped
     in `TableEmptyState` inside a table) with a "Try again" action. An empty table must never stand in
     for "this did not load".
   - A route that threw: `app/error.tsx` and `app/global-error.tsx` offer
     "Try again" and "Contact support" with the error digest, never the
     message.
3. **Revert optimistic state** before notifying, so the screen never shows a
   change that did not happen, and revert only the item that failed. Use a
   functional updater (and `restoreOptimisticallyDeletedRows` in
   `app/lib/optimisticRows.ts` for a removed row) rather than restoring a
   snapshot of the whole list.
4. **Retry re-runs the current code.** By the time "Retry" is pressed the
   handler that failed has usually been re-created. Read it through a ref
   kept current with `useLatestRef` / `useAssignLatest`
   (`app/hooks/useLatestRef.ts`), and re-send only what did not land.
5. **Destructive actions are retried through their own entry point.** Retry
   after a failed single delete that asked for confirmation re-opens that
   confirmation; it never deletes from the notice. A delete that never asked
   (a row action on a single-version document, a review or a project) re-runs
   the same entry point. A bulk delete's Retry re-runs only the items that
   failed, which the user has already confirmed.
6. **Cancellation is not an error.** `notifyError` returns `null` for an
   `AbortError` and shows nothing.
7. **Repeats collapse.** Polling and autosave loops pass a `dedupeKey` so a
   failing loop shows one notice, not one per tick.
8. **Silence needs a reason.** A catch that intentionally shows nothing
   (cleanup, a local-storage JSON fallback, a body drain) carries a one-line
   comment saying why.

Never call `window.alert`.

## Choosing: existing primitive, shadcn registry, or a one-off

Work down this list and stop at the first that fits.

1. **A primitive in `components/ui/` (or `shared/ui/`) already does it.** Use
   it. If it is 90% right, add a prop or a variant to the primitive rather than
   forking it — a fork is how the duplication this document consolidates got
   there in the first place.
2. **A shadcn registry component does it.** Add it with the shadcn CLI so it
   lands in `components/ui/` with the project's `new-york` style and CSS
   variables, then adapt it in place. Prefer this over hand-rolling anything
   with non-trivial interaction or ARIA (menus, dialogs, popovers, tooltips).
3. **The markup is genuinely feature-specific and appears once.** Write it in
   the feature directory. One occurrence is not a primitive.
4. **The same markup now appears in two or more feature files.** Promote it:
   move it into `components/ui/` with a small prop surface, replace every copy,
   and add a test. Put it in `shared/ui/` instead only if the Word add-in needs
   it too.

Do not add a new UI dependency to solve something Tailwind plus an existing
primitive covers.

## Accessibility baseline

These are the rules the primitives already follow. Match them in new work.

- **Focus is always visible.** Every interactive primitive carries
  `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus
  focus-visible:ring-offset-2`. If you write `outline-none` you owe the element a
  replacement indicator in the same class string.
- **Focus rings are amber, never grey.** Write `focus-visible:ring-focus` (or
  `outline-focus` / `focus:border-focus`), not a gray or a raw palette ring.
  `ring-focus` reads `--color-focus`, which is `--litt-accent`: ámbar tinta
  (`#965900`) on the light theme and ámbar fósforo (`#FFB21E`) on the dark one
  (see [Marca LiTT v1.0](#marca-litt-v10)). A control that sets nothing gets
  the same amber from the base-layer `:focus-visible` rule, which draws
  `--focus-ring-color`.
- **An inset ring traces the hover fill.** A control carrying a hover or
  selected fill class (`LIQUID_GLASS_HOVER_CLASS`, `LIQUID_GLASS_SELECTED_CLASS`,
  and the modal-row pair) gets an inset ring on that fill's perimeter by
  default. When the fill belongs to a row that wraps the focusable control, as
  in the sidebar's chat and project rows, give the control `data-focus-fill`
  and `outline-none` so the row draws the ring instead.
- **Text fields may hide the ring after a click.** Browsers match
  `:focus-visible` on a focused text field even when it was clicked. Add
  `keyboard-focus-ring` (defined in `globals.css`, driven by
  `useInputModality`) to keep the ring for Tab navigation only; the caret still
  shows focus after a click.
- **A background tint is not a focus indicator** when the tint is a small
  luminance step. Dropdown items pair the semantic focus tint with a ring for
  this reason.
- **Icon-only controls need a name.** `GlassIconButtonUI` requires `aria-label` in
  its type. When a control has a *visible* label, do not override it with a
  different `aria-label` (WCAG 2.5.3). Name an icon-only control, and let a
  control with visible text be named by that text.
- **`type="button"` on every non-submit button.** Anything inside a `<form>`
  defaults to submitting.
- **State goes in ARIA, not only in color.** `ToggleSwitchUI` uses
  `role="switch"` + `aria-checked`, `TabPillButtonUI` uses `aria-pressed`,
  `check-square` callers that own the interaction pass
  `role="checkbox"` + `aria-checked` (`"mixed"` for indeterminate).
- **Non-text contrast ≥ 3:1** for control boundaries (WCAG 1.4.11). The
  off-state switch track needs `bg-gray-300 ring-1 ring-inset ring-gray-500` to
  clear it against white; `bg-gray-100` does not.
- **Decorative elements are hidden.** Icons inside a labelled control get
  `aria-hidden`.

## Notices: toast or WarningPopup

Both show the same card, `NoticeCardUI`, so they always look alike. A
change to how a notice looks goes in `NoticeCardUI.tsx`, never in one of the
wrappers; `WarningPopup.test.tsx` fails if a popup and an error toast stop
rendering the same card. The card's dismiss control is the shared
`CloseButton`.

The title, message and supplementary content share one text column beside
the icon. Callers should not add their own left padding to supplementary
content.

Both appear in one column in the bottom-right corner of the page
(`NOTICE_STACK_POSITION_CLASS` in `WarningPopup.tsx`; full width above the
home indicator on a phone), so a notice never covers the page header or the
first lines of the page. `ToastViewportUI` owns that column, and a
`WarningPopup` renders into it, so a popup and a toast stack instead of
covering each other.

The signed-out screens are the exception: their wordmark sits at the top
and the form is the whole page, so a failure there is shown inside the card
with `AuthFormError` (`components/auth/`), with the same title, message,
Retry and Contact support a `WarningPopup` would carry.

| | Toast (`notifySuccess`, `notifyInfo`, `showToast`) | `WarningPopup` |
| --- | --- | --- |
| Used for | Success and information | Every warning and error |
| Who opens it | Any code, including code with no React component | The component on screen through its own `open` state, or any code through `notifyError` |
| Closes | On a timer (paused on hover or focus) | Only when the user closes it or presses Escape |
| Tones | success, info | error |
| Word add-in | Yes | No (web only) |

In the web app a warning is always a **`WarningPopup`**. A component that
reports a failure on its own screen with custom content or its own action (a
rejected upload, a permission refusal) renders one directly. Everything else,
including a component failure that needs Retry or Contact support and any
code with no component of its own (the API client, a stream callback, the
offline listener), calls `notifyError`; `AppToasts` draws what it raises with
`WarningPopup`, including those actions. See "Reporting failures" above.

No two actions on one notice share a look. The last action in the row is the
primary one and is a black pill (`WarningPopup`'s `primaryAction` always
is); the one before it is a white pill; any further action is plain text.
Contact support comes first in the row, so it is black only when it is the
sole action. Style a custom action with
`noticeActionClassName(noticeActionEmphasis(index, count))`.

A notice fades in rising 8 px over 200 ms and fades out over 150 ms
(`.notice-card` in `LiquidGlassUI.css`, so the web app and the add-in draw it
alike). On a touch screen it is dismissed by swiping it sideways
(`NoticeCardUI`); a mouse is not affected. All of it is off with "Reduce
motion". `ToastViewportUI` keeps a visually hidden polite live region mounted
from the start and writes a success or info text into it as the toast is
raised, because a card inserted with its text already inside is announced
unreliably; an error card stays its own `role="alert"`.

Use a **toast** only for a short confirmation ("Changes saved") or
information.

The Word add-in has no `WarningPopup`, so there `ToastViewportUI` draws
errors as toasts, in its default column at the top centre of the task pane.

## Phone and motion

How the shell behaves under 768 px, and the timings it shares. The curve is
always `cubic-bezier(0.32, 0.72, 0, 1)`, and everything moves only under
`motion-safe` (the global "Reduce motion" rule in `globals.css` covers the
rest).

- **Dialogs are a bottom sheet** (`ModalUI` with `sheet`, which the web
  `Modal` adapter turns on): full width, rounded top corners, a grabber, a
  `dvh` height cap and the home-indicator inset under the footer; 250 ms in,
  180 ms out. From 768 px up it is the centred dialog, and the Word add-in
  never sets `sheet`.
- **The sidebar** on a phone is a window: it slides in with `transform`
  (250 ms in, 180 ms out) over a veil of ink at 25 %, is `role="dialog"`
  `aria-modal` while open, makes the page `inert`, closes on Escape and gives
  focus back to its button (`aria-expanded`, `aria-controls="app-sidebar"`).
  Closed, it is `inert`. On desktop only the panel's width and radius animate
  (200 ms); the column beside it is as wide as the final sidebar from the
  first frame, so the page is laid out once.
- **Settings on a phone** opens on a grouped list at `/settings/menu`; a row
  opens its section with a "‹ Settings" button. `/settings` stays the Account
  page, so existing links work. Desktop keeps the tab column.
- **The chat box on an on-screen keyboard** (`useSoftKeyboard`: a coarse
  pointer and no physical keyboard seen): Enter is a line break, the arrow
  sends, and sending closes the keyboard. Otherwise Enter sends and
  Shift+Enter breaks the line.
- **Screen readers:** the pages layout starts with a "Skip to content" link
  (`.skip-link`) to `main#main-content`, and the sidebar is a `<nav>` named
  "Main navigation".
- **Add to Home Screen:** `app/manifest.ts` (full-screen LiTT, starting at
  `/assistant`, the icons already in `public/`), the Apple web-app meta tags,
  and a `theme-color` that is papel or tinta by the person's theme
  (`lib/theme.ts`). There is no service worker and no offline mode.
- **Search engines:** off while the beta is closed; see
  [search-indexing.md](search-indexing.md).

## Component catalog

Every primitive in the table above has stories in the Ladle catalog. Run it
from `frontend/`:

```bash
npm run catalog          # dev server on http://localhost:61000
npm run catalog:build    # static build; this is what CI smoke-tests
```

Stories live in a `stories/` directory beside each primitive collection:
`components/ui/stories/` for web primitives and `shared/ui/stories/` for
cross-target primitives. When you add a primitive, add a story to the matching
directory in the same change. Stories are inside the app's `tsconfig`, so
`npm run build`
type-checks them: a story that drifts from its primitive's props fails CI
rather than rotting quietly. `npm run catalog:build` then bundles them, which
catches a story importing an export that no longer exists.

Two things about the catalog environment are worth knowing before you edit it:

- The catalog imports the app's real `globals.css`, so it renders on the same
  tokens and materials as the app. The theme toggle drives the same `.dark`
  class the Settings > Appearance preference sets, so dark values are real.
- Tailwind v4's automatic source detection skips dot-directories, so nothing
  in `frontend/.ladle/` is scanned for class names. Catalog chrome is styled
  with plain CSS in `.ladle/ladle.css` for that reason. Both `stories/`
  directories live under `src/` and are scanned normally, so use Tailwind
  freely in a `*.stories.tsx`.

## Related

- The map of Settings: [settings-map.md](settings-map.md)
- Frontend test conventions: [frontend-testing.md](frontend-testing.md)
