## Summary

<!-- What does this PR do, in one or two sentences? -->

## Why / Motivation

<!-- What problem does this solve? Why now, and why this approach?
     Link the issue or context that prompted it. -->

## Changes

<!-- The notable changes, at a high level. Describe the outcome, not the diff. -->

## Tradeoffs & risks

<!-- What did you weigh? What could break, what's out of scope, and what
     follow-ups (if any) does this leave behind? Note any security or
     migration implications. -->

## How verified

<!-- How do you know this works? Tests added/run, manual steps, commands,
     screenshots. Include the exact commands where relevant. -->

## LiTT invariants

<!-- Mark each item, or write "n/a" with the reason. See AGENTS.md, "LiTT fork". -->

- [ ] Tenancy and RLS: new queries and mutations check organization, workspace and matter access; new tables have RLS.
- [ ] BYOK: provider, model and key come from the user's own configuration, with no silent fallback to another key or model.
- [ ] Audit: audit and AI evidence records stay insert-only (no update or delete path).
- [ ] No telemetry: nothing is sent to a third party.
- [ ] i18n: user-facing text is in the es-MX catalog (and en-US).
- [ ] Migrations: `backend/migrations/` file named per AGENTS.md, with `backend/schema.sql` and the `schema_migrations` list updated in the same change.
- [ ] Legal texts in `frontend/src/content/legal/` are unchanged, or the owner approved the change.
- [ ] Second factor: a route whose own path names a firm's members, roles, invitations, owners or settings requires `requireMfaIfEnrolled`.
- [ ] Derived copies: a new reader of content computed from documents checks, when it is read, that the reader can open the sources now, with `keepReadableDerived`.
- [ ] Untrusted text: text from a model or a provider is size-bounded (`backend/src/lib/modelJsonFence.ts`) and uploaded file content is parsed in the isolated process, with no super-linear expression.
- [ ] Connected apps: a new MCP tool declares its `scope` and `lane` (write lane if it writes or spends a key).
- [ ] Public text: commit messages, PR text, comments and tests say what behaviour is wanted, not how a weakness is used.
- [ ] Tests: a regression test at the lowest useful layer, and the commands are listed under "How verified".

## Checklist

- [ ] Ran the relevant build/test command for the area changed.
- [ ] Reviewed `git diff` and removed unrelated changes.
- [ ] Updated docs / env examples if setup, config, or behavior changed.
- [ ] No secrets, API keys, real documents, or `.env` files committed.
