// Ends a reader's process group for the API. The readers run as another user, so
// the API cannot signal them; this small helper is started by the API (readerUser.ts,
// reapGroup) with the one capability the API keeps for starting readers, and takes
// the reader's user as its EFFECTIVE user only: real and saved user stay the API's.
// It may then signal the reader's processes, while they may not signal it, trace it
// or read its memory and environment (all of that needs a match with the real or saved
// user). It sends SIGKILL to the group, which also ends a stopped process, and exits.
// Arguments: the process group id and the reader's numeric user id. It reads no
// outside content and starts nothing.
const [groupText = "", userText = ""] = process.argv.slice(2);
const group = /^\d+$/.test(groupText) ? Number(groupText) : 0;
const user = /^\d+$/.test(userText) ? Number(userText) : 0;

function refuse(reason: string): never {
  process.stderr.write(`reaper: ${reason}\n`);
  process.exit(2);
}

// Never the init, never the API's own group, never the superuser.
if (!Number.isSafeInteger(group) || group <= 1) refuse("invalid group");
if (!Number.isSafeInteger(user) || user === 0) refuse("invalid user");
if (group === process.pid || group === process.ppid) refuse("not a reader's group");

try {
  process.seteuid!(user);
} catch (error) {
  refuse(`cannot take the reader's user (${(error as NodeJS.ErrnoException).code ?? "error"})`);
}

try {
  process.kill(-group, "SIGKILL");
} catch (error) {
  // No such group: nothing left to end.
  if ((error as NodeJS.ErrnoException).code !== "ESRCH") refuse(`cannot end the group (${(error as NodeJS.ErrnoException).code ?? "error"})`);
}
process.exit(0);
