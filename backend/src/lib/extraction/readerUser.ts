// The document parser opens files that users upload. On Linux it runs as its own
// unprivileged account, so it cannot read the API process's environment or files;
// the API starts it through setpriv (util-linux), which needs only the set-user
// and set-group capabilities. The checks here ask the same question isolated.ts
// and the startup validation in runtimeConfig do, with one answer.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { childProcessEnv } from "../childEnv";
import { extractionReaderUser } from "./limits";

/** The longest a job waits for the reader's process group to be ended before it settles anyway (and so frees its slot). */
export const REAPER_WAIT_MS = 2_000;

/** The longest a job waits for the reader's scratch directory to be made: past it the job fails at once. */
export const READER_SCRATCH_CREATE_MS = 5_000;

/** The longest the removal of a reader's scratch directory may take. It runs after the job has settled and freed its slot, so no job waits for it. */
export const READER_SCRATCH_REMOVE_MS = 10_000;

/** The longest the start-up clean-up of leftover reader scratch may take. */
export const READER_CLEANUP_MS = 20_000;

/**
 * The most processes and threads the reader user may hold at once, all readers
 * together (RLIMIT_NPROC counts both and applies to the user, not to one process).
 * A runaway reader then runs out of its own allowance, not of the container's
 * `pids_limit`, which the API and the reaper need to keep starting processes.
 * The container's limit is 512; the busiest measured use of the readers (an
 * upload of six files at once, the conversions and the parser together) peaks
 * well under this one (README, "Los lectores de archivos").
 * The kernel counts per numeric user id on the whole host, so the allowance is shared
 * with every other process of that id and with a second stack of the image (the id is
 * 48217 in the image to make that unlikely; deploy/prod/README.md says how to check).
 * `EXTRACTION_READER_PROCESS_LIMIT` overrides it; 0 leaves it off (tests and hosts
 * where the user already holds many processes).
 */
export const READER_PROCESS_LIMIT_DEFAULT = 256;

export function readerProcessLimit(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.EXTRACTION_READER_PROCESS_LIMIT?.trim();
  if (raw === undefined || raw === "") return READER_PROCESS_LIMIT_DEFAULT;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : READER_PROCESS_LIMIT_DEFAULT;
}

/** setpriv's arguments, up to and including `--`: the reader's user and group,
 * no supplementary groups, no capability kept or inheritable, and no way to gain one. */
export function readerSwitchArgs(user: string): string[] {
  return [
    "--reuid", user, "--regid", user, "--clear-groups",
    "--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--",
  ];
}

/** setpriv's arguments for a child that is not a reader: nothing inheritable or
 * ambient survives the exec, and nothing can be gained back. */
export function noCapabilityArgs(): string[] {
  return ["--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--"];
}

/** True when `/proc/<pid>/status` text shows an ambient capability: the set that
 * reaches the children of a non-root process (an inheritable one reaches a child
 * only through a file that carries capabilities, and the image has none). */
export function inheritsCapabilities(status: string): boolean {
  const value = /^CapAmb:\s*([0-9a-f]+)/m.exec(status)?.[1];
  return value !== undefined && /[1-9a-f]/.test(value);
}

function holdsInheritableCapabilities(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return inheritsCapabilities(readFileSync("/proc/self/status", "utf8"));
  } catch {
    return false;
  }
}

/**
 * The one place that decides how a process is started. Every file that starts
 * one goes through it (childProcessGuard.test.ts):
 *  - `asReader` (the reader's user name): the command runs as that user, with
 *    no capability and no way to gain one, and under a limit on the number of
 *    that user's processes. Processes that open uploaded files use this.
 *  - `reaper`: the small helper that ends a reader's process group
 *    (reaper.ts) starts as it is, keeping the set-user capability the API
 *    holds; it is the only mode that does, and only readerUser.ts asks for it.
 *  - otherwise, when this process holds ambient capabilities (the
 *    API keeps the set-user and set-group ones only to start readers), the
 *    command is started with every one of them dropped.
 *  - otherwise it starts as it is.
 */
