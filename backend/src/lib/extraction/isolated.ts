// One parser slot per calling thread. Queue coordination remains responsive;
// a reusable child process keeps parsers warm behind an OS memory boundary.
import path from "node:path";
import type { Socket } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import type { ExtractionOp, ExtractionOps } from "./ops";
import type { OcrFill } from "../ocr/pages";
import { admission, type AdmissionOptions } from "./admission";
import { EXTRACTION_MAX_BYTES, ExtractionLimitError, extractionIsolated, extractionLauncher, extractionMemoryMb, extractionTimeoutMs } from "./limits";
import { asExtractionFailure, extractionFailureFromWire, type ExtractionFailureWire } from "./failure";
import { AppError } from "../appError";
import { childProcessEnv } from "../childEnv";
import { LIFELINE_ENV } from "./lifeline";
import { activeReaderUser, launchChild, runAsReader } from "./readerUser";

export { EXTRACTION_MAX_BYTES, ExtractionBusyError, ExtractionLimitError } from "./limits";
export { ExtractionParseError } from "./failure";

type Result<K extends ExtractionOp> = Awaited<ReturnType<ExtractionOps[K]>>;
/** `ocr` is a read scan to merge into a PDF's text; `args` is the op's own plain-data input (pdfCopyPages: the groups). */
export type ExtractOptions = { fileType?: string; ocr?: OcrFill; args?: unknown };
export type ExtractInSlot = <K extends ExtractionOp>(op: K, bytes: ArrayBuffer, options?: ExtractOptions) => Promise<Result<K>>;
type Reply = { ok: true; result: unknown } | ({ ok: false; limited: boolean } & ExtractionFailureWire);

/** Hard OS memory boundary on Linux, including native buffers. Fail closed if
 * prlimit is unavailable. With a reader user the parser then runs as that
 * account (setpriv), after the limits are set. Other platforms retain process/heap and input/output
 * bounds, but do not claim the Linux OS-memory guarantee.
 */
export function extractionCommand(entry: string, readerUser: string | null = activeReaderUser()): { command: string; args: string[] } {
  const launcher = extractionLauncher();
  const memoryMb = extractionMemoryMb();
  const typescript = entry.endsWith(".ts");
  const nodeArgs = [
    "--disable-wasm-trap-handler",
    `--max-old-space-size=${memoryMb}`,
    // A WebAssembly memory with no small maximum (the comparison engine's)
    // otherwise reserves the largest step of 4, 3, 2 or 1 GiB that still fits
    // under --as, leaving tens of MB for everything else; the process then dies
    // at the address-space cap wherever that runs out (an abort, or a SIGSEGV
    // when the stack cannot grow), not at the memory budget. A memory cannot
    // commit more than --data anyway, so reserve at most the budget (64 KiB pages).
    `--wasm-max-mem-pages=${memoryMb * 16}`,
    ...(typescript ? ["--require", require.resolve("tsx/cjs")] : []),
    entry,
  ];
  // setpriv ahead of node when it runs as the reader; the limits stay ahead of it.
  const parser = launchChild(process.execPath, nodeArgs, { asReader: readerUser });
  if (launcher) {
    const bytes = memoryMb * 1024 * 1024;
    // Writable heap/native allocations share the data limit. V8 also reserves
    // address space (~1 GiB of its own, plus each WebAssembly memory up to the
    // budget); bound that separately. It is address space, not RAM: the real cap
    // stays --data and the container's cgroup. The TS loader used in dev and
    // tests brings one more WebAssembly memory (its lexer), so it gets one more
    // budget of address space; the compiled server does not load it.
    const addressBytes = bytes + 2 * 1024 ** 3 + (typescript ? bytes : 0);
    return { command: launcher, args: [`--data=${bytes}:${bytes}`, `--as=${addressBytes}:${addressBytes}`, "--core=0:0", "--", parser.command, ...parser.args] };
  }
  return parser;
}

// Server-log text for the operator (never sent to a client).
const PARSER_UNAVAILABLE_MESSAGE =
  "The document parser process could not be started, so text extraction " +
  "and DOCX validation fail. On Linux it is launched through prlimit " +
  "(util-linux) to enforce its memory limit; install util-linux (the " +
  "backend Docker image and backend/nixpacks.toml include it, see " +
  "docs/deployment.md). No restart is needed once it is on PATH.";

