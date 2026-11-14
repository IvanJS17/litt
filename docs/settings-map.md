# The map of Settings

Settings has **two homes**, and each thing lives in exactly one of them:

- **Ajustes** (`personal`): what is mine. Only I see it and it applies to me.
- **Ajustes del despacho · \<nombre\>** (`firm`): what the firm decides. It
  applies to everyone who works in that firm's space. A member can read some
  of it; owners and administrators change it.

The map is written once, in code: [`frontend/src/app/lib/settingsMap.ts`](../frontend/src/app/lib/settingsMap.ts).
It declares the groups, the tabs, their routes, their home, who is offered each
one, and the catalog keys of each tab's name and help text. Everything that
draws or searches Settings reads from it:

| Reads the map | For |
| --- | --- |
| `SettingsLayoutClient` (`/settings/**`) | the desktop sidebar with its group headings, the tabs, the line «Estos ajustes son tuyos…» |
| `/settings/menu` (the phone list, drawn by `SettingsShell`) | the same groups as the desktop |
| `OrganizationSettingsShell` (`/organizations/[id]/settings/**`) | the firm's sidebar, the heading «Ajustes del despacho · \<nombre\>» |
| `settingsSearch` | each search entry names a tab id from the map |
| `settingsMap.test.ts` | fails when a page is not in the map (see below) |

## The map

```
Ajustes (lo mío)
  Mi cuenta ............... Cuenta · Seguridad · Privacidad y datos · Mi actividad
  Mi forma de trabajar .... Personalización · Memoria · Apariencia · Asistente · Preferencias de modelos
  Mis llaves y servicios .. Mis llaves de IA · Búsqueda web · Lectura de escaneados · Conectores
  Mi formación ............ Mi formación (+ aprendices y Panel del mentor, dentro, si soy mentor)
  Mis despachos ........... lista e invitaciones; cada despacho abre «Ajustes del despacho»
  Administración de la plataforma ... Invitaciones a la beta · Estadísticas de la beta (solo admin de plataforma)

Ajustes del despacho · <nombre>
  Despacho ................ General · Miembros
  Llaves y servicios ...... Llaves del despacho · Lectura de escaneados      (propietario y administrador)
  Formación y control ..... Formación · Auditoría (propietario y administrador) · Privacidad y datos (solo propietario)
```

| Tab | Home | Route | Offered to |
| --- | --- | --- | --- |
| Cuenta | personal | `/settings` | everyone |
| Seguridad | personal | `/settings/security` | everyone |
| Privacidad y datos | personal | `/settings/privacy-data` | everyone, unless the firm lets members neither export nor delete |
| Mi actividad | personal | `/settings/my-activity` | everyone |
| Personalización, Memoria, Apariencia | personal | `/settings/personalisation`, `/memory`, `/appearance` | everyone |
| Asistente | personal | `/settings/assistant` | everyone |
| Preferencias de modelos | personal | `/settings/models` | everyone |
| Mis llaves de IA | personal | `/settings/byok` | everyone |
| Búsqueda web | personal | `/settings/web-search` | everyone |
| Lectura de escaneados | personal | `/settings/scan-reading` | everyone (my LandingAI key; my document types, personal space only) |
| Conectores | personal | `/settings/connectors` | everyone |
| Mi formación | personal | `/settings/training` (+ `/mentor`, `/contrast`, `/reading/:id`) | everyone; the mentor sections appear inside it |
| Mis despachos | personal | `/settings/organizations` | everyone |
| Invitaciones a la beta, Estadísticas de la beta | personal | `/settings/beta-invitations`, `/settings/beta-stats` | platform administrators |
| General, Miembros | firm | `/organizations/:orgId/settings`, `/members` | every member |
| Llaves del despacho | firm | `/organizations/:orgId/settings/providers` | owners and administrators |
| Lectura de escaneados | firm | `/organizations/:orgId/settings/scan-reading` | owners and administrators |
| Formación | firm | `/organizations/:orgId/settings/training` | every member (owners and administrators also manage mentors) |
| Auditoría | firm | `/organizations/:orgId/settings/audit` | owners and administrators |
| Privacidad y datos | firm | `/organizations/:orgId/settings/privacy-data` | owners |