export function launchChild(
  command: string,
  args: string[],
  options: { asReader?: string | null; capabilitiesHeld?: boolean; reaper?: boolean; env?: NodeJS.ProcessEnv } = {},
): { command: string; args: string[] } {
  if (options.reaper) return { command, args };
  if (options.asReader) {
    const limit = readerProcessLimit(options.env);
    const switched = ["setpriv", ...readerSwitchArgs(options.asReader), command, ...args];
    return limit > 0
      ? { command: "prlimit", args: [`--nproc=${limit}:${limit}`, "--", ...switched] }
      : { command: switched[0], args: switched.slice(1) };
  }
  if (options.capabilitiesHeld ?? holdsInheritableCapabilities()) {
    return { command: "setpriv", args: [...noCapabilityArgs(), command, ...args] };
  }
  return { command, args };
}

/** What the switched process prints: its user id, its group id and all its groups, one line each. */
const READER_IDENTITY_SCRIPT = "id -u; id -g; id -G";

/** What a reader started through the switch really is, as that process reports it. */
export interface ReaderIdentity {
  /** Why the process cannot start readers as `user`, or null when it can. */
  problem: string | null;
  /** The reader's numeric user id as the switched process reported it, when it could be read. */
  uid?: number;
}

const ID = /^\d{1,10}$/;

function judgeReaderIdentity(user: string, output: string, ownUid: number | undefined, ownGid: number | undefined): ReaderIdentity {
  const lines = output.trim().split("\n").map((line) => line.trim());
  const groups = (lines[2] ?? "").split(/\s+/);
  if (lines.length !== 3 || !ID.test(lines[0]) || !ID.test(lines[1]) || !groups.every((group) => ID.test(group))) {
    return { problem: `the identity ${user} gets could not be read from the switched process` };
  }
  const uid = Number(lines[0]);
  const gid = Number(lines[1]);
  const verdict = (problem: string | null): ReaderIdentity => ({ problem, uid });
  if (uid === 0) return verdict(`${user} would run the readers as user id 0`);
  if (uid === ownUid) return verdict(`${user} is the same numeric user as this process, so the readers would run as the API`);
  if (gid === 0) return verdict(`${user} would run the readers in group id 0`);
  if (gid === ownGid) return verdict(`${user} would run the readers in the same group as this process`);
  if (groups.some((group) => Number(group) !== gid)) return verdict(`${user} would run the readers with supplementary groups`);
  return { problem: null, uid };
}

const probed = new Map<string, ReaderIdentity>();

/**
 * Starts, once per process start and per (user, PATH), the identity command through
 * the very launch a reader gets (the same switch arguments and process limit) and
 * decides from what it prints: a reader is never started through the switch as user 0,
 * group 0, the process's own user or group, or with a supplementary group. The one
 * answer is used by the start-up check (runtimeConfig) and by the launcher alike.
 */
export function readerIdentity(user: string, env: NodeJS.ProcessEnv = process.env): ReaderIdentity {
  const key = `${user}\0${env.PATH ?? ""}`;
  const known = probed.get(key);
  if (known) return known;
  const launch = launchChild("sh", ["-c", READER_IDENTITY_SCRIPT], { asReader: user, env });
  const result = spawnSync(launch.command, launch.args, {
    env: { PATH: env.PATH ?? "" }, encoding: "utf8", timeout: 10_000, maxBuffer: 4_096, stdio: ["ignore", "pipe", "pipe"],
  });
  let identity: ReaderIdentity;
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    identity = { problem: code === "ENOENT" ? `${launch.command} was not found on PATH (util-linux)` : `${launch.command} could not be run (${code ?? "error"})` };
  } else if (result.status !== 0) {
    const detail = (result.stderr ?? "").split("\n").find((line) => line.trim())?.trim().slice(0, 200);
    identity = { problem: `setpriv could not switch to ${user}${detail ? `: ${detail}` : ""}` };
  } else {
    identity = judgeReaderIdentity(user, result.stdout ?? "", process.getuid?.(), process.getgid?.());
  }
  probed.set(key, identity);
  return identity;
}

/** Why the process cannot start readers as `user` (see readerIdentity), or null when it can. */
export function readerSwitchProblem(user: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return readerIdentity(user, env).problem;
}

