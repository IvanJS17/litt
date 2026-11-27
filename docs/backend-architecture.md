# Backend architecture

The Express backend in `backend/` is organized as **domain modules over a
shared kernel, with application services for cross-domain workflows**. This page is the reference for that layout: what goes where,
the rules that keep the layers honest, and the test that enforces them.

```
backend/src/
├── app.ts                 Express app: middleware, rate limits, mounts one router per module
├── index.ts               HTTP entrypoint
├── workerRuntime.ts       queue workers entrypoint (imports modules through facades)
├── middleware/            request plumbing (auth, trusted origin) — depends on lib/ only
├── modules/<domain>/      one directory per HTTP surface (see "Module anatomy")
├── application/           account, purge and export orchestration; called by entrypoints
├── lib/                   shared kernel: infrastructure + cross-domain primitives
├── workers/, jobs/        queue consumers and scheduled jobs — reach modules via facades
└── __tests__/             cross-cutting suites, incl. architecture.test.ts
```

## Module anatomy

Every directory under `src/modules/` follows the same shape:

| File | Role |
|---|---|
| `<name>.routes.ts` | **HTTP layer.** Parses params/query/body, calls service functions, maps their typed results onto status codes and JSON. Never queries the database. |
| `<name>.service.ts` | **Facade.** The module's public surface: named re-exports of the functions other code may call. Exactly one per module. Small modules put the implementation here directly. |
| `<name>.<topic>.ts` | **Service topic files** (large modules only). Business logic and data access for one topic: `documents.versions.ts`, `user.profile.ts`, `tabular.chats.ts`… Take an explicit `db: Db`, return typed results, never touch `req`/`res`. |
| `<name>.shared.ts` | Types and helpers shared by the module's topic files. Not exported through the facade, except by explicit named re-exports of what other modules need (`client-profile.service.ts` re-exports `cleanText`, `isRecord` and the shared error codes; never `export *`). |
| `__tests__/` | Unit tests for the service functions (fake `db`), colocated with the code. |

Streaming endpoints are the one place HTTP leaks into the module body: SSE
loops (header flush, LLM stream, stop handling, assistant-message
persistence) stay in the routes file because stream lifetime *is* an HTTP
concern. Only their pre-stream preparation and post-stream persistence live in
the service. The exception is `POST /chat`, whose turn already lives outside
the routes file (see "The chat turn and its sink" below).
`tabular.generateStream.ts` is the single sanctioned exception
that takes `res` directly, because two routes share its *async* stream; its
header says so. Its synchronous half takes a `write` function instead — that
generation is a server-owned run, so the frames belong to the run, not to one
response.

### Server-owned runs

A *run* (`lib/streamRuns.ts`) is a generation the server owns rather than the
HTTP response that asked for it. The route registers one, writes frames into
it, and any number of responses attach: the original request, a reload, a
second tab. `write` appends to the run's frame buffer and fans out to every
attached response, `signal` aborts only on an explicit stop, and closing a
response merely detaches it. Each frame carries an SSE `id:` line with its
sequence number, which is what a client sends back as `from` when it
reconnects. A frame written with `{ replay: () => …}` still fans out live but
is replayed to a late subscriber only while the predicate holds. A run is
registered under a `key` — what may only have one run at a time — and carries
an opaque `meta` for the surface that owns it.

An SSE **comment** line (`: tool-wait`) written through `write` fans out live
but is never buffered or numbered: it is a keep-alive, so replaying it to a
late subscriber would be noise and would move every real frame's sequence
number.

Every streaming surface uses it.

The backend is one process shared by every user, so memory held for one
request is bounded where it is held:

- What the model library reports of one call (answer text, reasoning and
  streamed tool arguments, whether or not it becomes frames) counts against
  32 MiB (`MAX_RUN_BUFFERED_BYTES`, counted in `streamAiSdk`); past it the
  provider request is aborted and the turn ends with an error. The count is
  per call, so a turn with sub-agents may hold several calls' worth. Bytes the
  library buffers without reporting are counted only for an endpoint the
  person configured (see below). A run also keeps at most 32 MiB of buffered
  frames, each counted with 128 bytes of overhead (`FRAME_OVERHEAD_BYTES`). A
  frame written with a `slot` replaces the previous frame of that slot, so
  only the newest citation snapshot is held and replayed. Past the limit the
  run is aborted, its buffer is released and readers get one error and
  `[DONE]`. A person holds at most 8 unfinished runs (`MAX_LIVE_RUNS_PER_USER`);
  the ninth is refused with HTTP 429 and the `rate_limited` code.
