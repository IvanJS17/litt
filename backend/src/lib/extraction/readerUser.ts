// The document parser opens files that users upload. On Linux it runs as its own
// unprivileged account, so it cannot read the API process's environment or files;
// the API starts it through setpriv (util-linux), which needs only the set-user
// and set-group capabilities. The checks here ask the same question isolated.ts
// and the startup validation in runtimeConfig do, with one answer.
import { execFile, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { childProcessEnv } from "../childEnv";
import { extractionReaderUser } from "./limits";

/** setpriv's arguments, up to and including `--`: the reader's user and group,
 * no supplementary groups, no capability kept or inheritable, and no way to gain one. */
export function readerSwitchArgs(user: string): string[] {
  return [
    "--reuid", user, "--regid", user, "--clear-groups",
    "--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--",
  ];
}

/** setpriv's arguments for a child that is not a reader: nothing inheritable or
 * ambient survives the exec, and nothing can be gained back. */
export function noCapabilityArgs(): string[] {
  return ["--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--"];
}

/** True when `/proc/<pid>/status` text shows an ambient capability: the set that
 * reaches the children of a non-root process (an inheritable one reaches a child
 * only through a file that carries capabilities, and the image has none). */
export function inheritsCapabilities(status: string): boolean {
  const value = /^CapAmb:\s*([0-9a-f]+)/m.exec(status)?.[1];
  return value !== undefined && /[1-9a-f]/.test(value);
}

function holdsInheritableCapabilities(): boolean {
  if (process.platform !== "linux") return false;
  try {
    return inheritsCapabilities(readFileSync("/proc/self/status", "utf8"));
  } catch {
    return false;
  }
}

/**
 * The one place that decides how a process is started. Every file that starts
 * one goes through it (childProcessGuard.test.ts):
 *  - `asReader` (the reader's user name): the command runs as that user, with
 *    no capability and no way to gain one. Processes that open uploaded files
 *    use this.
 *  - otherwise, when this process holds ambient capabilities (the
 *    API keeps the set-user and set-group ones only to start readers), the
 *    command is started with every one of them dropped.
 *  - otherwise it starts as it is.
 */
export function launchChild(
  command: string,
  args: string[],
  options: { asReader?: string | null; capabilitiesHeld?: boolean } = {},
): { command: string; args: string[] } {
  if (options.asReader) return { command: "setpriv", args: [...readerSwitchArgs(options.asReader), command, ...args] };
  if (options.capabilitiesHeld ?? holdsInheritableCapabilities()) {
    return { command: "setpriv", args: [...noCapabilityArgs(), command, ...args] };
  }
  return { command, args };
}

/** Why the process cannot start something as `user`, or null when it can. */
export function readerSwitchProblem(user: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const result = spawnSync("setpriv", [...readerSwitchArgs(user), "true"], {
    env: { PATH: env.PATH ?? "" }, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? "setpriv was not found on PATH (util-linux)" : `setpriv could not be run (${code ?? "error"})`;
  }
  if (result.status === 0) return null;
  const detail = (result.stderr ?? "").split("\n").find((line) => line.trim())?.trim().slice(0, 200);
  return `setpriv could not switch to ${user}${detail ? `: ${detail}` : ""}`;
}

const probed = new Map<string, string | null>();

/** The configured reader user when the process can switch to it, else null
 * (the parser then runs as the API's own user, as it does where there is no second user). */
export function activeReaderUser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const user = extractionReaderUser(env, platform);
  if (!user) return null;
  const key = `${user}\0${env.PATH ?? ""}`;
  if (!probed.has(key)) probed.set(key, readerSwitchProblem(user, env));
  return probed.get(key) === null ? user : null;
}

/** Runs a command as the reader and resolves with its standard output. */
export function runAsReader(user: string, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const launch = launchChild(command, args, { asReader: user });
    execFile(launch.command, launch.args, { env: childProcessEnv(), encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
  });
}