/** The configured reader user when the process can switch to it as a distinct unprivileged user, else null
 * (the parser then runs as the API's own user, as it does where there is no second user). */
export function activeReaderUser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const user = extractionReaderUser(env, platform);
  return user && readerSwitchProblem(user, env) === null ? user : null;
}

// ---- ending a reader's process group ------------------------------------

/** The reader's numeric user id as the switched process reported it, or null: the id the readers really have, which the account file need not agree with.
 * Null too for an identity the start-up check refused: nothing acts as that user. */
function readerUid(user: string): number | null {
  const { problem, uid } = readerIdentity(user);
  return problem === null && uid !== undefined && uid > 0 ? uid : null;
}

/** The helper's command: only the group id and the reader's user id. Null for a number it must not act on. */
export function reaperCommand(group: number, uid: number): { command: string; args: string[] } | null {
  if (!Number.isSafeInteger(group) || group <= 1 || !Number.isSafeInteger(uid) || uid <= 0) return null;
  const typescript = __filename.endsWith(".ts");
  const entry = path.join(__dirname, typescript ? "reaper.ts" : "reaper.js");
  return launchChild(
    process.execPath,
    [...(typescript ? ["--require", require.resolve("tsx/cjs")] : []), entry, String(group), String(uid)],
    { reaper: true },
  );
}

/** No process is left in the group: signal 0 finds no such group (a group of another user answers EPERM, which is a live one). */
function groupIsGone(group: number): boolean {
  try { process.kill(-group, 0); return false; } catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
}

const reported = new Set<string>();
/** One warning per kind of problem, not one per job. */
export function reportOnce(key: string, message: string): void {
  if (reported.has(key)) return;
  reported.add(key);
  console.warn(`[extraction] ${message}`);
}

/**
 * Ends every process of a reader's group (SIGKILL, which also reaches a stopped
 * process) and resolves within REAPER_WAIT_MS whatever happens; it never rejects.
 * With a reader user the API cannot signal the group, so the reaper does it. With
 * none (development, tests) the API signals the group itself.
 */
export function reapGroup(user: string | null, group: number | undefined): Promise<void> {
  if (group === undefined || !Number.isSafeInteger(group) || group <= 1 || groupIsGone(group)) return Promise.resolve();
  if (!user) {
    try { process.kill(-group, "SIGKILL"); } catch { /* gone */ }
    return Promise.resolve();
  }
  const uid = readerUid(user);
  const launch = uid === null ? null : reaperCommand(group, uid);
  if (!launch) {
    reportOnce("reaper-unavailable", `cannot end a reader's processes: no user id for ${user}`);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    // The reaper's own environment holds nothing: it needs none.
    const child = spawn(launch.command, launch.args, { env: {}, stdio: "ignore" });
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } finish(); }, REAPER_WAIT_MS);
    timer.unref();
    child.once("error", () => { reportOnce("reaper-start", "the process that ends a reader's processes could not be started"); finish(); });
    child.once("close", finish);
  });
}

/** The same, for the moment the API exits and cannot wait for anything asynchronous. */
export function reapGroupSync(user: string | null, group: number): void {
  if (!Number.isSafeInteger(group) || group <= 1 || groupIsGone(group)) return;
  if (!user) { try { process.kill(-group, "SIGKILL"); } catch { /* gone */ } return; }
  const uid = readerUid(user);
  const launch = uid === null ? null : reaperCommand(group, uid);
  if (launch) spawnSync(launch.command, launch.args, { env: {}, stdio: "ignore", timeout: REAPER_WAIT_MS });
}

// Every reader group that is alive, so that the API's own exit ends them too.
const liveGroups = new Map<number, string | null>();
let exitHook = false;
/** Records a reader's group until the returned function is called. */
export function trackReaderGroup(group: number | undefined, user: string | null): () => void {
  if (group === undefined || group <= 1 || process.platform === "win32") return () => {};
  liveGroups.set(group, user);
  if (!exitHook) {
    exitHook = true;
    process.on("exit", () => { for (const [id, owner] of liveGroups) reapGroupSync(owner, id); });
  }
  return () => { liveGroups.delete(group); };
}