## Where each thing lives (no duplicates)

| Thing | Lives in | The other home |
| --- | --- | --- |
| AI keys | Personal: Mis llaves de IA. Firm: Llaves del despacho | When the firm blocks a member's own keys, «Mis llaves de IA» says so and links to «Ajustes del despacho → Llaves del despacho» (or says whom to ask). It never repeats the firm's form. |
| Web search keys and choice | Personal: Búsqueda web. Firm: the search keys inside Llaves del despacho | Same link. |
| LandingAI key | Personal: Lectura de escaneados. Firm: Llaves del despacho | — |
| The three «llaves propias» switches (AI, web search, scans) | Firm: Llaves del despacho | — |
| Document types for splitting a case file | Personal: Lectura de escaneados (personal space only). Firm: Lectura de escaneados | In a firm's space the personal page links to the firm's list. |
| Mentors and pupils; the firm's criteria | Firm: Formación | «Mi formación» (personal) has only what is mine. |

## Old addresses

A moved route only redirects; there is no second copy of the page
(`SETTINGS_REDIRECTS` in the map, and the guard checks each one has a page):

| Old | New |
| --- | --- |
| `/settings/features` | `/settings/assistant` |
| `/settings/firm-criteria` | the active firm's `/organizations/:orgId/settings/training` (or `/settings/organizations` when there is none) |
| `/organizations/:orgId/settings/private-content` | `/organizations/:orgId/settings/audit` |
| `/organizations/:orgId` | `/organizations/:orgId/settings` |

## Adding a tab or a section (also what to do with one that comes from upstream)

1. Decide the **home**: is it mine, or the firm's? If a firm member could also
   see it from the personal side, the personal side gets a link
   (`SettingsCrossLink`: «Lo administra tu despacho → Ajustes del despacho»), not a copy.
2. Add it to `SETTINGS_TABS` in `settingsMap.ts`: id, home, group, route,
   who is offered it, and the title and help keys. Add the keys to **both**
   catalogs under `settings.map.tab.*` or `settings.map.firmTab.*`, written to
   the rules in [`i18n.md`](i18n.md#writing-the-text-of-settings).
3. Add the page. The route is the map's `path`; a detail page of the tab goes
   in its `subpaths`; an old address goes in `SETTINGS_REDIRECTS` and its page only
   calls `redirect(...)`.
4. Add search entries (`lib/settingsSearch.ts`) whose `tabId` is the tab's id.
5. `npx vitest run src/app/lib/settingsMap.test.ts` (in `frontend/`). It fails
   with the page it does not know. Do not loosen the test: put the page in the map.

## What the guard checks (`settingsMap.test.ts`)

- every `page.tsx` under `app/(pages)/settings/**` and
  `app/(pages)/organizations/[id]/settings/**` is a tab, a detail page of a tab,
  a redirect, or the phone home;
- every tab has a home, a group of that home, a page, an id and a path used once,
  and a name and a help text (at most 160 characters) in both catalogs;
- every redirect has a page that forwards, to a place in the map;
- every search entry belongs to a tab of the personal map.

## Layout

- Desktop: the sidebar shows the groups as headings, then their tabs. Under 52 rem
  of content width the tabs run in one strip and the headings disappear.
- Phone: `/settings/menu` is the grouped list (the same groups; each row at least
  44 px tall) with the line to the firm's settings above it. A personal section opens
  with a back button. The firm's settings have no list: the heading
  «Ajustes del despacho · \<nombre\>» and the strip of tabs are always on screen.
- The line at the top of Ajustes («Estos ajustes son tuyos. Lo de tu despacho está en
  Ajustes del despacho →») appears when the person belongs to a firm. The firm's
  frame has the mirror line («Estos ajustes son de \<nombre\>. Los tuyos están en Ajustes →»).
- The account menu in the sidebar has the entry **Ajustes del despacho** when a firm's
  space is active.
