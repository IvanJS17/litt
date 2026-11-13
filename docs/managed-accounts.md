# Firm-managed accounts («Cuentas administradas por el despacho»)

A firm pays for LiTT for its lawyers and turns off their own keys. Without this
setting a lawyer could still put keys in the personal workspace, use the firm's
LiTT for personal matters, or move firm content out to it.

**Owner decision.** With the setting on, the accounts the firm invited **and
that were created by that invitation** have no personal workspace: they see only
the firm's workspace and use its keys. A lawyer who already had an account
before the invitation keeps the personal workspace.

## The rule

An account is managed while **all** of these hold, read live on every request
(`backend/src/lib/managedAccounts.ts`); nothing is copied or cached:

1. `user_profiles.created_by_org_id` names a firm (the firm whose invitation
   created the account). Set once, by the backend, only when the invitation
   made the account (`inviteUserByEmail` in `lib/inviteEmail.ts`, and
   closed-beta sign-up on a firm's invitation in `auth.routes.ts`). Both require
   an account created in the last two minutes, so an account that existed before
   the invitation stays `NULL`. The platform's own invitations set nothing.
2. That firm has `organizations.managed_accounts = true` and is not deleted.
3. The person is still an active member of that firm.
4. The person has accepted the current legal version
   (`terms_accepted_version = LEGAL_VERSION`). Before that, `termsRequired`
   keeps them out of the app and the mode does not apply; the version is
   registered by `modules/user/user.profile.storage.ts`.

Consequences, by construction:

- **Leaving the firm** (removal, departure, deleted firm) ends it: the account
  is a normal one again and the personal workspace comes back.
- **Turning the setting off** returns the personal workspace too, on the next
  request, to open sessions as well.
- **Turning it on deletes nothing.** Personal content stays where it is and
  cannot be opened while the account is managed. Nothing moves to the firm.
- The setting is changed by the firm's **owners and admins** (the rule of
  `allow_personal_api_keys`), with the second factor if enrolled
  (`PUT /orgs/:orgId/managed-accounts {managed_accounts: boolean}`). It is
  audited, insert-only: `org.managed_accounts.enabled` / `.disabled`.
- Neither column can be written from a client: `user_profiles` and
  `organizations` are revoked from `anon` and `authenticated`, and nothing is
  granted back (`__tests__/managedAccounts.schema.test.ts`).

## Enforcement (server)

`requireAuth` evaluates the rule once per request (an account with no creating
firm costs no extra query) and binds it to the request
(`res.locals.personalWorkspaceDisabled` and an `AsyncLocalStorage` principal).
The seams that open or file personal content then answer
**403 `personal_workspace_disabled`** (the error is mapped in
`middleware/internalErrorResponse.ts`):

| Seam | Covers |
|---|---|
| `organizationOrPersonal` (`lib/workspace.ts`) | `/user/memory`, `/user/mcp-connectors` and the `/models/*` catalogs, where no `?workspace=` means Personal: refused as `?workspace=personal` is |
| `resolveWorkspaceFilter` (`lib/workspace.ts`), `?workspace=personal` | list/overview routes of projects, chats, tabular reviews, workflows, library, memory, models, quick actions, playbooks |
| `resolveStandaloneOrgId`, `resolveContentOrgId` (`lib/access.ts`) | creating a chat, tabular review, upload or copy with no organization; filing under a personal project; moving or copying firm content to personal |
| `checkProjectAccess`, `checkWorkflowAccess`, `ensureDocAccess`, `ensureReviewAccess`, `ensureChatAccess` (and the batch checkers) | opening any personal project, document, review, chat, workflow (also through `/projects/:id/...`, `/documents/...`, `/tabular-review/...`, `/chat/...` routes) |
| `createProject`, `createWorkflow`, `creationScope` (playbooks), library folders | creating personal projects, workflows, playbooks, library folders |
| `playbookRole` | opening a personal playbook |
| provider key store | personal keys are never read (`getUserApiKeys`, status, chat route credentials) and never saved or switched on (`user.apiKeys.ts`), even where the firm lets members bring their own. Brave, Tavily and LandingAI keys live in the same store. |

Moving firm content to personal was already refused (`workspace_mismatch`; a
firm's content stays in its firm); the filing seams above add the 403.

**Data rights stay open.** Download («Descargar mis datos») and bulk delete run
under `ownDataRightsScope` and, like the export and account-erasure jobs, outside
any request scope, so a managed person still downloads the personal content they
can no longer open (Settings > Privacy & Data shows the personal workspace's
export for managed accounts) and can delete the account.

## Notices

- **Invitation:** `GET /user/invitations` adds `managed_account: true` when
  accepting makes a managed account. `ManagedAccountNotice` (keys
  `managedAccount.title/body/termsLink`) is the component to mount on that
  screen, before Accept.
- **Turned on later:** `/user/profile` carries `personalWorkspaceDisabled`,
  `managedByFirmName` and `managedNoticePending`; `ManagedAccountBanner`
  (`managedAccount.nowManaged`) shows until closed
  (`POST /user/managed-notice/dismiss`, stored in
  `user_profiles.managed_notice_seen_org_id`). Accepting the invitation marks it
  seen only if the firm had the setting on at that moment (the invitation screen
  showed the notice); a person who accepted while it was off still sees the
  banner once it is turned on. No email.
- **Screens:** `WorkspaceContext` drops Personal and enters the firm's workspace
  (one place); the switcher, personal keys page and onboarding key texts are
  hidden for managed accounts.

## Not covered

- Lists that ask for no `workspace` (the old «all workspaces» form) still list
  the person's own personal items by title; opening any of them is refused.
  The app always sends `workspace`.
- Work already running or queued when the setting is switched on finishes under
  the authority it had (jobs have no request scope).
- A person invited before this feature, whose account was created by an
  invitation, has `created_by_org_id = NULL` and is not managed.