/** Runs a command as the reader and resolves with its standard output; rejects at `timeoutMs` (the command's group is then ended in the background, not waited for). */
export function runAsReader(user: string, command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const launch = launchChild(command, args, { asReader: user });
    let done = false;
    let stdout = "";
    let stderr = "";
    const finish = (error: Error | null, keepTracking = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!keepTracking) release();
      if (error) reject(error); else resolve(stdout);
    };
    // Its own process group, so the group can be ended whatever the command does.
    const child = spawn(launch.command, launch.args, { env: childProcessEnv(), detached: true, stdio: ["ignore", "pipe", "pipe"] });
    const release = trackReaderGroup(child.pid, user);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-500); });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => finish(code === 0 ? null : new Error(`${command} as the reader failed (${code})${stderr.trim() ? `: ${stderr.trim()}` : ""}`)));
    const timer = setTimeout(() => {
      // The caller is told at once; the group is ended after, and stays tracked until it is.
      void reapGroup(user, child.pid).finally(release);
      finish(new Error(`${command} as the reader did not finish within ${timeoutMs} ms`), true);
    }, timeoutMs);
  });
}

/** Makes a scratch directory owned by the reader (mode 0700) under the temporary directory, within READER_SCRATCH_CREATE_MS. */
export async function createReaderScratch(user: string, prefix: string): Promise<string> {
  return (await runAsReader(user, "mktemp", ["-d", path.join(tmpdir(), `${prefix}XXXXXX`)], READER_SCRATCH_CREATE_MS)).trim();
}

/**
 * Removes a reader's scratch directory once the caller has finished with it:
 * it starts on the next turn of the event loop, after the job has settled and
 * freed its slot, and is bounded by READER_SCRATCH_REMOVE_MS. A failure is
 * reported once under `key` and never retried (the start-up clean-up removes
 * what is left). Resolves when it is over; never rejects.
 */
export function removeReaderScratchLater(user: string, scratch: string, key: string, what: string): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(() => {
      runAsReader(user, "rm", ["-rf", "--", scratch], READER_SCRATCH_REMOVE_MS).then(
        () => undefined,
        (error) => reportOnce(key, `could not remove ${what}: ${String((error as Error)?.message ?? error).slice(0, 200)}`),
      ).then(resolve);
    });
  });
}

/**
 * Removes what the reader user owns directly under the temporary directory: the
 * scratch of a job that a stop or a restart interrupted. It runs as the reader, so
 * it can touch nothing else, and finds by owner without following links. It never
 * runs against the API's own user. Never throws.
 */
export async function removeReaderScratch(
  user: string,
  options: { directory?: string; ownUid?: number } = {},
): Promise<{ ok: true; removed: number; skipped?: boolean } | { ok: false; reason: string }> {
  const uid = readerUid(user);
  const own = options.ownUid ?? process.getuid?.();
  if (uid === null || uid === own) return { ok: true, removed: 0, skipped: true };
  try {
    const listed = await runAsReader(
      user,
      "find",
      [options.directory ?? tmpdir(), "-mindepth", "1", "-maxdepth", "1", "-user", user, "-print", "-exec", "rm", "-rf", "--", "{}", "+"],
      READER_CLEANUP_MS,
    );
    return { ok: true, removed: listed.split("\n").filter(Boolean).length };
  } catch (error) {
    const reason = String((error as Error)?.message ?? error).split("\n")[0].slice(0, 200);
    reportOnce("reader-scratch", `could not remove the reader's leftover scratch directories: ${reason}`);
    return { ok: false, reason };
  }
}

/** At start, before any job: removes the scratch of jobs a stop or restart interrupted. Never throws, never blocks longer than READER_CLEANUP_MS. */
export async function removeLeftoverReaderScratch(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const user = activeReaderUser(env);
  if (!user) return;
  const result = await removeReaderScratch(user);
  if (result.ok && result.removed > 0) console.log(`[extraction] removed ${result.removed} leftover reader scratch entr${result.removed === 1 ? "y" : "ies"}`);
}
