// The start-up check of the user the document readers run as decides from what the
// switched process reports about itself (its user id, group id and supplementary
// groups), not from names or from the API's own reading of the account file.
// The launcher is stubbed: a stand-in setpriv answers what a switched process would.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractionCommand } from "../isolated";
import { activeReaderUser, readerSwitchArgs, readerSwitchProblem } from "../readerUser";
import { readerUserProductionProblem } from "../../runtimeConfig";

const work = mkdtempSync(path.join(tmpdir(), "litt-reader-identity-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());

let counter = 0;
/**
 * A directory with a stand-in `setpriv` (and `prlimit`) that records every launch and,
 * for the identity command, prints `answer` and exits with `status`.
 */
function standIn(answer: string, status = 0): { bin: string; launches: () => string[] } {
  const bin = path.join(work, `bin-${counter++}`);
  mkdirSync(bin);
  const log = path.join(bin, "launches.log");
  writeFileSync(path.join(bin, "setpriv"), [
    "#!/bin/sh",
    `echo "$*" >> "${log}"`,
    'while [ "$1" != "--" ]; do shift; done; shift',
    `case "$1" in true) exit 0;; sh) printf '%b' '${answer}'; exit ${status};; esac`,
    'exec "$@"',
  ].join("\n") + "\n");
  writeFileSync(path.join(bin, "prlimit"), `#!/bin/sh\necho "prlimit $*" >> "${log}"\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec "$@"\n`);
  chmodSync(path.join(bin, "setpriv"), 0o755);
  chmodSync(path.join(bin, "prlimit"), 0o755);
  return { bin, launches: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []) };
}

const ownUid = process.getuid!();
const ownGid = process.getgid!();
const distinct = (own: number) => (own === 48217 ? 48218 : 48217);
const UID = distinct(ownUid);
const GID = distinct(ownGid);
const env = (bin: string, extra: Record<string, string> = {}) =>
  ({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, EXTRACTION_READER_USER: "litt-reader", EXTRACTION_READER_PROCESS_LIMIT: "0", ...extra }) as NodeJS.ProcessEnv;
const answer = (uid: number | string, gid: number | string, groups: string = String(gid)) => `${uid}\\n${gid}\\n${groups}\\n`;

describe.skipIf(process.platform !== "linux")("the user the readers really get, as the switched process reports it", () => {
  const problems: Array<[string, string, number, RegExp]> = [
    ["user id 0", answer(0, GID), 0, /litt-reader.*user id 0/],
    ["the process's own user id", answer(ownUid, GID), 0, /litt-reader.*same numeric user as this process/],
    ["group id 0", answer(UID, 0), 0, /litt-reader.*group id 0/],
    ["the process's own group id", answer(UID, ownGid), 0, /litt-reader.*same group as this process/],
    ["a supplementary group", answer(UID, GID, `${GID} 4242`), 0, /litt-reader.*supplementary group/],
    ["a supplementary group that is group 0", answer(UID, GID, `${GID} 0`), 0, /litt-reader.*supplementary group/],
    ["an answer that is not digits", "root\\n", 0, /litt-reader.*could not be read/],
    ["an answer with a signed number", answer("+10001", GID), 0, /litt-reader.*could not be read/],
    ["an empty answer", "", 0, /litt-reader.*could not be read/],
    ["an answer that is cut short", `${UID}\\n`, 0, /litt-reader.*could not be read/],
    ["a non-zero exit", answer(UID, GID), 3, /could not switch to litt-reader/],
  ];

  for (const [label, text, status, message] of problems) {
    it(`reports a problem for ${label}, and the readers then run as the process's own user`, () => {
      const { bin } = standIn(text, status);
      const e = env(bin);
      const problem = readerSwitchProblem("litt-reader", e);
      expect(problem).toMatch(message);
      expect(problem).not.toContain("\n");
      expect(activeReaderUser(e, "linux")).toBeNull();
      expect(readerUserProductionProblem({ ...e, NODE_ENV: "production", EXTRACTION_ISOLATION: "on" } as NodeJS.ProcessEnv, "linux")).toContain(String(problem));
    });
  }

  it("reports no problem for a distinct unprivileged user and group with no supplementary group, and the readers use the switch", () => {
    const { bin } = standIn(answer(UID, GID));
    const e = env(bin);
    expect(readerSwitchProblem("litt-reader", e)).toBeNull();
    expect(activeReaderUser(e, "linux")).toBe("litt-reader");
    expect(readerUserProductionProblem({ ...e, NODE_ENV: "production", EXTRACTION_ISOLATION: "on" } as NodeJS.ProcessEnv, "linux")).toBeNull();
  });

  it("starts the parser as the process's own user, without the switch, when the identity is a problem", () => {
    const { bin } = standIn(answer(0, GID));
    vi.stubEnv("EXTRACTION_ISOLATION", "on");
    for (const [key, value] of Object.entries(env(bin))) vi.stubEnv(key, value);
    expect(extractionCommand("process.js").args).not.toContain("setpriv");
  });

  it("asks with the arguments a reader launch uses, the process limit included", () => {
    const { bin, launches } = standIn(answer(UID, GID));
    const e = env(bin, { EXTRACTION_READER_PROCESS_LIMIT: "" });
    expect(readerSwitchProblem("litt-reader", e)).toBeNull();
    const [wrapper, switched] = launches();
    expect(wrapper).toMatch(/^prlimit --nproc=\d+:\d+ -- setpriv /);
    expect(switched).toContain(readerSwitchArgs("litt-reader").join(" "));
  });

  it("asks once per process start, however many jobs and checks use the answer", () => {
    const { bin, launches } = standIn(answer(UID, GID));
    const e = env(bin);
    for (let job = 0; job < 40; job += 1) {
      expect(activeReaderUser(e, "linux")).toBe("litt-reader");
      expect(readerSwitchProblem("litt-reader", e)).toBeNull();
    }
    readerUserProductionProblem({ ...e, NODE_ENV: "production", EXTRACTION_ISOLATION: "on" } as NodeJS.ProcessEnv, "linux");
    expect(launches()).toHaveLength(1);
  });

  it("is not decided by the account file: a name the account file lacks, or lists as another id, is judged by the answer", () => {
    const { bin } = standIn(answer(0, GID));
    expect(readerSwitchProblem("tricky-account", env(bin, { EXTRACTION_READER_USER: "tricky-account" }))).toMatch(/user id 0/);
    const good = standIn(answer(UID, GID));
    expect(readerSwitchProblem("root", env(good.bin, { EXTRACTION_READER_USER: "root" }))).toBeNull();
  });
});
