// Every process the backend starts gets an explicit environment built by
// `lib/childEnv.ts`. This scan fails when a production file loads a module that
// starts processes and is not on the list below, so a new spawn cannot quietly
// inherit the backend's whole environment. It does not check each call inside a
// listed file: the real-process tests of those files do.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

// Files that start processes, each with the environment it passes.
const ALLOWED: Record<string, string> = {
  "lib/convert.ts": "LibreOffice spawn and library execOptions: childProcessEnv()",
  "lib/extraction/isolated.ts": "parser spawn: childProcessEnv() plus scratch dir; taskkill (Windows only) carries no secrets of its own",
  "lib/integrations/googleDriveExtract.ts": "Drive reader fork: childProcessEnv({ NODE_ENV })",
};

// A file can only start a process by loading one of these modules, whatever
// the quoting or the import form.
const PROCESS_MODULE = /["'`](?:(?:node:)?child_process|cross-spawn|execa)["'`]/;

export function startsProcess(source: string): boolean {
  return PROCESS_MODULE.test(source);
}

function productionFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      productionFiles(full, out);
    } else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(entry) && !/\.d\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) {
      out.push(relative(SRC, full).split(sep).join("/"));
    }
  }
  return out;
}

describe("child processes", () => {
  it("the scan flags a file that starts a process", () => {
    expect(startsProcess('import { spawn } from "node:child_process";\nspawn("tool", []);')).toBe(true);
    expect(startsProcess('const { execFile } = require("child_process");')).toBe(true);
    expect(startsProcess("const cp = await import(`node:child_process`);\ncp.spawn(\"tool\", []);")).toBe(true);
    expect(startsProcess('import spawn from "cross-spawn";\nspawn("tool", []);')).toBe(true);
    expect(startsProcess('import { execa } from "execa";\nawait execa("tool");')).toBe(true);
    expect(startsProcess("const x = /a/.exec(text);")).toBe(false);
  });

  it("only listed files start processes", () => {
    const found = productionFiles(SRC).filter((file) => startsProcess(readFileSync(join(SRC, file), "utf8")));
    const unlisted = found.filter((file) => !(file in ALLOWED));
    expect(unlisted, "start processes with childProcessEnv() and list the file here").toEqual([]);
    expect(Object.keys(ALLOWED).filter((file) => !found.includes(file))).toEqual([]);
  });

  it("each listed file uses the shared environment helper", () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(readFileSync(join(SRC, file), "utf8"), file).toContain("childProcessEnv(");
    }
  });
});