function killParser(child: ChildProcess, otherUser = false): void {
  if (!child.pid) return;
  if (otherUser) {
    // The API holds no right to signal a process of another user. It closes the
    // parser's stdin; the parser (process.ts) ends its own process group on EOF.
    child.stdin?.destroy();
  } else if (process.platform === "win32") {
    const kill = launchChild("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    execFile(kill.command, kill.args, { env: childProcessEnv() }, () => { child.kill("SIGKILL"); });
  } else {
    // Includes LibreOffice descendants, including after the parser has exited.
    try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}

type Parser = {
  child: ChildProcess;
  closed: Promise<void>;
  memoryMb: number;
  started: boolean;
  otherUser: boolean;
  files: number;
  idle?: ReturnType<typeof setTimeout>;
};
let parser: Parser | null = null;
const RECYCLE_AFTER_FILES = 200;
const IDLE_SHUTDOWN_MS = 60_000;

function retire(p: Parser): void {
  if (parser === p) parser = null;
  clearTimeout(p.idle);
  killParser(p.child, p.otherUser);
}

/** Also used at test boundaries so no warm process outlives its configuration. */
export async function stopExtractionProcess(): Promise<void> {
  const p = parser;
  if (p) { retire(p); await p.closed; }
}

function reference(p: Parser, active: boolean): void {
  if (active) {
    p.child.ref(); p.child.channel?.ref();
    (p.child.stderr as Socket | null)?.ref();
  } else {
    p.child.unref(); p.child.channel?.unref();
    (p.child.stderr as Socket | null)?.unref();
  }
}

async function startParser(): Promise<Parser> {
  const entry = path.join(__dirname, __filename.endsWith(".ts") ? "process.ts" : "process.js");
  const readerUser = activeReaderUser();
  const { command, args } = extractionCommand(entry, readerUser);
  // The reader's own directory (mode 0700, its owner) when it runs as another user.
  const scratch = readerUser
    ? (await runAsReader(readerUser, "mktemp", ["-d", path.join(tmpdir(), "mike-extraction-XXXXXX")])).trim()
    : await mkdtemp(path.join(tmpdir(), "mike-extraction-"));
  // No application credentials or inherited NODE_OPTIONS in the parser.
  // The scratch directory is the parser's temp directory; glibc arena
  // reservations would otherwise exhaust RLIMIT_AS at low actual usage.
  const env = childProcessEnv({
    TMPDIR: scratch, TMP: scratch, TEMP: scratch, MALLOC_ARENA_MAX: "2",
    ...(readerUser ? { HOME: scratch, [LIFELINE_ENV]: "0" } : {}),
  });
  // `command` and `args` come from extractionCommand(), which went through launchChild().
  const child = spawn(command, args, {
    env, detached: process.platform !== "win32",
    stdio: [readerUser ? "pipe" : "ignore", "ignore", "pipe", "ipc"], serialization: "advanced",
  });
  child.stdin?.on("error", () => {});
  const p: Parser = { child, closed: Promise.resolve(), memoryMb: extractionMemoryMb(), started: false, otherUser: readerUser !== null, files: 0 };
  const onParentExit = () => killParser(child, p.otherUser);
  process.once("exit", onParentExit);
  child.once("spawn", () => { p.started = true; });
  // Idle child errors must still retire the process even without a parse listener.
  child.on("error", () => retire(p));
  p.closed = new Promise<void>((resolve, reject) => child.once("close", () => {
    retire(p);
    process.removeListener("exit", onParentExit);
    void (readerUser ? runAsReader(readerUser, "rm", ["-rf", "--", scratch]).then(() => undefined) : rm(scratch, { recursive: true, force: true })).then(resolve, reject);
  }));
  // Idle retirement has no caller awaiting cleanup; active parses do await it.
  void p.closed.catch(() => {});
  return p;
}

async function extractInChild<K extends ExtractionOp>(op: K, bytes: ArrayBuffer, options: ExtractOptions = {}): Promise<Result<K>> {
  if (bytes.byteLength > EXTRACTION_MAX_BYTES) throw new ExtractionLimitError("source exceeds 150 MB");
  if (!extractionIsolated()) {
    const { EXTRACTION_OPS } = await import("./ops.js");
    try {
      return await EXTRACTION_OPS[op](bytes, options.fileType ?? "", options.ocr, options.args as never) as Result<K>;
    } catch (error) {
      // Classified as the isolated path is, so callers treat both alike.
      throw error instanceof ExtractionLimitError ? error : asExtractionFailure(error);
    }
  }
  if (parser && parser.memoryMb !== extractionMemoryMb()) await stopExtractionProcess();
  const p = parser ?? (parser = await startParser());
  clearTimeout(p.idle);
  reference(p, true);
  const { child } = p;
  return new Promise<Result<K>>((resolve, reject) => {
    let reply: Reply | undefined;
    let failure: Error | undefined;
    let diagnostics = "";
    const timeout = setTimeout(() => {
      failure = new ExtractionLimitError("parser deadline exceeded");
      retire(p);
    }, extractionTimeoutMs());
    const onDiagnostics = (chunk: Buffer) => {
      diagnostics = (diagnostics + chunk.toString()).slice(-8192);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.removeListener("message", onMessage);
      child.removeListener("error", onError);
      child.removeListener("close", onClose);
      child.removeListener("spawn", send);
      child.stderr?.removeListener("data", onDiagnostics);
    };
    const onMessage = (message: Reply) => {
      if (failure) return;
      reply = message;
      if (!reply.ok || ++p.files >= RECYCLE_AFTER_FILES) { retire(p); return; }
      cleanup();
      p.idle = setTimeout(() => retire(p), IDLE_SHUTDOWN_MS);
      p.idle.unref();
      reference(p, false);
      resolve(reply.result as Result<K>);
    };
    // Before "spawn" the launcher itself failed; its errno stays on the cause.
    const onError = (error: Error) => {
      failure = p.started ? error : new AppError("extraction.parser_unavailable", PARSER_UNAVAILABLE_MESSAGE, { cause: error });
      retire(p);
    };
    const onClose = (_code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      void p.closed.then(() => {
        if (failure instanceof ExtractionLimitError) reject(failure);
        else if (reply?.ok) resolve(reply.result as Result<K>);
        else if (reply) reject(reply.limited ? new ExtractionLimitError(reply.message) : extractionFailureFromWire(reply));
        // The memory caps end the parser as an abort (V8 cannot allocate) or, when
        // the stack cannot grow at the cap, as a SIGSEGV/SIGBUS, or V8's heap-limit trap surfaces as a SIGTRAP; all of these are the
        // budget (see extractionCommand). SIGKILL stays apart: it is the host's
        // OOM killer or an operator, not this parser's own limit.
        else if (signal === "SIGABRT" || signal === "SIGSEGV" || signal === "SIGBUS" || signal === "SIGTRAP" || /out of memory|allocation failed|cannot allocate memory|failed to map segment|ENOMEM/i.test(diagnostics)) {
          reject(new ExtractionLimitError("parser memory budget exceeded"));
        } else if (failure) reject(failure);
        else {
          // The signal separates an OOM-killer SIGKILL from a native crash.
          const exited = new AppError("extraction.process_exited", "extraction process exited without a result");
          reject(signal ? Object.assign(exited, { code: signal }) : exited);
        }
      }, reject);
    };
    const send = () => child.send({ op, bytes, fileType: options.fileType ?? "", ocr: options.ocr, args: options.args }, (error) => {
      if (error && !reply && !failure) onError(error);
    });
    child.stderr?.on("data", onDiagnostics);
    child.once("message", onMessage);
    child.once("error", onError);
    child.once("close", onClose);
    if (p.started) send(); else child.once("spawn", send);
  });
}

const parserAdmission = admission(1);
const requestAdmission = admission(3);
// Only one background source is loaded at a time. Waiting jobs hold no buffers;
// durable jobs time out, while inline jobs must wait because no runner retries them.
const backgroundAdmission = admission(1, Infinity);

/** Background parser slots that are idle right now (the job runner claims only that many parser-bound jobs). */
export function backgroundExtractionSlotsFree(): number {
  return Math.min(backgroundAdmission.free(), parserAdmission.free());
}

/** Reserve only the parser; source I/O belongs outside this slot. */
export function withExtractionSlot<T>(
  options: AdmissionOptions,
  work: (extract: ExtractInSlot) => Promise<T>,
): Promise<T> {
  return parserAdmission(options, () => work(extractInChild));
}

function queuedExtraction<K extends ExtractionOp>(op: K, bytes: ArrayBuffer, options?: ExtractOptions): Promise<Result<K>> {
  return withExtractionSlot<Result<K>>({ interactive: true }, (extract) => extract(op, bytes, options));
}

/** Background I/O cannot block interactive parsing or fill its admission queue. */
export function withBackgroundExtraction<T>(
  options: { waitMs?: number },
  work: (extract: ExtractInSlot) => Promise<T>,
): Promise<T> {
  const started = Date.now();
  return backgroundAdmission(options, () => {
    const waitMs = options.waitMs === undefined ? undefined : Math.max(0, options.waitMs - (Date.now() - started));
    const extract: ExtractInSlot = (op, bytes, parseOptions) =>
      withExtractionSlot({ waitMs }, (parse) => parse(op, bytes, parseOptions));
    return work(extract);
  });
}

/** Three interactive sources may download/parse concurrently, matching tabular
 * row concurrency. Only the actual parser call takes the single parser slot. */
export function withExtractionRequest<T>(work: (extract: ExtractInSlot) => Promise<T>): Promise<T> {
  return requestAdmission({}, () => work(queuedExtraction));
}

export function runIsolatedExtraction<K extends ExtractionOp>(
  op: K,
  loadSource: () => Promise<ArrayBuffer | null>,
  options: ExtractOptions = {},
): Promise<Result<K>> {
  return withExtractionRequest<Result<K>>(async (extract): Promise<Result<K>> => {
    const source = await loadSource();
    if (!source) throw new Error("document_text_source_unavailable");
    return extract(op, source, options);
  });
}
