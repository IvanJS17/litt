# Firm profile

A short, optional description of the firm (not of people) that the assistant reads
in every chat of the firm's workspace, so answers fit its jurisdiction and practice.

## Data

Stored in `organizations.firm_profile` (jsonb, migration `20261113_30`). Every field
is optional; an empty profile is `NULL`.

| Field | Values |
| --- | --- |
| `hq_state`, `other_states` | Mexican state codes (`JAL`, `NLE`, `CMX`, ...) |
| `hq_city` | text, up to 80 characters |
| `size` | `1`, `2-5`, `6-20`, `21-50`, `51+` (lawyers) |
| `practice_areas` | up to 12 items of 60 characters; Formación offers them as the subjects of a stage (see [`training.md`](training.md#settings)) |
| `client_type` | `individuals`, `companies`, `public_sector`, `mixed` |
| `industries` | up to 8 items of 60 characters |
| `brief_language` | `es-MX` (default) or `en-US` |
| `description` | free text, up to 1,000 characters |

The whole value is capped at 6,000 bytes, checked by the server
(`firm_profile_too_large`) and by a database constraint. Code: `backend/src/lib/firmProfile.ts`,
`firmProfileStore.ts`, `backend/src/modules/orgs/orgs.firmProfile.ts`.

## Permissions

- `GET /orgs/:orgId/profile`: any member (read only; the response says `can_manage`).
- `PUT /orgs/:orgId/profile`: owners and admins, with MFA when enrolled. `null` clears it.
- Each write is audited as `org.profile.updated` with the **names** of the changed
  fields only, never their values.
- UI: Firm settings, `OrganizationFirmProfile.tsx`.

## Where it enters the context

`buildFirmProfilePrompt` (`backend/src/modules/chat/engine/contextBuilders.ts`) adds a
short `FIRM PROFILE` block (fenced data, only filled fields) to the assistant chat,
project chat and tabular-review chat of **that chat's own organization**. Personal
spaces get nothing (`loadFirmProfileFor` returns `null`). The Word chat is
personal-only and is unchanged. Only the model context text changes, not the model,
key or route.

## Legal conditions (socium-legal, t_b95634eb)

The current Privacy Notice (§§2b, 6, 13) and Terms (6.2, 9) already cover the
profile as Content the firm writes, so `LEGAL_VERSION` did not change. That holds
only while:

1. The model receives **only the profile fields**: no name or email of the editor,
   no edit date or author.
2. It is sent **only in chats of that firm's workspace**: not in the personal space
   and not in another firm's chats of the same person.
3. It is **not used in beta statistics**. Using these fields there needs a text
   change and a version bump first.
4. Because subagents and other chat routes may use another provider, `help` uses
   the plural wording («a los proveedores de IA que use ese chat»).

Help texts: `orgSettings.profile.help` (under the title) and
`orgSettings.profile.freeTextWarning` (next to the description, always visible,
never a tooltip), in es-MX and en-US.