- Responses from user-chosen servers are read under a decoded-size limit,
  however small they were on the wire: 8 MiB for MCP and OAuth servers
  (`MAX_MCP_RESPONSE_BYTES`, passed to `guardedFetch` as `maxResponseBytes`)
  and 1 MiB for an OpenAI-compatible endpoint's model list. A connector answer
  over the limit fails the call with a message that says so. OAuth requests
  also carry a deadline. For the OpenAI-compatible endpoint a person
  configures, the limit is chosen from what the request asked for, never from
  what the server says its answer is. An answer to a non-streaming call, and
  an error answer to any call (streamed or not), is read up to 8 MiB, and a
  non-streaming call must finish within two minutes. Only a successful answer
  to a streamed call is read up to three times the 32 MiB run ceiling in
  total, a margin over the framing and escaping around the text, with no
  single event line over 8 MiB. Past a limit on a successful answer the
  provider request is aborted and the turn ends with the same output-limit
  error as above. An error answer over 8 MiB is a failed provider call. For a
  rate limit (429) or a server failure (5xx) the model library retries it, and
  each try is cut at the same 8 MiB; any other error status is tried once. The
  turn ends as a provider failure, not with the output-limit error. The
  other providers talk to the vendors' own hosts (or, for Azure, a host on
  Azure's own domains) or to a deployment-configured one, and are not read
  under these limits.
- A model that writes its tool calls as text (an operator-declared local model)
  has its whole reply read for them by `lib/llm/toolCallParsing.ts`, which scans
  a reply of at most `MODEL_TEXT_MAX_CHARS` in time proportional to its size, and
  every name or attribute it reads has a length bound. A longer reply is not
  scanned: it is plain text, except that one which opens a tool call ends the
  step with an error, as a call that cannot be read does. A damaged argument
  is repaired by `lib/boundedJsonRepair.ts`, the only place that calls the
  repair library: a text over its size limit is refused, every repair runs
  under a deadline that stops the library when it takes too long, and all the
  repairs in one reply share a single time budget (one second), from which
  the time of each is taken. A repair that is refused for its size or its time
  ends the step with an error, and no call from that reply runs; text that is simply not JSON stays a plain
  string value. Searches that no regular-expression
  check can see (loops of `indexOf`) are guarded by
  `lib/__tests__/toolCallParsing.growth.test.ts`: every marker the reader
  recognises must be added to its table. A shape that grows faster than its
  text is confirmed on a larger text before it fails.
- The queued documents ZIP export reads each stored object as a stream with
  the store's per-step time limit, writes the archive to a temporary file and
  uploads it from there. It takes at most 500 documents
  (`MAX_ZIP_EXPORT_DOCUMENTS`) and keeps the direct download's 2 GB limit. An error or stall while reading any object, or an object
  larger than its limit, ends the job through its normal failure path, and the
  file is removed when the job ends, whether it succeeded or failed. A
  directory left by a process that died mid-export (its name starts with
  `mike-export-`) is removed the next time a process that runs background work
  starts, once nothing has been written to it for ten minutes.
