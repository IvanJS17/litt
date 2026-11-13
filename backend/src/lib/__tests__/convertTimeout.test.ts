import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import fs, { existsSync } from "node:fs";
import { diagnosticErrorTags } from "../observability/diagnostics";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const timing = vi.hoisted(() => ({ timeoutMs: 200 }));

vi.mock("../runtimeConfig", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runtimeConfig")>();
  return { ...actual, uploadConversionTimeoutMs: () => timing.timeoutMs };
});

let directory: string;
let officeFileToPdf: typeof import("../convert.js").officeFileToPdf;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "mike-convert-test-"));
  // Stand in for a soffice process that never exits.
  const binary = join(directory, "soffice");
  // Replace the shell with the sleeper so SIGKILL targets the process holding
  // the stdio pipes too. Otherwise the orphaned `sleep` keeps stderr open and
  // Node cannot emit `close` until the full 30 seconds have elapsed.
  await writeFile(binary, "#!/bin/sh\nexec sleep 30\n");
  await chmod(binary, 0o755);
  process.env.SOFFICE_BINARY_PATH = binary;
  vi.resetModules();
  ({ officeFileToPdf } = await import("../convert.js"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  timing.timeoutMs = 200;
  delete process.env.SOFFICE_BINARY_PATH;
  await rm(directory, { recursive: true, force: true });
});

describe("office conversion deadline", () => {
  it("kills a conversion that outlives its deadline and removes its profile", async () => {
    const outputDirectory = join(directory, "work");
    const startedAt = Date.now();

    const failure = await officeFileToPdf(
      join(directory, "source.docx"),
      outputDirectory,
    ).catch((error) => error);
    expect(failure.message).toMatch(/timed out after 200ms/);
    expect(diagnosticErrorTags(failure)).toEqual({
      error_kind: "conversion.timeout",
      failure_code: "conversion_timeout",
    });

    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(existsSync(join(outputDirectory, "libreoffice-profile"))).toBe(
      false,
    );
  });
});

it("distinguishes an unavailable converter from a rejected document without stderr", async () => {
  timing.timeoutMs = 5000;
  await writeFile(
    join(directory, "soffice"),
    '#!/bin/sh\necho "PRIVATE_DOCUMENT" >&2\nexit 1\n',
  );
  const failure = await officeFileToPdf(
    join(directory, "PRIVATE_DOCUMENT.docx"),
    join(directory, "work"),
  ).catch((error) => error);
  expect(diagnosticErrorTags(failure)).toEqual({
    error_kind: "conversion.failed",
    failure_code: "conversion_failed",
  });
  vi.resetModules();
  vi.spyOn(fs, "accessSync").mockImplementation(() => {
    throw new Error("missing");
  });
  const converter = await import("../convert.js");
  const missing = await converter
    .officeFileToPdf("PRIVATE_DOCUMENT.docx", directory)
    .catch((error) => error);
  expect(diagnosticErrorTags(missing)).toEqual({
    error_kind: "conversion.unavailable",
    failure_code: "conversion_unavailable",
  });
});

// MIKE-BACKEND-M: soffice can exit 0 without writing a PDF (it prints
// "Error: source file could not be loaded" to stderr and still succeeds).
// The follow-up access() then threw a bare ENOENT whose top frame was the
// access call, so the issue read as a missing file rather than a rejected
// conversion and the operator log lost LibreOffice's own explanation.
it("reports a clean soffice exit that wrote no PDF as a failed conversion", async () => {
  timing.timeoutMs = 5000;
  await writeFile(
    join(directory, "soffice"),
    '#!/bin/sh\necho "Error: source file could not be loaded" >&2\nexit 0\n',
  );
  const failure = await officeFileToPdf(
    join(directory, "PRIVATE_DOCUMENT.docx"),
    join(directory, "work"),
  ).catch((error) => error);
  expect(failure).toBeInstanceOf(Error);
  // Same legacy code as a non-zero exit; its own kind tells the two apart.
  expect(diagnosticErrorTags(failure)).toEqual({
    error_kind: "conversion.no_output",
    failure_code: "conversion_failed",
  });
  // Operator log keeps LibreOffice's reason; the missing-file error is the cause.
  expect(failure.message).toContain("source file could not be loaded");
  expect(failure.cause).toMatchObject({ code: "ENOENT" });
});

describe("docxToPdf deadline", () => {
  it("cuts a LibreOffice that never finishes, with a ConversionError", async () => {
    const { docxToPdf, ConversionError } = await import("../convert.js");
    const startedAt = Date.now();
    const failure = await docxToPdf(Buffer.from("not a real docx")).catch((error) => error);
    expect(failure).toBeInstanceOf(ConversionError);
    expect(diagnosticErrorTags(failure)).toEqual({
      error_kind: "conversion.timeout",
      failure_code: "conversion_timeout",
    });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  });
});

describe("docxToPdf deadline when soffice mentions an error", () => {
  it("is still a conversion.timeout, not conversion.failed", async () => {
    // libreoffice-convert swallows execFile's timeout error when stderr has "error".
    await writeFile(join(directory, "soffice"), '#!/bin/sh\necho "error: wedged" >&2\nexec sleep 30\n');
    const { docxToPdf } = await import("../convert.js");
    const failure = await docxToPdf(Buffer.from("not a real docx")).catch((error) => error);
    expect(diagnosticErrorTags(failure)).toEqual({
      error_kind: "conversion.timeout",
      failure_code: "conversion_timeout",
    });
  });
});

describe("officeFileToPdf deadline", () => {
  it("kills the whole process group, not only the direct child", async () => {
    const pidFile = join(directory, "grandchild.pid");
    await writeFile(join(directory, "soffice"), `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`);
    const failure = await officeFileToPdf(join(directory, "source.docx"), join(directory, "work")).catch((e) => e);
    expect(diagnosticErrorTags(failure).error_kind).toBe("conversion.timeout");
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    let alive = true;
    for (let i = 0; i < 20 && alive; i++) {
      try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 50)); } catch { alive = false; }
    }
    if (alive) process.kill(pid, "SIGKILL");
    expect(alive).toBe(false);
  });
});
