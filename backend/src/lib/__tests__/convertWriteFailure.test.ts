// A conversion run as the reader user returns the PDF its helper made by
// writing it to the caller's directory. When that write cannot be finished
// (disk full, I/O error) the conversion fails like any failed conversion: no
// truncated file is returned or left, and the slot goes to the next job.
import fs from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CONCURRENT_CONVERSIONS } from "../conversionLimits";

const timing = vi.hoisted(() => ({ timeoutMs: 120_000 }));
vi.mock("../runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtimeConfig")>();
  return { ...actual, uploadConversionTimeoutMs: () => timing.timeoutMs };
});

const me = userInfo().username;
let directory: string;
let officeFileToPdf: typeof import("../convert.js").officeFileToPdf;
let REAPER_WAIT_MS: number;

async function standIn(name: string, body: string): Promise<void> {
  await writeFile(join(directory, "bin", name), `#!/bin/sh\n${body}\n`);
  await chmod(join(directory, "bin", name), 0o755);
}
const SOFFICE_WRITES_PDF = `outdir=""; prev=""; for a in "$@"; do [ "$prev" = "--outdir" ] && outdir="$a"; prev="$a"; last="$a"; done
name=$(basename "$last"); name="\${name%.*}"; cp "$last" "$outdir/$name.pdf"`;

/** The output file as a stream that stores what it is given and then cannot finish. */
function failingAfterSomeBytes(path: string, how: "error" | "never"): Writable {
  return new Writable({
    write(chunk, _encoding, done) {
      fs.appendFileSync(path, chunk);
      done();
    },
    final(done) {
      if (how === "error") done(Object.assign(new Error("no space left on device"), { code: "ENOSPC" }));
      // "never": the write does not end, whatever is done
    },
  });
}
function breakOutputWrites(how: "error" | "never"): void {
  vi.spyOn(fs, "createWriteStream").mockImplementation(((path: fs.PathLike) => failingAfterSomeBytes(String(path), how)) as unknown as typeof fs.createWriteStream);
}

const convert = (name = "work") => officeFileToPdf(join(directory, "source.docx"), join(directory, name));
const pending = Symbol("pending");
const within = (promise: Promise<unknown>, ms: number) =>
  Promise.race([promise.then(() => "ok", (error) => error), new Promise((resolve) => setTimeout(() => resolve(pending), ms))]);
async function leftovers(): Promise<string[]> {
  const present = async () => (await readdir(join(directory, "scratch"))).filter((name) => name.startsWith("litt-convert-"));
  await vi.waitFor(async () => expect(await present()).toEqual([]), { timeout: 5_000 }).catch(() => {});
  return present();
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mike-convert-write-"));
  await mkdir(join(directory, "bin"));
  await mkdir(join(directory, "scratch"));
  await standIn("setpriv", `while [ "$1" != "--" ]; do shift; done; shift\nexec "$@"`);
  await standIn("soffice", SOFFICE_WRITES_PDF);
  vi.stubEnv("EXTRACTION_READER_USER", me);
  vi.stubEnv("EXTRACTION_READER_PROCESS_LIMIT", "0");
  vi.stubEnv("PATH", `${join(directory, "bin")}:${process.env.PATH}`);
  vi.stubEnv("SOFFICE_BINARY_PATH", join(directory, "bin", "soffice"));
  vi.stubEnv("TMPDIR", join(directory, "scratch"));
  await writeFile(join(directory, "source.docx"), "synthetic document bytes");
  vi.resetModules();
  ({ officeFileToPdf } = await import("../convert.js"));
  ({ REAPER_WAIT_MS } = await import("../extraction/readerUser.js"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  timing.timeoutMs = 120_000;
  await rm(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "linux")("a conversion whose PDF cannot be fully written", () => {
  it("fails as a failed conversion, leaves no output file, and the slots take the next jobs", async () => {
    breakOutputWrites("error");
    const failure = await convert("broken").catch((error) => error);
    expect(failure).toMatchObject({ kind: "conversion.failed", code: "conversion_failed" });
    expect(fs.existsSync(join(directory, "broken", "source.pdf"))).toBe(false);
    expect(await leftovers()).toEqual([]);

    vi.restoreAllMocks();
    const next = await Promise.all(Array.from({ length: MAX_CONCURRENT_CONVERSIONS }, (_, index) => within(convert(`next-${index}`), 20_000)));
    expect(next).toEqual(Array(MAX_CONCURRENT_CONVERSIONS).fill("ok"));
  }, 60_000);

  it("does not wait past its bound for a write that never ends", async () => {
    timing.timeoutMs = 2_000;
    breakOutputWrites("never");
    const outcome = await within(convert("stuck"), timing.timeoutMs + REAPER_WAIT_MS + 3_000);
    expect(outcome).toMatchObject({ kind: "conversion.timeout", code: "conversion_timeout" });
    expect(fs.existsSync(join(directory, "stuck", "source.pdf"))).toBe(false);
    expect(await leftovers()).toEqual([]);
  }, 60_000);
});
