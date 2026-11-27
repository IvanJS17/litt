// The helper that ends a reader's process group for the API, which cannot signal the reader itself.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REAPER_WAIT_MS, reapGroup, removeReaderScratch } from "../readerUser";
import { ANSWER_IDENTITY_COMMAND, beAnotherUserThanTheReaders } from "./readerStandIn";

// Passes every start through, so a test can see which commands were launched.
const spawned = vi.hoisted(() => ({ spy: null as null | ReturnType<typeof vi.fn> }));
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  spawned.spy = vi.fn(real.spawn as (...args: never[]) => unknown);
  return { ...real, spawn: spawned.spy };
});

const me = os.userInfo().username;
const work = mkdtempSync(path.join(os.tmpdir(), "mike-reaper-"));
const started: ChildProcess[] = [];
afterEach(() => {
  for (const child of started.splice(0)) {
    try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
  }
  vi.unstubAllEnvs();
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

/** A group that stops itself and ignores the usual signals, like a reader that does not cooperate. */
function frozenGroup(): ChildProcess {
  const child = spawn("sh", ["-c", "trap '' TERM HUP INT; sleep 3600 & kill -STOP $$; wait"], { detached: true, stdio: "ignore" });
  started.push(child);
  return child;
}
const alive = (pid: number) => spawnSync("kill", ["-0", String(pid)]).status === 0;

describe.skipIf(process.platform !== "linux")("ending a reader's process group", () => {
  // Stand-in setpriv: the test host has no reader user; it answers the identity command and keeps the user.
  // This process reports another user than the stand-in's answer, as it would beside a real reader user.
  let another: { restore: () => void };
  afterEach(() => another.restore());
  beforeEach(() => {
    another = beAnotherUserThanTheReaders();
    const standIn = path.join(work, "bin-ending");
    mkdirSync(standIn, { recursive: true });
    writeFileSync(path.join(standIn, "setpriv"), `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift\n${ANSWER_IDENTITY_COMMAND}\nexec "$@"\n`);
    chmodSync(path.join(standIn, "setpriv"), 0o755);
    vi.stubEnv("PATH", `${standIn}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
  });

  it("kills every process of a stopped group that ignores signals, and returns within the bounded wait", async () => {
    const child = frozenGroup();
    await vi.waitFor(() => expect(spawnSync("ps", ["-o", "stat=", "-p", String(child.pid)], { encoding: "utf8" }).stdout).toMatch(/T/), { timeout: 5_000 });
    const began = Date.now();
    await reapGroup(me, child.pid!);
    expect(Date.now() - began).toBeLessThanOrEqual(REAPER_WAIT_MS + 500);
    await vi.waitFor(() => expect(spawnSync("ps", ["-o", "pid=", "-g", String(child.pid)], { encoding: "utf8" }).stdout.trim()).toBe(""), { timeout: 5_000 });
  }, 30_000);

  it("does nothing when there is no such group, and never refuses", async () => {
    await expect(reapGroup(me, 2_147_483_000)).resolves.toBeUndefined();
    await expect(reapGroup(me, 0)).resolves.toBeUndefined();
    await expect(reapGroup(me, 1)).resolves.toBeUndefined();
  });

  it("signals the group itself when there is no reader user", async () => {
    const child = frozenGroup();
    await vi.waitFor(() => expect(spawnSync("ps", ["-o", "stat=", "-p", String(child.pid)], { encoding: "utf8" }).stdout).toMatch(/T/), { timeout: 5_000 });
    await reapGroup(null, child.pid!);
    await vi.waitFor(() => expect(alive(child.pid!)).toBe(false), { timeout: 5_000 });
  }, 30_000);

  it("refuses a group number that is not a reader's: its own group and the init's", () => {
    const reaper = path.resolve(__dirname, "..", "reaper.ts");
    const run = (pgid: string, uid: string) => spawnSync(process.execPath, ["--require", require.resolve("tsx/cjs"), reaper, pgid, uid], { env: {}, encoding: "utf8" });
    for (const [pgid, uid] of [["1", String(process.getuid!())], ["0", String(process.getuid!())], ["-5", "1"], ["abc", "1"], [String(process.pid), String(process.getuid!())], ["4242", "0"]]) {
      expect(run(pgid, uid).status, `${pgid} ${uid}`).not.toBe(0);
    }
  }, 60_000);
});

describe.skipIf(process.platform !== "linux")("removing reader scratch left by an interrupted job", () => {
  const bin = path.join(work, "bin");
  const tmp = path.join(work, "tmp");
  beforeEach(() => {
    rmSync(bin, { recursive: true, force: true });
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(bin);
    mkdirSync(tmp);
    // Stand-in setpriv: the test host has no reader user; it keeps the user and runs what follows "--".
    writeFileSync(path.join(bin, "setpriv"), `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift\n${ANSWER_IDENTITY_COMMAND}\nexec "$@"\n`);
    chmodSync(path.join(bin, "setpriv"), 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
  });

  it("removes what the reader user owns directly under the temporary directory, links included, without following them", async () => {
    const another = beAnotherUserThanTheReaders();
    try {
    const outside = path.join(work, "outside");
    mkdirSync(outside);
    writeFileSync(path.join(outside, "kept.txt"), "kept");
    mkdirSync(path.join(tmp, "mike-extraction-AAAA"));
    writeFileSync(path.join(tmp, "mike-extraction-AAAA", "input.pdf"), "copy of a document");
    mkdirSync(path.join(tmp, "litt-convert-BBBB"));
    symlinkSync(outside, path.join(tmp, "link-out"));
    symlinkSync(outside, path.join(tmp, "litt-convert-BBBB", "inner-link"));
    const result = await removeReaderScratch(me, { directory: tmp, ownUid: -1 });
    expect(result).toEqual({ ok: true, removed: 3 });
    expect(existsSync(path.join(tmp, "mike-extraction-AAAA"))).toBe(false);
    expect(existsSync(path.join(tmp, "litt-convert-BBBB"))).toBe(false);
    expect(existsSync(path.join(tmp, "link-out"))).toBe(false);
    expect(existsSync(path.join(outside, "kept.txt"))).toBe(true);
    } finally { another.restore(); }
  });

  it("removes nothing that belongs to the API's own user", async () => {
    mkdirSync(path.join(tmp, "api-owned"));
    expect(await removeReaderScratch(me, { directory: tmp })).toMatchObject({ ok: true, skipped: true });
    expect(existsSync(path.join(tmp, "api-owned"))).toBe(true);
  });

  it("reports a clean-up that fails, and does not throw", async () => {
    writeFileSync(path.join(bin, "setpriv"), `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift\n${ANSWER_IDENTITY_COMMAND}\necho nope >&2\nexit 1\n`);
    const another = beAnotherUserThanTheReaders();
    try {
      const result = await removeReaderScratch(me, { directory: tmp, ownUid: -1 });
      expect(result).toMatchObject({ ok: false });
    } finally { another.restore(); }
  });
});

// The helper takes the reader's user as its EFFECTIVE user only, so that the readers
// (who share that user) can neither signal it, trace it nor read its memory: all of
// that needs a match with its real or saved user. Changing the real or saved user, or
// the group, would remove that protection. Taking the user needs a capability the test
// runner does not have, so the property is pinned by reading the source here; the built
// image's process status is checked in the lab (README, "Los lectores de archivos").
describe("the helper that ends a reader's group keeps its own real user", () => {
  const source = readFileSync(path.resolve(__dirname, "..", "reaper.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("changes only its effective user, before it sends the signal", () => {
    const take = source.search(/\bprocess\.seteuid\b/);
    const send = source.search(/\bprocess\.kill\b/);
    expect(take, "the effective user is taken").toBeGreaterThanOrEqual(0);
    expect(send, "the signal is sent").toBeGreaterThanOrEqual(0);
    expect(take, "the effective user is taken before the signal").toBeLessThan(send);
  });

  it("never changes its real or saved user, or any group", () => {
    expect(source).not.toMatch(/\.(setuid|setreuid|setresuid|setgid|setregid|setresgid|setegid|setgroups|initgroups)\b/);
    expect(source).not.toMatch(/\bsetpriv\b|\bsetresuid\b/);
  });
});

describe.skipIf(process.platform !== "linux")("an identity the start-up check refused", () => {
  const ownUid = process.getuid!();
  const ownGid = process.getgid!();
  const launches = path.join(work, "launches");

  /** A stand-in setpriv that answers the identity command with `uid`, then (for anything else) logs the launch and runs it. */
  function standInAnswering(name: string, uid: number): string {
    const dir = path.join(work, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "setpriv"), `#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done; shift\nif [ "$1" = sh ] && [ "$2" = -c ]; then printf '%s\\n' ${uid} ${ownGid} ${ownGid}; exit 0; fi\necho launched >> "${launches}"\nexec "$@"\n`);
    chmodSync(path.join(dir, "setpriv"), 0o755);
    vi.stubEnv("PATH", `${dir}${path.delimiter}${process.env.PATH}`);
    vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
    return dir;
  }
  const launched = () => (existsSync(launches) ? readFileSync(launches, "utf8").split("\n").filter(Boolean).length : 0);
  const reapersStarted = () => (spawned.spy!.mock.calls as unknown[][]).filter((call) => (call[1] as string[]).some((arg) => String(arg).endsWith("reaper.ts"))).length;
  beforeEach(() => {
    rmSync(launches, { force: true });
    spawned.spy!.mockClear();
  });

  for (const [label, uid] of [["user id 0", 0], ["the process's own user id", ownUid]] as const) {
    it(`removes nothing and ends no group when the switched process answers ${label}`, async () => {
      standInAnswering(`bin-refused-${uid}`, uid);
      const tmp = path.join(work, `tmp-refused-${uid}`);
      mkdirSync(path.join(tmp, "owned"), { recursive: true });
      const result = await removeReaderScratch(me, { directory: tmp, ownUid: -1 });
      expect(result).toMatchObject({ ok: true, removed: 0 });
      expect(existsSync(path.join(tmp, "owned"))).toBe(true);
      expect(launched()).toBe(0);

      const child = frozenGroup();
      await reapGroup(me, child.pid!);
      expect(reapersStarted()).toBe(0);
      expect(alive(child.pid!)).toBe(true);
    }, 30_000);
  }

  it("hands the helper that ends a group the user id the switched process reported, not the account file's", async () => {
    const another = beAnotherUserThanTheReaders();
    try {
      const probed = ownUid + 7_777;
      standInAnswering("bin-probed-uid", probed);
      const child = frozenGroup();
      await reapGroup(me, child.pid!);
      const calls = (spawned.spy!.mock.calls as unknown[][]).filter((call) => (call[1] as string[]).some((arg) => String(arg).endsWith("reaper.ts")));
      expect(calls).toHaveLength(1);
      const args = calls[0][1] as string[];
      expect(args[args.length - 1]).toBe(String(probed));
      expect(args[args.length - 1]).not.toBe(String(ownUid));
      expect(args[args.length - 2]).toBe(String(child.pid));
    } finally { another.restore(); }
  }, 30_000);
});
