# LiTT Project Status

> Canonical operational status for this fork. Kanban cards are execution receipts,
> not the project roadmap or source of truth. Dated history up to 2026-11-19 (deploy `20261119c`) is in
> [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md).

**Last reconciled:** 2026-11-27<br>
**Repository:** `IvanJS17/litt` (standalone since 2026-10-23; previously the GitHub fork `IvanJS17/mike`)<br>
**Upstream:** `Open-Legal-Products/mike` (fetch-only; pin and intake in [`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md))

## In production

- **Service:** <https://litt.asteroitt.com>, closed beta by invitation.
- **Deploy:** `20261127a`, tag `prod-20261127a`, `RELEASE_SHA` `a6e5ad4cc` (full SHA
  `a6e5ad4cc2b5cb8a323176dcf8077abdf65bc061`, the merge of #349). Previous deploy:
  `20261126e` (`7fc92edfc`). Among earlier deploys: `prod-20261126a` to `prod-20261126d`,
  `prod-20261119a` and `prod-20261119b`,
  `prod-20261118a` to `prod-20261118e`, and `prod-20261117a` to `prod-20261117i` (see
  [`PROJECT_STATUS_HISTORY.md`](PROJECT_STATUS_HISTORY.md)). Each deploy is tagged
  `prod-YYYYMMDDx`.
- **Contents:** every merged pull request up to #349 is in a deploy. #258 and #259 shipped in
  `20261119b` and `20261119c`. Shipped since `20261119c`:
  - `20261119e` (`27b776f7b`): #257, review notes for #249 to #253; #260, the Word add-in
    chooses a model before a chat, with a guide; #261, AI proposals of new obligation rules
    from a law text ([`obligation-rules.md`](obligation-rules.md)); #262, MCP tools for scanned
    reading and case-file split; #263, review notes for #258, #259 and #262; #264, MCP prompts,
    resources and matter and review chats; #265, status documents and an export escaping note;
    #266, a cap on heavy MCP jobs (2 per person, 4 overall); #267, review notes and rollback
    documentation.
  - `20261119f` (`2be682e76`): #268, the deploy keeps the previous image, the space check uses
    the real footprint, LibreOffice runs without a GUI; #269, trainees do not request or decide
    AI rule suggestions and proposals.
  - `20261119g` (`1c796cce0`): #270, ready playbooks linked to request types; #271, rule
    suggestions from all documents, with yes/no questions.
  - `20261119h` (`1e266ac75`): #272, review notes for #269 to #271; #273, AI tokens, engine and
    cost per call; #274, Terms and Notice of 2026-11-20 (Donna classifies with Jev); #275, every
    new request is classified by Jev and the firm's AI drafts ([`request-triage.md`](request-triage.md)).
  - `20261124a` (`462972364`): #276 and #277, the home, privacy and terms pages are indexable
    and the render assets of public pages can be fetched; #278, one trusted source for the
    client address used by rate limits; #279, the managed-account restriction holds regardless
    of the accepted legal version; #280, organization changes require the second factor; #281,
    what is read and counted before sign-in is bounded; #282, the identity service's longest
    e-mail code; #285, signing out everywhere ends connected applications; #286, a connection's
    chat turns use only what the connection holds; #287, a connector's credentials and OAuth
    sign-in are bound to its server; #288, derived copies are judged by the documents they were
    built from; #290, a tool call's audit entry names only what the call may act on; #293, model
    answers and stored text are read in linear time behind size caps; #294, integration of the
    reviewed fixes #278 to #293; #295, dependencies updated where advisories were open; #303,
    the reader's access is re-checked when stored answers, runs and training views are read;
    #304, the end of the last answer is clear of the fade above the message box; #305, playbook
    work runs on the key the person chose.
  - `20261124b` (`da2af74e0`): #306, a playbook dialog waits for the key list before it
    submits; #307, images from other sites are drawn as links in every Markdown renderer; #308,
    the assistant's playbook review runs on the conversation's key; #309, sign-in, invitation and
    confirmation flows are consistent; #310, work a connected app starts runs on the workspace's key.
  - `20261124c` (`3c056c1e2`): #312, workflow actions are pinned by commit and the load-test
    workflow's token is limited; #313, the document viewers compile WebAssembly under the page policy.
  - `20261124d` (`bc808726a`): #314, tests and written rules keep the corrections in place; #315,
    the PDF viewer reads its standard fonts from the app.
  - `20261124e` (`8a11028c1`): #316, scanned PDF pages are drawn; decoders, character maps and
    colour profile are served by the app.
  - `20261125a` (`adc92a4bb`): #311, one request has bounded memory and work in the shared
    process; #319, a Donna run takes its place before anything is sent, with a daily cap per
    person and an audit record for the switch.
  - `20261125b` (`4c3103bf4`): #317, child processes receive an allowlisted environment; #318,
    uploaded PDFs, playbook sources and web PDFs are read in the parser process; #320,
    invitations and playbook shares follow or end when an account changes its address; #321,
    closed-client follow-ups.
  - `20261125c` (`db836c373`): #323, in a firm's workspace, «delete all» removes only what the
    person could delete one item at a time.
  - `20261125d` (`f924d7baa`): #322, a running turn asks again, at each document it reads or
    creates, whether the person may; #324, Office XML is read once, forward only.
  - `20261125e` (`046c6488e`): #325, the training approach block folds while the answer is read.
  - `20261125f` (`d36871158`): #326, the firm's rules on keys, models and playbooks hold where
    the work runs; #327, work that runs on stops for an erased account, and readers are checked
    when they read; #328, one request does not hold the shared API process or the shared job queue.
  - `20261126a` (`159454459`): #330, a workflow or playbook shared by another account is
    delivered as shared.
  - `20261126b` (`18d9a8871`): #333, a poll of the job queue does not run its kind-scoped arm; #334,
    queue tests count only their own rows; #335, a citation is stored under the document it cites.
  - `20261126c` (`e78c241f6`): #329, a component's timers end with it; #331, a turn in progress
    and the training screens are read only by who can open the sources; #332, only the attempt
    that ends an upload job queues the cleanup of its objects; #336, status documents.
  - `20261126d` (`fd197fc5e`): #337, account erasure removes unfinished-upload objects, and AI
    review records are read behind the project gate; #341, upload claims are fair across
    accounts; #342, connectors ask the person before they write, by default; #339, a new upload
    is refused when the storage space is full (storage quota, part 1).
  - `20261126e` (`7fc92edfc`): #338, stored document text is read in bounded slices and searched
    within a time budget; #340, provider errors stay out of the log, with four small privacy
    and verification ports from upstream.
  - `20261127a` (`a6e5ad4cc`): #344, Word chats are judged when read, and one function decides
    which training works a reader sees; #343, anonymous password-reset and sign-up mails are
    capped per address and per hour; #345 and #346, the processes that open uploaded files run
    as their own unprivileged user, and a conversion whose PDF could not be written fails (the
    backend container now runs under an init, with three capabilities: the API and the
    readers run without root, and the init, the container's first process, stays root to
    pass the stop signal;
    [`deployment.md`](deployment.md)); #347, in invitation-only mode a recovery mail goes only
    to a finished account or a current invitation; #348, a running table generation asks, for
    each row, whether its person can still open the documents; #349, status documents.
- **Merged, not deployed** (`main` at `445f7e6ee`, 2026-11-27):
  - #351, the backup script keeps the database dump private to its account. A deploy does not
    install that script: it takes effect on a server when the operator installs it again
    ([`deploy/prod/README.md`](../deploy/prod/README.md), §7).
  - #352, a watcher's refusal that throws is contained, and the reader helpers act only for an
    accepted reader identity.
  - #353, a password set through LiTT (the invitation's password step, a recovery or Settings)
    is recorded on the account.
- **Health:** production verified after `20261127a`: the health endpoint reports that commit, the
  LiTT containers are healthy, the public pages answer, the other domains of the shared edge
  answer as before, and MCP is on (`mcp=401` without a token). The backend container runs as
  documented (init, API as `litt-api`, the reader user `litt-reader` active), and a synthetic
  `.docx` was converted to PDF inside it after the deploy. A backup was taken before the deploy.
- **Migrations:** 302 in the ledger, applied in production through
  `20261127_01_litt_training_defense_word_chat_sources.sql` (applied by `20261127a`). The runner applies every
  file the ledger does not list, in name order.
- **Access:** invitations are issued by platform administrators (`PLATFORM_ADMIN_EMAILS`).
  Beta statistics are for platform administrators only, counts only, audited
  ([`beta-stats.md`](beta-stats.md)).
- **Deploy and backup procedure:** [`deploy/prod/README.md`](../deploy/prod/README.md).

## What is on and off

| Capability | Production state | Notes |
| --- | --- | --- |
| Firm tenancy, matters, training, playbooks, document conversion and comparison | on | Layers 1 to 4. See [`training.md`](training.md), [`playbooks.md`](playbooks.md), [`document-conversion.md`](document-conversion.md), [`document-compare.md`](document-compare.md). |
| Scan reading (OCR) | on, optional | LandingAI with the person's or the firm's own key; no platform key. Also an MCP tool, `read_scanned_document`, since `20261119e` (#262). [`document-ocr.md`](document-ocr.md), [`mcp-server.md`](mcp-server.md) |
| Split a case file | on | Layer 7. A browser run with a real case file is not done. Also MCP tools `propose_case_file_split` and `create_split_documents` since `20261119e` (#262). [`document-split.md`](document-split.md), [`mcp-server.md`](mcp-server.md) |
| Citation support check (TypeSafe Jev, silent) | on (`LITT_CITATION_CHECK=enabled`) | Web chat, project chats, Word cloud chat, tabular cells and tabular chat, playbook drafts. Each person can opt out. The lawyer sees no result. Legal wording for cells and drafts is not yet confirmed (TD-047). [`citation-support-check.md`](citation-support-check.md) |
| Client profile (with assisted extraction and batch review), matter requests, deadline radar, obligation rules, retainer report | on (no flag) | Client profile and radar since the 2026-11-16 release; assisted extraction, obligation rules and retainer report in `20261117d`; batch review of proposed facts in `20261118c` (#251). AI rule suggestions since `20261119b` (#258), new-rule proposals from a law text since `20261119e` (#261), and suggestions from all documents with yes/no questions since `20261119g` (#271). [`client-profile.md`](client-profile.md), [`matter-requests.md`](matter-requests.md), [`deadline-radar.md`](deadline-radar.md), [`obligation-rules.md`](obligation-rules.md), [`retainer-report.md`](retainer-report.md) |
| Request triage (Donna triage) | on (no flag) | Jev classifies each new request and the firm's AI drafts, since `20261119h` (#275); playbooks linked to request types since `20261119g` (#270); a daily cap per person and the run reservation since `20261125a` (#319). Per-project switch `donna_enabled`, on by default. [`request-triage.md`](request-triage.md) |
| Model choice before a chat; model and reasoning guide in the selector | on (no flag) | Since `20261117g` (#240). The guide is checked against the providers' official model pages. Anthropic liveness, the previous-model notice and GLM reasoning levels since `20261117h` (#242). The Word add-in chooses a model before a chat since `20261119e` (#260). The Fable 5.2 entry is under owner review (see open items). |
| OpenRouter streams with long pauses | on | `STREAM_CHUNK_TIMEOUT_MS=180000` in production since `20261117f` (#238). |
| Firm profile, settings map, managed accounts, text size, Light/Dark/Auto theme | on | [`firm-profile.md`](firm-profile.md), [`settings-map.md`](settings-map.md), [`managed-accounts.md`](managed-accounts.md), [`design-system.md`](design-system.md) |
| Notion and Airtable connectors (per person and per workspace) | on | Suggested one-click MCP presets. No firm-shared connector. [`connectors.md`](connectors.md) |
| LiTT MCP server (`/mcp`, OAuth) | **on** (`LITT_MCP_SERVER=enabled`, since 2026-11-17, release `20261117c`) | Host `https://mcp.litt.asteroitt.com`. Tools `create_matter` and `create_note_document` since `20261118c` (#250); the server icon is in `initialize`. Layer 2a (workflows, quick actions, compare, convert) since `20261119c` (#259); layer 2b (scanned reading and case-file split) and layer 2c (prompts, resources, matter and review chats) since `20261119e` (#262, #264); the cap on heavy jobs since `20261119e` (#266). Live checks pass: AS metadata (PKCE S256, CIMD), protected resource metadata, `401` with `resource_metadata` without a token, dynamic registration `201`, authorize `302` to the consent page, bad token `400`, other paths `404`. Registration first failed with `42501` (missing `service_role` grants), fixed by PR #229. **Real Claude/ChatGPT test pending** (owner account, login and a tool call not yet run). [`mcp-server.md`](mcp-server.md) |
| Chat subagents, web search | on (compose default `enabled`) | [`subagents.md`](subagents.md), [`web-search.md`](web-search.md) |
| Account links (sign-up confirmation, e-mail change, password recovery) | on | Work in any browser since `20261118a` (#247) and `20261118c` (#249). |
| Connected apps (Settings) | on | Redesigned in `20261118d` (#252); review notes in `20261118e` (#254). |
| Public landing | on | Formación (layers 1 to 4, including the gym) and the guides inside the app since `20261118e` (#253). The home, privacy and terms pages are indexable and the other pages are noindex since `20261124a` (#276, #277). |
| Google Drive, Gmail, Calendar | **off** | No Google OAuth client exists; the owner postponed Google work. [`google-workspace.md`](google-workspace.md) |
| Microsoft 365 and Dropbox connectors | not built | Announced as in design. No code. |

The repository defaults are `disabled` for `LITT_CITATION_CHECK` and `LITT_MCP_SERVER`
in `deploy/prod/.env.example` and `deploy/prod/compose.yaml`; production sets them
through its own `.env`.

## Open items

The authoritative list is [`TECHNICAL_DEBT.md`](TECHNICAL_DEBT.md) (debt with exit
criteria) and [`followups.md`](followups.md) (technical follow-ups). The ones that
matter now:

- Owner confirmation of the legal wording that covers citation checks on tabular
  cells and playbook drafts (TD-047). Those checks are already live.
- Real end-to-end test of the MCP server with Claude and ChatGPT, run by the owner
  (`LITT_MCP_SERVER=enabled` since 2026-11-17, host `https://mcp.litt.asteroitt.com`):
  login and a tool call not yet run. Mode B's run record does not name the reviewed version (TD-049).
- Legal sources through MCP (experimental, not started): adapt the deferred upstream Legal
  Data Hunter mechanism, with ContextLex MX as the first source. Legal Data Hunter itself
  comes later on the same mechanism.
- Model guide: the Fable 5.2 entry is still under owner review and the correction is open.
  The verified contents of `20261117h` and `20261117i` do not include a change to it.
- Small follow-up: the latent `waitFor` pattern at `WorkspaceContext.test.tsx:433`.
- PostgREST memory grows slowly; contained by a 256 MiB limit with no swap. Re-measure
  by 2026-11-22 (TD-048).
- Picomatch dev-only allowlist (GHSA-fc5q-39xc-vjpf, `scripts/audit-allowlist.json`): review
  by 2026-12-17; remove when a picomatch release above 4.0.7 resolves the chains.
- Flaky backend and frontend tests seen in CI on 2026-11-14 (TD-050): the root fixes are in
  #245; the ledger row stays open until the CI runs confirm them.
- Dependabot pull requests open and not merged: #296 to #302. #207, #235, #236 and #237 are
  closed without a merge.
- Open pull requests that passed review and wait for the owner: #329, "a component's timers
  end with it"; #331, "a turn in progress and the training screens are read only by who can
  open the sources"; #332, "only the attempt that ends an upload job queues the cleanup of its objects".
- Connector icon in Claude's connector list: it comes from the root domain's favicon, and
  `asteroitt.com` has none there, so a letter is shown. Open.
- Google: create the OAuth client and verify scopes before enabling any Google service.
- Not run yet: a browser flow of «Separar expediente» with a real case file.
- Owner-only checks: real iPhone test of the mobile menu; Word add-in install on
  Microsoft 365.
- Owner or legal decisions: legal review of the English names of the obligation rules; the
  1,400-character context cap of the citation check ([`citation-support-check.md`](citation-support-check.md)).

## Governance

Release gates: [`RELEASE_GATES.md`](RELEASE_GATES.md). Upstream rules and pin:
[`UPSTREAM_POLICY.md`](UPSTREAM_POLICY.md). Upstream cycle 13 (PR #234) is merged and deployed
in `20261117e`; Legal Data Hunter is deferred. The next weekly intake is Monday 2026-11-23,
09:00 (America/Mexico_City). Update this file when integration or production state changes.
