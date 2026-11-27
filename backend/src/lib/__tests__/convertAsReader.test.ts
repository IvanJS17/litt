import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timing = vi.hoisted(() => ({ timeoutMs: 120_000 }));
vi.mock("../runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtimeConfig")>();
  return { ...actual, uploadConversionTimeoutMs: () => timing.timeoutMs };
});

// Stand-ins: setpriv records its arguments and runs what follows "--" (the test
// host has no reader user); soffice writes a PDF next to --outdir, or fails.
let directory: string;
let officeFileToPdf: typeof import("../convert.js").officeFileToPdf;

async function standIn(name: string, body: string): Promise<void> {
  await writeFile(join(directory, "bin", name), `#!/bin/sh\n${body}\n`);
  await chmod(join(directory, "bin", name), 0o755);
}

const SOFFICE_WRITES_PDF = `outdir=""; prev=""; for a in "$@"; do [ "$prev" = "--outdir" ] && outdir="$a"; prev="$a"; last="$a"; done
name=$(basename "$last"); name="\${name%.*}"; cp "$last" "$outdir/$name.pdf"`;

// The tsx loader keeps its own cache in the temporary directory; only what the conversion made counts.
async function leftovers(): Promise<string[]> {
  return (await readdir(join(directory, "scratch"))).filter((name) => name.startsWith("litt-convert-"));
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mike-convert-reader-"));
  await mkdir(join(directory, "bin"));
  await mkdir(join(directory, "scratch"));
  await standIn("setpriv", `echo "$@" >> "${directory}/setpriv.log"\nwhile [ "$1" != "--" ]; do shift; done; shift; exec "$@"`);
  await standIn("soffice", SOFFICE_WRITES_PDF);
  vi.stubEnv("EXTRACTION_READER_USER", "litt-reader");
  vi.stubEnv("PATH", `${join(directory, "bin")}:${process.env.PATH}`);
  vi.stubEnv("SOFFICE_BINARY_PATH", join(directory, "bin", "soffice"));
  vi.stubEnv("TMPDIR", join(directory, "scratch"));
  await writeFile(join(directory, "source.docx"), "synthetic document bytes");
  vi.resetModules();
  ({ officeFileToPdf } = await import("../convert.js"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  timing.timeoutMs = 120_000;
  await rm(directory, { recursive: true, force: true });
});

describe.skipIf(process.platform !== "linux")("office conversion as the reader user", () => {
  it("runs the conversion as the reader, returns the PDF to the caller's directory and leaves no scratch behind", async () => {
    const out = join(directory, "work");
    const pdf = await officeFileToPdf(join(directory, "source.docx"), out);
    expect(pdf).toBe(join(out, "source.pdf"));
    expect(await readFile(pdf, "utf8")).toBe("synthetic document bytes");
    const calls = (await readFile(join(directory, "setpriv.log"), "utf8")).split("\n").filter(Boolean);
    expect(calls.some((line) => line.startsWith("--reuid litt-reader --regid litt-reader --clear-groups --inh-caps -all --ambient-caps -all --no-new-privs -- "))).toBe(true);
    expect(await leftovers()).toEqual([]);
    expect(await readdir(out)).toEqual(["source.pdf"]);
  }, 60_000);

  it("converts a file whatever its name is and returns the PDF under the name callers expect", async () => {
    const names = ["Contrato de arrendamiento año 2.1.final.docx", "-.hidden file ñ.pptx", "résumé (copy) #3.doc", "no-extension"];
    for (const name of names) {
      await writeFile(join(directory, name), `bytes of ${name}`);
      const out = join(directory, "work", String(names.indexOf(name)));
      const pdf = await officeFileToPdf(join(directory, name), out);
      expect(pdf).toBe(join(out, `${parse(name).name}.pdf`));
      expect(await readFile(pdf, "utf8")).toBe(`bytes of ${name}`);
    }
    expect(await leftovers()).toEqual([]);
  }, 60_000);

  it("reports a document LibreOffice rejects as a conversion with no output", async () => {
    await standIn("soffice", "exit 0");
    const failure = await officeFileToPdf(join(directory, "source.docx"), join(directory, "work")).catch((error) => error);
    expect(failure).toMatchObject({ kind: "conversion.no_output", code: "conversion_failed" });
    expect(await leftovers()).toEqual([]);
  }, 60_000);

  it("reports a failing LibreOffice as a failed conversion", async () => {
    await standIn("soffice", "echo broken >&2; exit 4");
    const failure = await officeFileToPdf(join(directory, "source.docx"), join(directory, "work")).catch((error) => error);
    expect(failure).toMatchObject({ kind: "conversion.failed", code: "conversion_failed" });
  }, 60_000);

  it("ends LibreOffice and its helper at the deadline", async () => {
    timing.timeoutMs = 6_000;
    await standIn("soffice", `echo $$ > "${directory}/soffice.pid"\nexec sleep 31`);
    const failure = await officeFileToPdf(join(directory, "source.docx"), join(directory, "work")).catch((error) => error);
    expect(failure).toMatchObject({ kind: "conversion.timeout", code: "conversion_timeout" });
    if (existsSync(join(directory, "soffice.pid"))) {
      const pid = (await readFile(join(directory, "soffice.pid"), "utf8")).trim();
      expect(spawnSync("kill", ["-0", pid]).status).not.toBe(0);
    }
    expect(await leftovers()).toEqual([]);
  }, 60_000);
});
