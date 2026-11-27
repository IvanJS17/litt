import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The container starts as root only to drop to the API's user, which needs the
// set-user and set-group capabilities. Without them it says why, in one line.
const entrypoint = path.resolve(__dirname, "../../docker-entrypoint.sh");
const effective = /^CapEff:\s*([0-9a-f]+)/m.exec(readFileSync("/proc/self/status", "utf8"))?.[1] ?? "";
const hasSwitchCapabilities = effective !== "" && (Number.parseInt(effective.slice(-2), 16) & 0xc0) === 0xc0;

describe.skipIf(process.platform !== "linux" || hasSwitchCapabilities)("the container entrypoint without the set-user and set-group capabilities", () => {
  it("names the missing capabilities and exits non-zero before starting anything", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mike-entrypoint-"));
    try {
      // The test host is not root: an `id` that says it is, and a `setpriv` that must not run.
      writeFileSync(path.join(dir, "id"), "#!/bin/sh\necho 0\n");
      writeFileSync(path.join(dir, "setpriv"), `#!/bin/sh\ntouch "${dir}/setpriv-ran"\n`);
      chmodSync(path.join(dir, "id"), 0o755);
      chmodSync(path.join(dir, "setpriv"), 0o755);
      const result = spawnSync("sh", [entrypoint, "true"], { encoding: "utf8", env: { PATH: `${dir}:${process.env.PATH}` } });
      expect(result.status).not.toBe(0);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(result.stderr).toMatch(/SETUID/);
      expect(result.stderr).toMatch(/SETGID/);
      expect(spawnSync("test", ["-e", path.join(dir, "setpriv-ran")]).status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The kernel counts the reader user's process allowance per numeric user id on the
// whole host, so the reader's id is one no other image is likely to use.
describe("the reader account in the image", () => {
  const dockerfile = readFileSync(path.resolve(__dirname, "../../Dockerfile"), "utf8");
  it("has a numeric user id and group id of its own, apart from the API's", () => {
    expect(dockerfile).toMatch(/groupadd --system --gid 48217 litt-reader/);
    expect(dockerfile).toMatch(/useradd --system --uid 48217 --gid litt-reader /);
    expect(dockerfile).not.toMatch(/--(uid|gid) 1000[0-9]\b[^\n]*litt-reader/);
  });
});
