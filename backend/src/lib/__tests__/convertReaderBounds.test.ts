// How long a conversion that runs as the reader user can hold its admission
// slot: its deadline, plus the bounded wait for the reader's processes to be
// ended, plus the bound on making the reader's scratch directory. Nothing the
// reader does to its own directory or processes lengthens it, and the removal
// of that directory happens after the job has settled.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONCURRENT_CONVERSIONS } from "../conversionLimits";
import { ANSWER_IDENTITY_COMMAND, beAnotherUserThanTheReaders } from "../extraction/__tests__/readerStandIn";

const timing = vi.hoisted(() => ({ timeoutMs: 120_000, reaperEnds: true }));
vi.mock("../runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtimeConfig")>();
  return { ...actual, uploadConversionTimeoutMs: () => timing.timeoutMs };
});
// Where a test needs the group-ending helper to do nothing (a reader that stays
// alive whatever is done to it), it is replaced here; everything else is real.
vi.mock("../extraction/readerUser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../extraction/readerUser")>();
  return { ...actual, reapGroup: (...args: Parameters<typeof actual.reapGroup>) => (timing.reaperEnds ? actual.reapGroup(...args) : Promise.resolve()) };
});

const me = userInfo().username;
let directory: string;
let officeFileToPdf: typeof import("../convert.js").officeFileToPdf;
let REAPER_WAIT_MS: number;
let READER_SCRATCH_CREATE_MS: number;
let READER_SCRATCH_REMOVE_MS: number;

async function standIn(name: string, body: string): Promise<void> {
  await writeFile(join(directory, "bin", name), `#!/bin/sh\n${body}\n`);
  await chmod(join(directory, "bin", name), 0o755);
}
const SOFFICE_WRITES_PDF = `outdir=""; prev=""; for a in "$@"; do [ "$prev" = "--outdir" ] && outdir="$a"; prev="$a"; last="$a"; done
name=$(basename "$last"); name="\${name%.*}"; cp "$last" "$outdir/$name.pdf"`;
/** The stand-in for setpriv: the test host has no reader user. `before` runs, by the name of the command that follows. */
async function setpriv(before: string): Promise<void> {
  await standIn("setpriv", `while [ "$1" != "--" ]; do shift; done; shift\n${ANSWER_IDENTITY_COMMAND}\n${before}\nexec "$@"`);
}
const pending = Symbol("pending");
const within = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => "ok", (error) => error), new Promise((resolve) => setTimeout(() => resolve(pending), ms))]);
const alive = (pid: string) => spawnSync("kill", ["-0", pid]).status === 0;
async function killRecorded(): Promise<void> {
  if (!existsSync(join(directory, "frozen.pid"))) return;
  for (const pid of (await readFile(join(directory, "frozen.pid"), "utf8")).split("\n").filter(Boolean)) {
    const group = spawnSync("ps", ["-o", "pgid=", "-p", pid], { encoding: "utf8" }).stdout.trim();
    if (/^\d+$/.test(group) && Number(group) > 1) spawnSync("kill", ["-KILL", "--", `-${group}`]);
    spawnSync("kill", ["-KILL", pid]);
  }
}

let pretend: { restore: () => void };
beforeEach(async () => {
  pretend = beAnotherUserThanTheReaders();
  directory = await mkdtemp(join(tmpdir(), "mike-convert-bounds-"));
  await mkdir(join(directory, "bin"));
  await mkdir(join(directory, "scratch"));
  await setpriv("");
  await standIn("soffice", SOFFICE_WRITES_PDF);
  vi.stubEnv("EXTRACTION_READER_USER", me);
  vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
  vi.stubEnv("PATH", `${join(directory, "bin")}:${process.env.PATH}`);
  vi.stubEnv("SOFFICE_BINARY_PATH", join(directory, "bin", "soffice"));
  vi.stubEnv("TMPDIR", join(directory, "scratch"));
  await writeFile(join(directory, "source.docx"), "synthetic document bytes");
  timing.reaperEnds = true;
  vi.resetModules();
  ({ officeFileToPdf } = await import("../convert.js"));
  ({ REAPER_WAIT_MS, READER_SCRATCH_CREATE_MS, READER_SCRATCH_REMOVE_MS } = await import("../extraction/readerUser.js"));
});

