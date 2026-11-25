// The environment of every process the backend starts. It is built from an
// allowlist, never by removing known secrets: a variable that is not named
// here does not reach the child, whatever the deployment sets. Imports nothing
// from `modules/`.

/** Variables a child may inherit: where programs and LibreOffice live, the
 * profile home, the locale, and the temp directory and allocator setting of
 * the process that starts it (so a converter started by the parser keeps
 * writing inside the parser's scratch directory). No credential is, or may
 * become, one of them. */
export const CHILD_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "SystemRoot",
  "HOME",
  "LANG",
  "TMPDIR",
  "TMP",
  "TEMP",
  "MALLOC_ARENA_MAX",
  "SOFFICE_BINARY_PATH",
  "LIBREOFFICE_BINARY_PATH",
  "LIBRE_OFFICE_EXE",
];

/** The allowlisted variables that are set, plus the caller's explicit extras
 * (which win). */
export function childProcessEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(extra)) {
    if (value !== undefined) env[name] = value;
  }
  return env;
}
