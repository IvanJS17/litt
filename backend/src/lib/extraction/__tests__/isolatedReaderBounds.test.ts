// How long a parse run as the reader user can hold the parser slot: its
// deadline plus the bounded wait for the reader's processes to be ended, and
// the bound on making the reader's scratch directory. The parser need not close
// for the job to settle, and the next job gets a new parser.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as XLSX from "xlsx";
import { ExtractionLimitError, runIsolatedExtraction, stopExtractionProcess } from "../isolated";

const reaper = vi.hoisted(() => ({ ends: true }));
// Where a test needs the group-ending helper to do nothing (a reader that stays
// alive whatever is done to it), it is replaced here; everything else is real.
vi.mock("../readerUser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../readerUser")>();
  return { ...actual, reapGroup: (...args: Parameters<typeof actual.reapGroup>) => (reaper.ends ? actual.reapGroup(...args) : Promise.resolve()) };
});
import { READER_SCRATCH_CREATE_MS, REAPER_WAIT_MS } from "../readerUser";
import { ANSWER_IDENTITY_COMMAND, beAnotherUserThanTheReaders } from "./readerStandIn";

function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Item", "Amount"], ["Rent", 1200]]), "Budget");
  return Uint8Array.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer).buffer;
}

const work = mkdtempSync(path.join(os.tmpdir(), "mike-parser-bounds-"));
const bin = path.join(work, "bin");
const freezeParser = path.join(work, "freeze-parser");
const freezeMktemp = path.join(work, "freeze-mktemp");
const pidFile = path.join(work, "frozen.pid");
mkdirSync(bin);
// Stand-in setpriv (the test host has no reader user): the short helpers run, the parser or mktemp can be made to stop itself.
writeFileSync(path.join(bin, "setpriv"), [
  "#!/bin/sh",
  'while [ "$1" != "--" ]; do shift; done; shift',
  ANSWER_IDENTITY_COMMAND,
  `if [ "$1" = mktemp ] && [ -e "${freezeMktemp}" ]; then echo $$ > "${pidFile}"; kill -STOP $$; fi`,
  `case "$1" in true|mktemp|rm|find) exec "$@";; esac`,
  `if [ -e "${freezeParser}" ]; then trap '' TERM HUP INT; echo $$ > "${pidFile}"; kill -STOP $$; sleep 3600; fi`,
  'exec "$@"',
].join("\n") + "\n");
chmodSync(path.join(bin, "setpriv"), 0o755);

const alive = (pid: string) => spawnSync("kill", ["-0", pid]).status === 0;
const pending = Symbol("pending");
const settled = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then((value) => value, (error) => error), new Promise((resolve) => setTimeout(() => resolve(pending), ms))]);

let pretend: { restore: () => void };
beforeEach(() => {
  pretend = beAnotherUserThanTheReaders();
  vi.stubEnv("EXTRACTION_ISOLATION", "on");
  vi.stubEnv("EXTRACTION_READER_USER", os.userInfo().username);
  vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
  vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
  for (const file of [freezeParser, freezeMktemp, pidFile]) rmSync(file, { force: true });
  reaper.ends = true;
});
afterEach(async () => {
  await stopExtractionProcess();
  if (existsSync(pidFile)) {
    const pid = readFileSync(pidFile, "utf8").trim();
    const group = spawnSync("ps", ["-o", "pgid=", "-p", pid], { encoding: "utf8" }).stdout.trim();
    if (/^\d+$/.test(group) && Number(group) > 1) spawnSync("kill", ["-KILL", "--", `-${group}`]);
    spawnSync("kill", ["-KILL", pid]);
  }
  vi.unstubAllEnvs();
  pretend.restore();
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

describe.skipIf(process.platform !== "linux")("a parse run as the reader user holds the parser slot for a bounded time", () => {
  it("settles at its deadline plus the bounded wait when the parser never closes and nothing ends it, and the next job gets a new parser", async () => {
    reaper.ends = false;
    writeFileSync(freezeParser, "");
    vi.stubEnv("EXTRACTION_TIMEOUT_MS", "500");
    const began = Date.now();
    const outcome = await settled(runIsolatedExtraction("spreadsheet", async () => workbook()), 500 + REAPER_WAIT_MS + 3_000);
    expect(outcome).toBeInstanceOf(ExtractionLimitError);
    expect((outcome as Error).message).toContain("parser deadline exceeded");
    expect(Date.now() - began).toBeLessThan(500 + REAPER_WAIT_MS + 3_000);
    const frozen = readFileSync(pidFile, "utf8").trim();
    expect(alive(frozen)).toBe(true);
    rmSync(freezeParser);
    vi.stubEnv("EXTRACTION_TIMEOUT_MS", "60000");
    await expect(settled(runIsolatedExtraction("spreadsheet", async () => workbook()), 30_000)).resolves.toEqual(expect.stringContaining("Rent"));
  }, 90_000);

  it("fails at once, within the creation bound, when the reader's scratch directory cannot be made, and the next job runs", async () => {
    writeFileSync(freezeMktemp, "");
    const began = Date.now();
    const outcome = await settled(runIsolatedExtraction("spreadsheet", async () => workbook()), READER_SCRATCH_CREATE_MS + 4_000);
    const took = Date.now() - began;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(new RegExp(`mktemp as the reader did not finish within ${READER_SCRATCH_CREATE_MS} ms`));
    expect(took).toBeGreaterThanOrEqual(READER_SCRATCH_CREATE_MS - 200);
    expect(took).toBeLessThan(READER_SCRATCH_CREATE_MS + 1_500);
    rmSync(freezeMktemp);
    await expect(settled(runIsolatedExtraction("spreadsheet", async () => workbook()), 30_000)).resolves.toEqual(expect.stringContaining("Rent"));
  }, 90_000);
});
