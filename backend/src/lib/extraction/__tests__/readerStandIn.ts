// For tests whose host has no second user: a stand-in setpriv answers the start-up
// identity command (see readerIdentity in ../readerUser) as a switched process would,
// and the process pretends to be another user and group than the one the stand-in reports.
import { vi } from "vitest";

/** Shell lines for a stand-in setpriv, after its arguments up to `--` are shifted away: the identity command prints the user id, group id and groups the test process really has. */
export const ANSWER_IDENTITY_COMMAND = 'if [ "$1" = sh ] && [ "$2" = -c ]; then id -u; id -g; id -g; exit 0; fi';

/** Makes this process report another user and group id than the stand-in's answer (restore with vi.restoreAllMocks, or `restore()`). */
export function beAnotherUserThanTheReaders(): { restore: () => void } {
  const uid = vi.spyOn(process, "getuid").mockReturnValue(process.getuid!() + 1);
  const gid = vi.spyOn(process, "getgid").mockReturnValue(process.getgid!() + 1);
  return { restore: () => { uid.mockRestore(); gid.mockRestore(); } };
}
