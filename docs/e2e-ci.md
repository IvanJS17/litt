# End-to-end tests in CI

The Playwright suite (`e2e/`) runs on every pull request through
`.github/workflows/e2e.yml`. This document covers its local test services and the **branch-protection step that turns a red run into a blocked
merge** — the workflow reports pass/fail on its own, but only branch protection
makes that check *required*.

## What the workflow does

On every `pull_request` that changes more than documentation (including
stacked PRs targeting another feature branch), on manual `workflow_dispatch`,
and **weekly on Mondays at 03:47 UTC** (a `schedule` cron, so drift that lands
between PRs — dependency bumps, Supabase CLI changes, selector-breaking UI
tweaks — still surfaces), the single `e2e / playwright` job:

1. installs the root (Playwright), `backend/`, and `frontend/` dependencies;
2. boots **RustFS** (S3-compatible object storage — several specs upload
   documents), pinned by image digest;
3. boots **local Supabase** (Auth + Postgres) via the Supabase CLI and loads the
   current fresh-install shape from `backend/schema.sql`. It intentionally does
   not replay historical migrations on top: doing so can replace current
   functions with older definitions. The separate schema-drift workflow proves
   that the supported upgrade path (its pinned baseline plus later migrations)
   converges with this fresh-install path;
4. writes `backend/.env` and `frontend/.env.local` from the live Supabase values;
5. builds the backend and runs the pinned `sync:workflows` release job, matching
   production ordering so the default and add-on catalog exists before startup;
6. serves the production build (`next build` / `next start`) with the backend
   API (`:3001`) and web server (`:3000`) on isolated disposable services;
7. runs `npx playwright test --project=chromium` on three parallel workers,
   then the `synthetic` project on two workers against the same web server,
   and uploads the HTML report + traces as the **`playwright-report`**
   artifact on pass, fail, or timeout.

Documentation-only changes (`docs/**` and root `*.md`) skip the suite;
`docs/playbooks/**` still runs it because it seeds the workflow catalog. A newer
push to the same PR cancels the superseded run; scheduled and dispatched runs
are never cancelled. These limits keep Actions usage down (TD-024 in
`docs/TECHNICAL_DEBT.md`).

### Test users and parallel workers