- `GET /single-documents/:id/display` streams stored objects with a
  `Content-Length` and the store's `ETag` (a matching `If-None-Match` is
  answered 304 without reading the object, `HEAD` reads nothing, and an object
  whose size changed while it was sent breaks the download). A Word or
  presentation file with no stored PDF is converted by LibreOffice. Every
  conversion (`docxToPdf` and the upload worker's `officeFileToPdf`) goes
  through one admission point: two run at once, eight wait up to 30 seconds,
  and the rest are refused with `ExtractionBusyError`, which callers treat as
  "retry later": the display routes answer 503 with `Retry-After`, a rendition
  that cannot be stored now is queued as a conversion job, and the upload
  worker requeues the file. The counters belong to one thread, as the
  extraction slots do: the API, the jobs and the uploads threads each have
  their own. A display conversion reads a source of at most 25 MiB
  (`CONVERSION_MAX_SOURCE_BYTES` in `lib/conversionLimits.ts`, the same bound as the
  convert, compare and split routes): the stored size is read first, so a
  larger source is not downloaded and does not wait for a place, and the
  route answers 400 with the code `convert_source_too_large`. A display holds
  its source from the download, and then the converted file until its response
  closes, so at most as many displays hold one as the converter has places (ten
  per thread); the next is answered 503 with `Retry-After` without reading
  anything. A route that displays takes the
  signal it passes from `abortOnClose` (`lib/responseClosed.ts`), which is already
  aborted when the client left before the handler ran, so such a request reads
  no object bytes, converts nothing and holds no place (it still resolves
  access and may ask the store for an object's metadata), and which also
  follows the connection: a response waiting behind an earlier one on its
  connection does not close when its client leaves. `pipeToResponse` and the
  download-by-link route (`/download/:token`) use the same test and the same
  wait, and so does the progress view of a tabular review: for a client that
  has left it neither subscribes to the review's channel nor polls the
  database, while the extraction already handed to the queue goes on. A
  listener that fails when its response or its connection closes (or at once,
  when that had already happened) is reported once, through the reporting
  helper, and does not stop the others, its caller or the process. A client
  that leaves while the view's subscription or a download's read is being
  opened is not reported as a failure. A request that
  arrives while the answer to an earlier one on the same connection is still
  going out starts only in its turn (`middleware/startInTurn.ts`, the first
  middleware), so it reads nothing and holds no place while it cannot be
  answered. It starts in the context it arrived in, not in that of the request
  ahead of it, and a connection with more than 32 requests waiting is
  closed (nothing legitimate sends requests ahead of their answers).
  Nothing is written for a waiting request, so nothing else slows down
  a client that keeps sending them. A response whose client makes no progress for a minute
  (`DISPLAY_SEND_IDLE_MS`) is closed within about two, so a client that stops
  reading does not keep the file or the place; until then it holds both, and
  nothing shares the places between people. Only the response built in memory
  has this limit: a stored rendition is streamed and holds no file in memory. The converter may hold a second copy of a source
  while it works. A stored PDF
  rendition is served whatever the size of the source.

#### Chat turns

The chat and project-chat streams (`POST /chat`, `POST /projects/:id/chat`)
register a run per assistant turn through `lib/assistantTurnRuns.ts`, the
chat-shaped view of the registry (key `<surface>:<chatId>`, the assistant row
id in `meta`). `attachAssistantTurnSse(res, run)` hands back the same
`{ signal, write, finish }` the older `openAssistantSse` did.

- `GET /chat/:chatId/turn/:turnId/stream?from=<seq>` attaches to a run (a
  reload, a second tab, a dropped connection): frames with `seq >= from` are
  replayed, then the live ones follow until the run ends. Visibility on the
  chat is enough, as it is for watching the live turn. Reading the stored
  transcript (the web route, the history a connected app continues from and its
  `get_chat`/`get_chat_turn`) also asks which documents the reader can open
  now (`lib/chatReadAccess.ts` over `keepReadableDerived`): an attachment they
  cannot open is taken off the message, an answer built on a document they
  cannot open stays in its place emptied and marked `unreadable`, and what they
  typed is not touched. The marker says why: no access (for any reader), or sources that cannot
  be identified or no longer exist (the latter withholds that one answer only
  for the owner of the chat). The history a new turn continues from carries only
  what the reader can open; the summary of the previous answer's tool activity
  and its reasoning are judged on that answer's own sources, and, when the
  reader cannot open that answer, only the reader's own answers and decisions
  are replayed, as they gave them. The Word add-in's chats follow the same rule
  (the document open in Word is the add-in's own text and names no stored
  source): its transcript, its running turn, the previous turn a new one
  continues from, the account export and the training records made from a Word
  chat are served only while the reader can open what the answers drew on. A
  training work (a pupil's chat with its notes, review, defense, backing checks
  and criterion) is shown by one decision, `judgeWorks` in `lib/trainingWork.ts`:
  the matter rule and, for a Word chat, what its answers drew on; every training
  reader asks it and none keeps a rule of its own. See
  `docs/document-text-search.md` for the rule and its limits.
- `POST /chat/:chatId/turn/:turnId/stop` is the one way to cut a generation
  short; it needs the standing that sending does. The route's abort path
  then persists the partial answer marked with a `stopped` event (each client words it) and writes
  a `cancelled` frame before `[DONE]`, so attached readers learn the outcome.
- `GET /chat/:chatId` reports `active_turn` (`{ id, seq, assistant_message_id }`)
  while a run is generating, which is how a freshly loaded client knows to
  attach rather than treat the hidden reservation row as "no answer".
- A chat has at most one run at a time: a second `POST` while one is
  generating answers `409 turn_in_progress`.

#### The chat turn and its sink

`POST /chat` is a thin adapter over `modules/chat/chat.turn.ts`, which has no
`req`/`res`:

- `parseChatTurnRequest(body)` validates the body (pure; 400 on the first
  problem, in the order the route always checked).
- `startChatTurn(db, { userId, userEmail, requestId, parsed })` authorises and
  prepares the turn, registers the run (one per chat; `409 turn_in_progress`)
  and makes the assistant row durable. It returns a typed result
  (`{ ok: true, started }`, `{ ok: false, status, code?, detail }` or
  `{ ok: false, internal: true, error }`) instead of writing a response, and
  releases the turn's memory lease on every way out that does not start a turn.
- `runChatTurn(db, started, sink = started.run)` is the generation loop. It
  writes SSE frames to a `ChatTurnSink` (`id`, `signal`, `write`, `finish`,
  `touch`, `stopReason` — the shape of the turn's run), ends it exactly once,
  saves the answer before `[DONE]`, and settles the memory lease (scheduled on
  a completed answer, released otherwise). `abandonChatTurn` gives the lease
  back when a transport started a turn but could not run it.

The web route is `parse → startChatTurn → attachAssistantTurnSse(res, run) →
runChatTurn`: the response is one reader of the run, so the loop does not know
whether anyone is attached. Another transport calls the same three functions
and reads the run (`getAssistantTurnRun` + `run.subscribe`) or the persisted
message. The names are re-exported from `chat.service.ts`.

`src/__tests__/integration/chatTurn.golden.routes.test.ts` (and the
project-chat twin) record the response bytes and the ordered side effects of
a turn against committed fixtures in `src/__tests__/integration/__golden__/`;
re-record with `UPDATE_GOLDEN=1` only for an intentional wire change. Project
chat and Word chat still run their loops in their routes files.

#### Tabular review chat

`POST /tabular-review/:reviewId/chat` registers the same kind of run under the
`tabular` surface (key `tabular:<chatId>`), so the two surfaces cannot collide
on a shared id and a lookup by turn id is scoped to the surface that asked.
The endpoints mirror chat's, with the tabular access model: seeing the review
is enough to attach, and stopping needs what writing the thread needs (review
chats are creator-write).

- `GET /tabular-review/:reviewId/chats/:chatId/turn/:turnId/stream?from=<seq>`
- `POST /tabular-review/:reviewId/chats/:chatId/turn/:turnId/stop`
- `GET /tabular-review/:reviewId/chats` reports `active_turn` per row, which
  is how a panel that has just loaded knows to attach. The messages endpoint
  keeps its bare array: it is the transcript, and the running turn is not in
  it yet.
- A second `POST /chat` into the same thread answers `409 turn_in_progress`.

`prepareTabularChat` is allowed to return no chat id, and a request with no
thread to key a run on keeps the old single-socket contract — nothing could
ever attach to it.

#### Tabular review generation

`POST /tabular-review/:reviewId/generate` on the synchronous path (the
default; `ASYNC_TABULAR_EXTRACTION=true` uses BullMQ workers instead, whose
durability comes from the queue) registers a run keyed `review:<reviewId>` as
soon as it has claimed the generation lease. From then on a closed socket is a
detach: the extraction keeps filling cells, the lease stays held, and the
frames wait in the run for whoever attaches next. The pre-lease guards are
still tied to the request — nothing is claimed yet, so a caller that walks
away costs nothing.

- `GET /tabular-review/:reviewId/generate/stream?from=<seq>` attaches to the
  run when this process has one, replaying `cell_update` frames from `from`
  (replaying them is idempotent) and then tailing. With no in-process run — the
  async path, another replica, a lease with nothing attached — it falls back
  to the DB-tailing view it always was. A review *viewer* is refused, as at
  `POST /generate`.
- `POST /tabular-review/:reviewId/generate/stop` is the one way to cut a
  synchronous generation short; closing the socket no longer does it. The
  stopped cells go back to `pending` and readers get a `cancelled` frame
  before `[DONE]`. With no in-process run it answers
  `404 generation_not_found`, which is also what an async-path deployment
  answers — there the work belongs to the queue.
- `GET /tabular-review/:reviewId` reports `active_generation`
  (`{ id, seq }`) while this process is generating. That is the stronger,
  *stoppable* statement; `review.is_running` (the database lease) stays and is
  also true for an async or another replica's run.
- A second `POST /generate` while a run is still streaming answers
  `409 review_running`, handing back the lease it had just claimed.
- A synchronous run acts on its starter's authority for as long as it lasts,
  so it carries the organization's authorization epoch like a queued row job:
  read before the rows are filtered, checked before each row, before its cells
  are marked and before each result is written or streamed. When the epoch has
  moved the run stops (cells back to `pending`, readers get `cancelled`).
- A running generation also asks, for each row, whether the person it works
  for can open every source document of the row *now*: when the row's text is
  about to be loaded and again before each result is saved or streamed. The
  question is `createRowReadCheck` (`lib/tabularReadAccess.ts`, over
  `filterAccessibleDocumentIds`), a required argument of `extractRowColumns`,
  so the synchronous run, the queued row job and the single-cell job all ask
  it (the request-side single-cell regenerate asks it too). The answer for a
  row is reused for at most 5 seconds (`ACCESS_RECHECK_MS`). A row that fails
  it, or whose question cannot be answered (one warning per run, no document
  names), is left out like a row the run did not start on: its cells go back
  to `pending` and the run goes on. A queued job takes the person's address
  from their account when it runs, as other jobs that act for a person do.
  Someone watching the run's live cells (the original request, a second tab,
  the progress tail) is asked again before a frame is written when the last
  answer is older than 5 seconds; when they can no longer open the run's
  documents their stream ends and the run goes on for the others. No
  authorization epoch is involved in either question.

#### Word chat

`POST /word-chat` registers a run under the `word` surface. `chatId` always
exists by then — a cloud row's id, or the UUID `prepareWordChatStream` mints
for `storage: "local"` — so every Word turn is keyed and resumable, local
ones included.

- `GET /word-chat/:chatId/turn/:turnId/stream?document_id=<uuid>&from=<seq>`
- `POST /word-chat/:chatId/turn/:turnId/stop?document_id=<uuid>`
- `GET /word-chat/:chatId` reports `active_turn`. Note that it filters the
  reserved (still-empty) assistant row out of `messages`, so a turn in flight
  is visible ONLY as `active_turn` and a reattaching pane appends its own
  placeholder.
- A second `POST /word-chat` into the same chat answers
  `409 turn_in_progress`.

Both endpoints authorise **from the run**: `run.userId` must be the caller and
the run's `clientDocumentId` must be the `document_id` presented, otherwise
`404 turn_not_found`. A local chat is never persisted, so there is no row to
authorise against — and a cloud chat's row says nothing about which run is
live either.

Client tool calls need two things of the registry, both in `streamRuns.ts`:
the adapter's `: tool-wait` keep-alives are comments, so they fan out live and
are never buffered or numbered; and a `client_tool_call` frame is written with
`{ replay: () => isClientToolCallPending(callId) }`, so a pane that reattaches
while the call is outstanding is handed it and can answer the tool loop that
is still waiting, while a call that has been answered, timed out (60 s) or
cancelled is never replayed. Two panes attached at once would both execute a
replayed call; the first result settles the bridge and the second is dropped
by `submitClientToolResult`, but the document work has already happened twice.

Runs live in process memory. A finished run is retained for
`FINISHED_RUN_RETENTION_MS` (60 s) so a late reconnect still gets the
terminal frames. Runs stop after five minutes without useful progress or a
four-hour maximum lifetime (both configurable). Provider calls have separate
two-minute first-output and 60-second inter-output limits (production compose
sets `STREAM_CHUNK_TIMEOUT_MS` to 180 s), including waiting
for response headers. OpenRouter's SSE keep-alive comments
(`: OPENROUTER PROCESSING`) and Anthropic's `event: ping` frames (direct, Azure
Foundry and Vertex-Anthropic routes; Bedrock does not use plain SSE), which the
AI SDK parser drops, are detected by the provider's fetch wrapper
(`lib/llm/streamLiveness.ts`) and restart the running provider clock; a connection with no bytes still times out. Provider clocks stop at the end of each provider step,
so local tool execution is governed by its own timeout and the run limits.
Model output refreshes idle even while tabular JSON is buffered; transport
keep-alives do not. Deadline errors are preserved in history and replay, while
an explicit Stop remains a cancellation. Once a turn's signal fires, the tool
dispatcher starts none of the batch's remaining server tools (and no write
that was still waiting on a document lock, connector planning or a source
download), tools that already finished keep their events in the stored turn
(also when a later call of the batch rejects, or is still pending when the
model adapter ends the stream on the stop; a rejection after the stop ends
the turn as stopped),
and a chat, project-chat, Word chat or tabular chat route whose `runLLMStream` returns anyway (a
provider or tool that ignored the abort) takes its stop path: the turn is
stored with its stop
outcome, and is neither saved as a completed answer, given a fallback title,
nor scheduled for memory curation. A stop that lands while the finished answer
is being saved (or while its title is awaited) is checked again before the
fallback title and memory curation (in chat, project chat and Word chat): the
saved answer then gets only the stop label added, so it is stored once, ends with the outcome readers were
sent, and is neither given a fallback title nor curated.
Tabular chat checks again after saving the finished answer and after awaiting
its title. A stop during either step marks the already-saved row as stopped
instead of inserting it again, and skips memory curation. A stop during the
save also skips title generation; a title already being generated is retained.
A route that unwinds after the grace period
has already ended the run writes no more frames, because the run is finished.
A resume has to reach the replica
that is generating: run one replica, or route by session, until the buffer is moved
to shared storage. `lib/assistantSse.ts` (`openAssistantSse`) survives only
for the one case that cannot be a run: a tabular review chat whose
preparation produced no chat id, so there is no key to register under and
nothing that could ever attach.

