# Beta statistics (platform administrators)

Settings > «Estadísticas de la beta» (`/settings/beta-stats`), backed by
`GET /platform/stats`. Only emails in `PLATFORM_ADMIN_EMAILS` get it (the same
check as the beta invitations); anyone else receives 403 `platform_admin_required`.
Legal basis: Aviso de Privacidad §4, finalidad 11 (version `2026-11-13.2`).

## Rules (all enforced in `backend/src/modules/platform/platform.stats.ts`)

- **Every view is audited** (`platform.stats_viewed`, insert-only `audit_events`)
  before the data is read. If the audit write fails the request fails: no access
  without its record.
- **Counts only.** No chat text, prompts, document names or keys; the queries
  select ids and dates. **No export** (no CSV, no download) and `Cache-Control: no-store`.
- **Acceptance gate.** Totals and breakdowns include everyone. The per-firm and
  per-person views list only accounts whose `terms_accepted_version` equals
  `LEGAL_VERSION`; a firm with no such member is omitted.
- **Deleted accounts** (deletion requested) are counted in «Usuarios eliminados»
  and appear as «Usuario eliminado»: no name, email, firm or profile.
- **Proportionality.** Person: name, email, firms, professional setting, title,
  jurisdiction, practice areas, counts, last activity. Firm: name, members, counts.

## Counts (last 7 / 30 days; firms and people: 30 days)

From existing tables, no new tracking and no migration:

| Count | Source |
|---|---|
| Chats | `chats` created |
| Documents uploaded | `document_versions` `upload`/`user_upload` on a `library_kind='file'` document |
| Comparisons / conversions / case-file splits | `document_versions` with source `compared` / `converted` / `split` (a split counts the documents it produced, not the operation) |
| Scan readings | `document_version_ocr` with `status='ready'`, by `requested_by` |
| Tabular reviews | `tabular_reviews` created |
| Training | `training_gym_attempts` created |

**Left out:** messages (`chat_messages` has no index by date alone, so a
windowed count is expensive; chats stand in) and the other training tables
(only gym attempts are counted). «Last activity» is the latest of the events
above inside the 30-day window, empty if there is none. A firm's counts are its
listed members' own counts, whichever workspace they worked in.
