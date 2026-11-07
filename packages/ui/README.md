# @mike/ui

React primitives rendered by both the Mike web app (`frontend/`) and the Word
add-in (`word-addin/`): liquid-glass surfaces, pills and buttons, the dropdown,
the model picker, toasts, modals, and the assistant message blocks, plus
LiTT's brand (`LittBrandUI`), the AGPL "Código fuente" link
(`SourceCodeLinkUI`) and the training UI (`Training*UI`,
`useTrainingTurnNotes`).

## Public surface

`src/index.ts` is the package's only entry point. Consumers import by name:

```ts
import { PillButtonUI, ToastViewportUI, Dropdown } from "@mike/ui";
```

A file under `src/` that `index.ts` does not re-export is internal to the
package. The three stylesheets in `styles/` are imported by each application's
entry stylesheet (`frontend/src/app/globals.css`,
`word-addin/src/taskpane/styles.css`), which also register `src/` for Tailwind
class scanning with one `@source` entry each.

## Rules

- Framework-light: React, `lucide-react`, `clsx`, `tailwind-merge`, the Radix
  dropdown, `@mike/client`, and `@mike/contracts` for wire types
  (`import type` only). Nothing from `frontend/src/app/` or
  `word-addin/src/`.
- Cross-target primitives use the `XxxUI.tsx` convention; `dropdown.tsx` is the
  one exception. See `docs/design-system.md` for tokens, surfaces and the
  accessibility baseline.
- Mark components that use hooks or browser APIs with `"use client"`: the web
  app may import the barrel from a server component.

## How it is wired

This is a source package with no build step and no `node_modules`. Each
application maps the name to `src/index.ts` with a tsconfig `paths` entry (and,
for the add-in, a webpack alias), and resolves the package's dependencies from
its own `node_modules`. `peerDependencies` in `package.json` lists what the
package expects to find there.

The frontend Dockerfile copies this directory to `/app/packages/ui` and the
add-in Dockerfile to `/packages/ui`, the paths the aliases resolve to in each
image; `frontend/src/__tests__/architecture.test.ts` checks
that the alias and the copy agree.

## Tests and stories

Tests are colocated (`src/*.test.tsx`) and run with the frontend's Vitest:

```bash
npm test --prefix frontend -- ../packages/ui
```

Stories in `stories/` are part of the web app's Ladle catalog
(`npm run catalog --prefix frontend`).