### The service contract

A service function takes the database handle first (`db: Db`, exported from
`lib/supabase.ts`), then request-derived primitives, and returns a
discriminated union rather than throwing or writing a response:

```ts
export async function renameFolder(
  db: Db,
  args: { userId: string; folderId: string; name: string },
): Promise<ServiceResult<Folder>> {
  if (!args.name.trim()) return failure("validation", "name is required");
  const { data, error } = await db.from("folders").update(/* … */);
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", "Folder not found");
  return ok(data);
}
```

The route maps the failure with `sendServiceFailure(res, result)`, so the
status-code policy (`validation` → 400, `forbidden` → 403, `not_found` → 404,
`conflict` → 409, `unavailable` → 503, `error` → 500 via `sendInternalError`)
lives in one file: `lib/serviceResult.ts`. Modules that predate the contract
carry their own `kind` strings with equivalent mappings in their routes file;
new code uses the shared one.

## The rules

1. **`lib/` never imports from `modules/` or `application/`.** The kernel does not know which
   domains exist. There are no dependency exceptions.
2. **A module is reached from outside only through its facade.** Another
   module, a worker, a job, `app.ts` — none may import a module's topic files.
   The facade is where a module decides what it exposes. Module implementations
   import siblings directly, never their own facade.
3. **Inside a module, only `*.routes.ts` may import `express`.** Everything
   else is HTTP-agnostic and testable with a fake `db`.
