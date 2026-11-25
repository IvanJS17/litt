// The two LibreOffice paths run a real (fake) converter process that records
// the environment it was started with: no backend credential may be in it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FAKE_SECRETS: Record<string, string> = {
  SUPABASE_SECRET_KEY: "fake-supabase-secret-not-real",
  SUPABASE_SERVICE_ROLE_KEY: "fake-service-role-not-real",
  DATABASE_URL: "postgres://fake:fake@localhost/fake",
  R2_SECRET_ACCESS_KEY: "fake-r2-secret-not-real",
  ANTHROPIC_API_KEY: "fake-anthropic-key-not-real",
  OPENAI_API_KEY: "fake-openai-key-not-real",
  USER_API_KEYS_ENCRYPTION_SECRET: "fake-encryption-secret-not-real",
  MCP_CONNECTORS_ENCRYPTION_SECRET: "fake-connector-secret-not-real",
};

let dir: string;
let record: string;

// Writes its environment to a file, then the PDF the caller expects: the
// output directory follows --outdir and the name follows the last argument.
function writeFakeConverter(): string {
  const script = path.join(dir, "fake-soffice");
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      `/usr/bin/env > '${record}'`,
      'out=""; prev=""; last=""',
      'for a in "$@"; do',
      '  if [ "$prev" = "--outdir" ]; then out="$a"; fi',
      '  prev="$a"; last="$a"',
      "done",
      'base=$(basename "$last"); stem="${base%.*}"',
      'printf "%%PDF-1.4 synthetic" > "$out/$stem.pdf"',
      // The library asks for ".pdf" and reads "<name>..pdf".
      'printf "%%PDF-1.4 synthetic" > "$out/$stem..pdf"',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return script;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "litt-child-env-"));
  record = path.join(dir, "recorded-env.txt");
  for (const [name, value] of Object.entries(FAKE_SECRETS)) vi.stubEnv(name, value);
  vi.stubEnv("SOFFICE_BINARY_PATH", writeFakeConverter());
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function recordedNames(): string[] {
  return fs.readFileSync(record, "utf8").split("\n").filter(Boolean).map((line) => line.split("=")[0]);
}

function expectMinimal() {
  const text = fs.readFileSync(record, "utf8");
  const names = recordedNames();
  for (const name of Object.keys(FAKE_SECRETS)) expect(names, name).not.toContain(name);
  expect(text).not.toContain("not-real");
  expect(names).toContain("PATH");
}

describe.skipIf(process.platform === "win32" || !fs.existsSync("/usr/bin/env"))("converter process environment", () => {
  it("officeFileToPdf starts the converter without the backend's credentials", async () => {
    const { officeFileToPdf } = await import("../convert.js");
    const input = path.join(dir, "synthetic.docx");
    fs.writeFileSync(input, "synthetic");
    const pdf = await officeFileToPdf(input, path.join(dir, "out"));
    expect(fs.readFileSync(pdf, "utf8")).toContain("%PDF");
    expectMinimal();
  });

  it("docxToPdf starts the converter without the backend's credentials", async () => {
    const { docxToPdf } = await import("../convert.js");
    const pdf = await docxToPdf(Buffer.from("synthetic"));
    expect(pdf.toString()).toContain("%PDF");
    expectMinimal();
  });
});

// Keeps the helper import honest for the sanity check below.
it("the fake converter itself is runnable (sanity)", () => {
  if (process.platform === "win32") return;
  const result = spawnSync(writeFakeConverter(), ["--outdir", dir, path.join(dir, "x.docx")]);
  expect(result.status).toBe(0);
  expect(fs.existsSync(path.join(dir, "x.pdf"))).toBe(true);
});
