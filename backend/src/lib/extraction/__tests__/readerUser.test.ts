import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractionCommand } from "../isolated";
import { inheritsCapabilities, launchChild } from "../readerUser";

// A stand-in for util-linux setpriv: succeeds, or fails like a host where the
// process may not change user. It runs whatever follows "--" when asked to.
const dir = mkdtempSync(path.join(tmpdir(), "mike-setpriv-"));
function stand(name: string, body: string): string {
  const bin = path.join(dir, name);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "setpriv"), `#!/bin/sh\n${body}\n`);
  chmodSync(path.join(bin, "setpriv"), 0o755);
  return bin;
}
const works = stand("works", "exit 0");
const refuses = stand("refuses", "echo 'setresuid failed: Operation not permitted' >&2; exit 1");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

const SWITCH = ["--reuid", "litt-reader", "--regid", "litt-reader", "--clear-groups", "--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--"];

describe.skipIf(process.platform !== "linux")("launching the parser as its own user", () => {
  it("runs the parser under setpriv as the reader, holding no capability and unable to gain one", () => {
    const { command, args } = extractionCommand("process.js", "litt-reader");
    expect(command).toBe("prlimit");
    const at = args.indexOf("setpriv");
    expect(args.slice(args.indexOf("--") + 1, at)).toEqual([]);
    expect(args.slice(at + 1, at + 1 + SWITCH.length)).toEqual(SWITCH);
    expect(args[at + 1 + SWITCH.length]).toBe(process.execPath);
    expect(args.at(-1)).toBe("process.js");
  });

  it("keeps the limits ahead of the switch, so they bind the reader", () => {
    const { args } = extractionCommand("process.js", "litt-reader");
    expect(args.slice(0, 3).map((a) => a.split("=")[0])).toEqual(["--data", "--as", "--core"]);
  });

  it("starts the parser directly when no reader user is given", () => {
    const { args } = extractionCommand("process.js", null);
    expect(args).not.toContain("setpriv");
    expect(args).toContain(process.execPath);
  });

  it("switches when EXTRACTION_READER_USER names a user the host can switch to", () => {
    vi.stubEnv("EXTRACTION_READER_USER", "litt-reader");
    vi.stubEnv("PATH", `${works}${path.delimiter}${process.env.PATH}`);
    expect(extractionCommand("process.js").args).toContain("setpriv");
  });

  it("runs as today when the host cannot switch user", () => {
    vi.stubEnv("EXTRACTION_READER_USER", "litt-reader");
    vi.stubEnv("PATH", `${refuses}${path.delimiter}${process.env.PATH}`);
    expect(extractionCommand("process.js").args).not.toContain("setpriv");
  });

  it("runs as today when no reader user is configured", () => {
    vi.stubEnv("EXTRACTION_READER_USER", "");
    expect(extractionCommand("process.js").args).not.toContain("setpriv");
  });
});

describe("the one launcher for every child process", () => {
  it("starts a process that opens uploaded content as the reader, whatever the API holds", () => {
    for (const capabilitiesHeld of [true, false]) {
      expect(launchChild("soffice", ["--headless"], { asReader: "litt-reader", capabilitiesHeld })).toEqual({
        command: "setpriv",
        args: [...SWITCH, "soffice", "--headless"],
      });
    }
  });

  it("starts any other process with every inheritable and ambient capability dropped and none to gain", () => {
    expect(launchChild("tool", ["a"], { capabilitiesHeld: true })).toEqual({
      command: "setpriv",
      args: ["--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--", "tool", "a"],
    });
  });

  it("starts a process as it is when there is nothing to drop", () => {
    expect(launchChild("tool", ["a"], { capabilitiesHeld: false })).toEqual({ command: "tool", args: ["a"] });
  });

  it("tells a process that holds ambient capabilities from one that holds none", () => {
    const status = (inh: string, amb: string) => `CapInh:\t${inh}\nCapPrm:\t00000000000000c0\nCapEff:\t00000000000000c0\nCapBnd:\t00000000000000c0\nCapAmb:\t${amb}\n`;
    expect(inheritsCapabilities(status("0000000000000000", "00000000000000c0"))).toBe(true);
    expect(inheritsCapabilities(status("00000000000000c0", "0000000000000000"))).toBe(false);
    expect(inheritsCapabilities(status("0000000000000000", "0000000000000000"))).toBe(false);
    expect(inheritsCapabilities("")).toBe(false);
  });
});