4. **Route files do not query the database.** Every `db.from(...)` /
   `db.rpc(...)` belongs to a service function with a name and a typed result.
5. **Facades re-export by name.** `export *` hides what a module exposes and
   invites accidental coupling.
6. **`middleware/` depends on `lib/`, not on modules or application workflows.** Request plumbing must
   not pull a domain into every request.
7. **`src/routes/` does not exist.** A new HTTP surface is a new module.
8. **Document version writes belong to `modules/documents/`.** Creation, activation, replacement, and deletion go through its facade. The architecture test also rejects direct lifecycle RPC calls from other modules.

9. **Domain implementations and facades cannot import `application/`.** Routes
   are entrypoints and may call workflows. Application services are HTTP-agnostic
   and reach domains through their facades.
10. **Source dependencies are acyclic, including erased type references.** Shared
    contracts belong below their consumers, not in the calling orchestrator.

## Enforcement

`backend/src/__tests__/architecture.test.ts` walks every file under `src/`,
reads its imports, and fails on a violation of any rule above. It runs with the
normal unit suite (`npm test --prefix backend`), so a layering regression fails
CI the same way a broken assertion does. It needs no lint plugin: a directory
walk and the Babel syntax parser resolve imports, re-exports, literal dynamic
imports, `require` and type references, including configured path aliases.
`dependencyCycles.test.ts` checks all production source in backend, web and Word
(LiTT has no desktop app), the shared `packages/` sources, and every local file they reach for
strongly connected components; type-only edges and declaration files are
included, so the gate is stronger than runtime-cycle detection. Nonliteral and unresolved local
imports fail explicitly rather than silently escaping the graph.