afterEach(async () => {
  await killRecorded();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  pretend.restore();
  timing.timeoutMs = 120_000;
  timing.reaperEnds = true;
  await rm(directory, { recursive: true, force: true });
});

const convert = (name = "work") => officeFileToPdf(join(directory, "source.docx"), join(directory, name));

describe.skipIf(process.platform !== "linux")("a conversion run as the reader user holds its slot for a bounded time", () => {
  it("ends at its deadline plus the bounded wait when the helper never closes and nothing ends it, and frees every slot", async () => {
    timing.timeoutMs = 2_000;
    timing.reaperEnds = false;
    // The helper ignores its lifeline and every signal; its pipes stay open.
    await setpriv(`case "$*" in *convertChild*) trap '' TERM HUP INT; echo $$ >> "${directory}/frozen.pid"; exec sleep 3600;; esac`);
    const began = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_CONVERSIONS }, (_, index) => within(convert(`stuck-${index}`), timing.timeoutMs + REAPER_WAIT_MS + 3_000)),
    );
    for (const outcome of outcomes) expect(outcome).toMatchObject({ kind: "conversion.timeout", code: "conversion_timeout" });
    expect(Date.now() - began).toBeLessThan(timing.timeoutMs + REAPER_WAIT_MS + 3_000);
    // The slots are free for the next calls, which run to the end.
    await killRecorded();
    await setpriv("");
    timing.timeoutMs = 120_000;
    const next = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_CONVERSIONS }, (_, index) => within(convert(`next-${index}`), 20_000)),
    );
    expect(next).toEqual(Array(MAX_CONCURRENT_CONVERSIONS).fill("ok"));
  }, 90_000);

  it("fails at once, within the creation bound, when the reader's scratch directory cannot be made", async () => {
    await setpriv(`case "$1" in mktemp) echo $$ > "${directory}/frozen.pid"; kill -STOP $$;; esac`);
    const began = Date.now();
    const outcome = await within(convert(), READER_SCRATCH_CREATE_MS + 4_000);
    const took = Date.now() - began;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(new RegExp(`mktemp as the reader did not finish within ${READER_SCRATCH_CREATE_MS} ms`));
    expect(took).toBeGreaterThanOrEqual(READER_SCRATCH_CREATE_MS - 200);
    expect(took).toBeLessThan(READER_SCRATCH_CREATE_MS + 1_500);
    // The frozen helper is ended in the background.
    const pid = (await readFile(join(directory, "frozen.pid"), "utf8")).trim();
    await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
    // And the next conversion runs.
    await setpriv("");
    await expect(within(convert("again"), 20_000)).resolves.toBe("ok");
  }, 60_000);

  it("returns the result and frees the slot without waiting for the removal of the scratch directory, which is bounded and reported once", async () => {
    await setpriv(`case "$1" in rm) echo $$ > "${directory}/frozen.pid"; kill -STOP $$;; esac`);
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((message?: unknown) => { warnings.push(String(message)); });
    const began = Date.now();
    const outcomes = [await within(convert("first"), 8_000), await within(convert("second"), 8_000)];
    expect(outcomes).toEqual(["ok", "ok"]);
    // Two conversions, each with a removal that never ends: far less than one removal bound.
    expect(Date.now() - began).toBeLessThan(READER_SCRATCH_REMOVE_MS - 2_000);
    // Each removal ends at its own bound (the frozen process is killed), and one report is made for both.
    await vi.waitFor(() => expect(warnings.filter((line) => line.includes("could not remove a conversion scratch directory"))).toHaveLength(1), {
      timeout: READER_SCRATCH_REMOVE_MS + 5_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(warnings.filter((line) => line.includes("could not remove a conversion scratch directory"))).toHaveLength(1);
  }, 60_000);
});