Each Playwright worker signs in as its **own** user, following Playwright's
[one account per parallel worker](https://playwright.dev/docs/auth#moderate-one-account-per-parallel-worker)
pattern. Worker 0 is the historical `e2e@mike.local` (or `E2E_EMAIL` /
`E2E_PASSWORD`); worker *n* is `e2e-wn@mike.local` with the same password
(`workerAccount()` in `e2e/users.ts`). The worker-scoped fixture in
`e2e/fixtures.ts` creates the account through the local Supabase admin API,
signs in once, finishes onboarding and reuses the session for every test in
that worker. Separate users have separate project, chat and workflow lists and
separate sessions, so workers can't race on each other's data. Tests inside a
file still run in order. `e2e/auth.setup.ts` only creates the dedicated logout
user, whose global sign-out must never revoke a shared session. No login secret
is needed.

`E2E_WORKERS` sets the worker count (CI sets 3; the default is 1, because
`next dev` compiles routes on demand). A spec that needs a specific user's
details takes the `e2eAccount` fixture instead of hardcoding an email.

### Synthetic specs

`e2e/assistant-streaming.spec.ts` and `e2e/tabular-chat-lifecycle.spec.ts` form
the Playwright **`synthetic`** project. They mock every `/api` call in the
browser and need no backend, database, account or model-provider key. The
streaming tests are slow by design (4x CPU throttling and hundreds of SSE
chunks, up to two minutes each). Upstream runs them on three extra runners
split by chat scope, each repeating the installs and the web build; LiTT runs
them as a second step of the `e2e / playwright` job instead, on two workers
against the production web server that job already started, so they add test
time but no extra runner. See [frontend-testing.md](frontend-testing.md#assistant-streaming-regressions)
for a standalone local command.

The full-stack chat flows use a local Anthropic-protocol fixture in CI. No paid
model key or repository secret is required, including on fork PRs. A missing
fixture key fails test discovery instead of silently skipping chat coverage.

### No development-stress jobs

Upstream also runs the suites against React's development renderer (nightly,
on pushes to `main` and on PRs labelled `stress`). LiTT does not adopt those
jobs or their nightly crons: they cost about an hour of runner time per run
for coverage the production suites already provide (TD-024). The
`REACT_STRESS=1` and `WORD_E2E_DEVELOPMENT=1` modes remain available for a
local run.

## Accessibility scans

`e2e/accessibility.spec.ts` runs an [axe-core](https://github.com/dequelabs/axe-core)
scan (via `@axe-core/playwright`) over the core pages: `/login` (pre-auth),
`/assistant`, `/projects`, and `/tabular-reviews`. The policy is two-tier:
**`critical`-impact violations fail the build**; `serious`-impact violations are
printed to the test output but do not fail — enforce at critical first, then
ratchet `serious` into the failing tier (`BLOCKING_IMPACTS` in the spec) once
that backlog is cleared. The scans need no LLM key and run on every trigger.

## Failure artifacts

The suite retries failed specs up to twice on CI and records a **trace** on
the first retry. On pass, fail, or timeout, the job uploads
`playwright-report/`, `test-results/`, the web-server log and the
model-fixture log as **`playwright-report`** (14-day retention).
From the failed run's page in the Actions tab, download its artifact, then
`npx playwright show-report playwright-report` locally to see per-spec results,
screenshots, and step-by-step traces of what the browser did.

## Deterministic model provider

The workflow starts `e2e/anthropic-stub.mjs` on loopback port 4141 and sets
`ANTHROPIC_BASE_URL=http://127.0.0.1:4141/v1` plus a dummy API key. The installed
Anthropic SDK supports this endpoint override. Browser requests still traverse
the real web gateway, authentication, backend, database, document storage, and
assistant streaming code; only the external model response is a fixture.

Two browser flows cover the real application with only the external provider
replaced:

- **Chat lifecycle:** send a unique phrase through the provider, wait for the
  completed answer, reload it, rename the chat and reload, then delete it and
  verify a fresh history request returns 404. Optimistic UI changes alone do
  not pass.
- **Project document:** create a project, upload the PDF, open the empty composer
  and send a question. The provider fixture selects the advertised document,
  requests `read_document`, and echoes the actual tool result. The browser
  requires text found only inside the PDF and verifies the saved answer after
  reload. Missing context, broken tool dispatch or failed extraction cannot
  produce the expected answer.

These replace the overlapping rename, delete, missing-chat “cold load” and
submit-only project checks; they do not add more browser scenarios. The fixture
also supplies a short non-streaming title. Three small checks exercise its JSON,
text stream and tool round trip through the installed backend SDK before startup.
Unknown streamed prompts and missing document/tool context fail explicitly.

### Choosing the test boundary

Start with a concrete failure the test must catch. Keep the code responsible
for that behavior real, and use the lowest layer that observes the outcome.
For these flows, auth, database persistence, storage, extraction, tool dispatch
and browser rendering stay real. Only the external model is scripted. The
existing synthetic browser tests deliberately isolate rendering and timing;
they do not establish backend correctness.

A fixture cannot establish that Anthropic accepts the real request, that a real
model chooses the right tool, or that its answer is accurate. Those questions
need live-provider smoke checks and representative document evaluations with
expected facts and citations. A real-key local run is available below; this
workflow does not provide an automated live-model quality gate. The SDK checks
prove fixture compatibility with the installed client, not provider fidelity.
When reviewing a test, identify a plausible broken implementation that would
fail it. Prefer strengthening or replacing an existing test over adding another
scenario that observes the same behavior.

The shared `selectClaudeModel` helper selects a supported Anthropic model before
each chat submission. Keep its model label synchronized with the model catalog.
Check the **Run Playwright** summary and uploaded report for passing tests with
no unexpected skips; do not rely on a green job that omitted chat coverage.

For a local run with the same fixture, start `node e2e/anthropic-stub.mjs` and
export both variables above (use `ANTHROPIC_API_KEY=e2e-local-key`) before starting
the backend and Playwright. Local runs can instead use a live Anthropic key with
no endpoint override. Local runs without either configuration skip the chat
flows; CI rejects that incomplete configuration.

## Make it merge-blocking

The workflow failing is not enough on its own — GitHub will still allow the merge
unless the check is **required**. Enable branch protection once you have seen the
suite go green a few times (it is environment-sensitive by nature):

1. **Settings → Branches → Add branch protection rule** (or edit the rule for
   `main`).
2. Enable **Require status checks to pass before merging**.
3. Enable **Require branches to be up to date before merging**.
4. In the checks search box add **`e2e / playwright`** and
   **`Word add-in / Typecheck and Playwright (chromium + webkit)`**. Jobs appear
   in the list after they have run at least once on a PR. Both workflows are
   path-filtered (documentation-only PRs skip e2e; the add-in check runs only
   when `word-addin/`, the shared UI it bundles, `packages/` or its workflow
   change). A required check whose workflow a path filter skipped never
   reports and leaves the merge pending, so require them only if that
   trade-off is acceptable for docs-only PRs.
5. Keep the existing unit/build, security and `license/cla` requirements.
6. Save. From now on a red e2e run blocks the **Merge** button.

This PR adds workflow checks; it does not edit repository protection settings.
When configuring them through an API, first read and preserve the existing
requirements and use the exact check contexts reported by the repository.

## Running the suite locally

Locally, `playwright.config.ts` starts the backend and web dev servers for you
(`webServer` is only disabled when `CI=true`), so a full local stack plus:

```bash
npm ci
npx playwright install --with-deps chromium
npm run test:e2e            # or test:e2e:ui / test:e2e:headed
```

`e2e/auth.setup.ts` reads `SUPABASE_URL` / `SUPABASE_SECRET_KEY` from the
environment or `backend/.env`, so a running local Supabase + a populated
`backend/.env` is all the setup needs.