Each rule has an explicit allowlist in the test. Adding an entry is a reviewed
decision and needs a comment saying why; the ratchet for rule 4 records the
remaining inline queries per routes file and only ever goes down.

## Text from a model or a stored field

Text that a model wrote, or that is stored as free text, is parsed on a thread
many requests share, so it is scanned in one place: `lib/modelJsonFence.ts`.
Its primitives (code fences, inline citation markers, tags and links, tagged
blocks, front matter, labelled lines, trimming) scan in time proportional to
the text, and refuse text over the limit their caller passes before they read
it, with a `BoundedTextError` the caller turns into the failure it already has
for unreadable text. Front matter is the exception: the text may be of any
size and only the lines inside a bounded window are read. Do not add a regular expression with nested or overlapping
quantifiers over such text; add a primitive there.

The limits follow what the product asks of models, at five characters a token
at most (`charsForTokens`):

- `MODEL_TEXT_MAX_CHARS` (1 MiB) bounds every scan of a model answer: the
  largest output ceiling of any model the product knows is 128,000 tokens
  (640,000 characters). The scans are linear, so it is generous.
- `jsonrepair` is not linear on every damaged shape, so each caller bounds what
  it repairs by what it can legitimately get: a playbook review, import,
  draft or correction by its largest request (20,000 tokens plus the allowance
  for models that always reason: `PLAYBOOK_REPAIR_MAX_CHARS`), a text-form tool
  call by the size of arguments the engine puts before a person for approval
  (`TOOL_ARGUMENT_REPAIR_MAX_CHARS`). Over it the caller fails the way it does
  for an answer that is not JSON. Text that `JSON.parse` accepts is read
  directly, whatever its size up to `MODEL_TEXT_MAX_CHARS`; only text that does
  not parse reaches the repair and its limit.
