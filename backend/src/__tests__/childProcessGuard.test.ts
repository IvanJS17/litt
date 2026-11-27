// Every process the backend starts gets an explicit environment built by
// `lib/childEnv.ts`, and is started through `launchChild()` of
// `lib/extraction/readerUser.ts`: as the reader user when it opens content a
// person uploaded or linked, otherwise with every inheritable capability
// dropped. This scan fails when a production file loads a module that starts
// processes and is not on the list below, or when a listed file does not use
// the launcher, so a new spawn cannot quietly inherit the backend's whole
// environment or the capabilities the API keeps. It does not check each call
// inside a listed file: the real-process tests of those files do.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

// Files that start processes, each with the environment it passes.
const ALLOWED: Record<string, string> = {
  "lib/convert.ts": "LibreOffice and the conversion helper (reader user): launchChild(), childProcessEnv()",
  "lib/extraction/isolated.ts": "parser spawn (reader user): launchChild(), childProcessEnv() plus scratch dir; taskkill (Windows only) carries no secrets of its own",
  "lib/extraction/readerUser.ts": "the launcher itself, the scratch directory helpers (childProcessEnv()), the helper that ends a reader's process group (empty environment) and the startup probe (PATH only)",
  "lib/integrations/googleDriveExtract.ts": "Drive reader fork (reader user): launchChild(), childProcessEnv({ NODE_ENV })",
};

// A file can only start a process by loading one of these modules, whatever
// the quoting or the import form.
const PROCESS_MODULE = /["'`](?:(?:node:)?child_process|cross-spawn|execa)["'`]/;

export function startsProcess(source: string): boolean {
  return PROCESS_MODULE.test(source);
}

const LAUNCHER_FILE = "lib/extraction/readerUser.ts";

/** True when a file that starts processes does so without the shared launcher. */
export function startsOutsideLauncher(source: string): boolean {
  return startsProcess(source) && !/\blaunchChild\(/.test(source);
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

  it("the scan flags a file that starts a process without the shared launcher", () => {
    expect(startsOutsideLauncher('import { spawn } from "node:child_process";\nspawn("tool", []);')).toBe(true);
    expect(startsOutsideLauncher('import { fork } from "node:child_process";\nconst l = launchChild(node, []);\nfork("m", [], {});')).toBe(false);
    expect(startsOutsideLauncher("const x = 1;")).toBe(false);
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

  it("only the launcher's own helper starts anything with the capabilities the API keeps, and no other file asks for that", () => {
    // `reaper: true` is the one mode of launchChild() that does not drop them: the
    // small helper that ends a reader's process group (lib/extraction/reaper.ts).
    const asking = productionFiles(SRC).filter((file) => /\breaper:\s*true\b/.test(readFileSync(join(SRC, file), "utf8")));
    expect(asking).toEqual([LAUNCHER_FILE]);
    const launcher = readFileSync(join(SRC, LAUNCHER_FILE), "utf8");
    expect(launcher.match(/\breaper:\s*true\b/g)).toHaveLength(1);
    // the helper itself starts no process
    expect(startsProcess(readFileSync(join(SRC, "lib/extraction/reaper.ts"), "utf8"))).toBe(false);
  });

  it("every file that starts a process goes through the shared launcher", () => {
    const outside = Object.keys(ALLOWED).filter(
      (file) => file !== LAUNCHER_FILE && startsOutsideLauncher(readFileSync(join(SRC, file), "utf8")),
    );
    expect(outside, "start processes with launchChild() from lib/extraction/readerUser.ts").toEqual([]);
    expect(readFileSync(join(SRC, LAUNCHER_FILE), "utf8")).toContain("export function launchChild(");
  });
});