- A caller whose answer is over its limit reaches the failure the feature
  already has (an import or review that did not return structured JSON, a Word
  turn that could not be saved, an extraction that did not answer with the
  expected list), never an empty success.

`backend/src/__tests__/regexShapes.test.ts` fails on five shapes in a literal
pattern: a quantified group that repeats inside itself or whose alternatives
start alike, an unbounded run anchored only at the end of the text (`\s+$`,
also when a group, a lookahead for the end or a word boundary wraps it), two
unbounded runs side by side that can match the same characters
(`\s*(.*?)\s*$`), and a run that can contain the character the pattern starts
with, followed by something mandatory (`<a>[\s\S]*?<\/a>`). Patterns that still
hold one are in its ratchet list, with how many times each appears in its file;
the list only shrinks. It cannot see a pattern built at run time (their number
is fixed in the test), a string passed to `.match()`, a bounded repetition, a
backreference, how long the input is: every parser of such text also needs a
cost test (`expectLinearCost`) and a size limit.

## The shared kernel (`lib/`)

`lib/` holds two kinds of code:

- **Infrastructure:** `supabase`, `storage`, `queue/`, `dbq/` (durable jobs),
  `llm/`, `mcp/`, `httpError`, `serviceResult`, `pagination`, `search`,
  `privateIp`, `origins`, `runtimeConfig`, `webSearch/` (LiTT's own web search and page reader), `convert`,
  `pdfjs`, `zipExport`, `concurrency`.
- **Cross-domain primitives** that several modules and the job handlers share:
  `access` (project/document authorization), `audit` (audit-row writes),
  `documentTypes`, `documentVersions`, `modelSelection`, `routerModels`,
  `providerCredentials/` (owner-aware encrypted keys and settings, via `index.ts`),
  `routerModelValidation`, `userLookup`, `workflowCatalog*` (used by the chat tools), `sourceDocuments`
  and pure shared utilities. Document-version reads can join across domains;
  mutations have one owner in the documents module.

The assistant engine lives in `modules/chat/engine/`. Other chat surfaces use
named exports from `chat.service.ts`. HTTP framing lives in `lib/assistantSse.ts`;
message reservation and persistence belong to the chat module.

## Background jobs

`jobs/registry.ts` composes domain handlers from module facades and supplies both
handlers and terminal-failure hooks to the queue runner. Importing a module does
not mutate a global handler map. `lib/dbq/` owns delivery, claiming, retries, and
retention; domain job bodies live with documents, tabular, user, audit, and memory.
BullMQ workers are transport adapters to those same domain operations.

Stale-work sweeps live in documents and tabular. `jobs/maintenance.ts` composes
them. Account erasure and export orchestration live in `application/`, with
queue adapters in `application/jobs/`. The registry imports these adapters directly.

## Cross-domain application services

`application/accounts/` coordinates account deletion, retention and data clearing.
`application/organizations/purgeContent.ts` composes permanent content cleanup;
`orgs.deletion.ts` retains recovery-period organization suspension.
`application/exports/` validates/enqueues requests and builds artifacts, checking
permissions again when a queued request executes. No domain facade re-exports
these workflows.

Projects own `projects.lifecycle.ts` and `projects.export.ts`. Document lifecycle
mutations continue through documents. Shared credential persistence, precedence
and encryption live in `lib/providerCredentials/`; user and org adapters retain
their caller-specific policy. Shared DTOs and schemas live below implementations.

These workflows preserve existing transaction and retry boundaries. Account
erasure must refuse sole-owner blockers before destruction, retain organization
content, delete export objects before their pointers and delete auth identity last.
A cross-system workflow is not one database transaction.

## Shared operations and caller-specific policy

Reuse an existing operation before adding another service implementation. The
following rules have a single implementation:

| Operation | Owner | Caller responsibilities |
|---|---|---|
| Rename a project's or library's active document version | `modules/documents/documents.rename.ts`, exported as `renameDocument` | Supply the actor and explicit project/library scope; adapt the result to the existing endpoint shape. The operation checks project permissions and scopes both document queries. |
| Delete collection documents and durably clean all version artifacts | `modules/documents/documents.cleanup.ts`, exported as `deleteCollectionDocuments` | Project callers authorize `docs.organize` and select document IDs inside that project first. Library callers supply the authenticated user's ID and collection; the operation filters eligible IDs. Deletion repeats the scope predicates; database triggers capture source, PDF, and extracted-text keys in the same transaction. |
| Resolve a chat turn's model and reasoning level | `modules/user/user.chatSelection.ts`, exported as `resolveUserChatSelection` | Authorize the chat first; retain each surface's persistence, error mapping, and stream lifetime. Selection itself does not mutate chats or saved preferences. |
| Validate folder paths and moves; collect a deletion subtree | `lib/folderTree.ts` | Supply a scoped folder list/loader and retain the endpoint's validation order and error messages. |
| Resolve an assignable organization member | `lib/orgAccessOverrides.ts`, `findAssignableOrgMember` | Authorize the actor's access-management permission and validate the requested role before resolving the target. Preserve creator ownership and the item's visibility-specific organization-owner rules; organization admins receive no implicit Owner role. |

Shared code must preserve meaningful differences. Library renames still expose
`folder_id` and project renames still conceal denied project access as 404.
Word's local chat mode remains free of chat persistence. Copy callers explicitly
choose their transport and whether a missing rendition is optional or fatal.

### Document lifecycle

- `createDocumentVersion` atomically allocates the version number, inserts the
  row, and activates it. Stable upload IDs are idempotent: a retry neither
  overwrites metadata nor reactivates an older version.
- `createDocumentVersions` commits a copy batch's versions and pointers together.
- `activateDocumentVersion` validates that the version is live and belongs to the
  document. Use deferred activation when dependent edit rows must be saved first.
- `updateDocumentVersion` repeats the document scope and excludes tombstones.
- `deleteVersion` retains its actor checks and uses a transaction that prevents
  deleting the final live version, including concurrent deletes.
- The `document_version_cleanup` trigger records source, PDF, and extracted-text
  cleanup in the deletion/replacement transaction. Cascades use the same rule.
  `document.cleanup` retries without a terminal attempt limit, protects surviving
  storage references, and waits for an in-flight text-cache writer.
- `DB_JOBS_ENABLED=false` uses the same cleanup implementation inline. The trigger
  still retains a durable job if storage fails; normal deployments require no
  application-level path enumeration before deletion.

The lifecycle primitives are trusted persistence operations, not permission
checks. Callers must authorize the destination and separately authorize a copy
source. Project, library, workflow, and upload-session policies remain explicit.

For changes to these rules, add a test of the shared operation and verify the
caller-specific permissions and response contracts. The rename route and
folder-service compatibility suites also pass against the pre-consolidation
PR snapshot (`54d067d3`), so their assertions characterize existing behavior.

## Shared API contracts

`packages/contracts` is the common declaration package for serialized assistant
activity, input requests/responses, source documents, and normalized Word edits.
All three applications resolve `@mike/contracts` to the same authored declarations.
Client event models add their rendering state locally. No client imports a backend
implementation to obtain these types. See [the package guide](../packages/contracts/README.md).

Existing module-local error unions remain supported. New operations use
`ServiceResult<T>`; a feature PR does not need to normalize unrelated endpoints.

## Adding a new domain

1. Create `src/modules/<domain>/` with `<name>.routes.ts` and
   `<name>.service.ts`; split into topic files when the service passes a few
   hundred lines.
2. Mount the router in `app.ts`.
3. Service functions take `db: Db` first and return `ServiceResult<T>` (or a
   module-local union); routes call `sendServiceFailure`.
4. Put unit tests in `src/modules/<domain>/__tests__/`; route-level behavior
   goes in `src/__tests__/integration/`.
5. Run `npm test --prefix backend -- src/__tests__/architecture.test.ts`. If it
   fails, the layering is wrong, not the test.

## Adding a feature within an existing domain

1. Find the operation's owner and call its facade. Add a topic file when the
   behavior is independently understandable; keep public exports named.
2. State the actor and resource scope in the operation's parameters. Check read
   and write permissions independently when a feature copies between scopes.
3. Change a shared wire declaration with its producer and client adapters.
4. Add the smallest useful regression test. Use the database lifecycle SQL tests
   for transaction/cascade behavior; mocks cannot establish transaction safety.
5. Run the architecture test, relevant unit/route tests, builds, and contract
   typecheck. A feature that adds a job also supplies its handler and failure
   hook through its domain facade to the composition root.

For example, a new “copy a library document into a workflow” feature should need
an authorized workflow operation, calls to `copyDocumentVersionFiles` and
`createDocumentVersion`, a route adapter, and tests of scope and response behavior.
It should not add another version counter, pointer update, or cleanup walker.
