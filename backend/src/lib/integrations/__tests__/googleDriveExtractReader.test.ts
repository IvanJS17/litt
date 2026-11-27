import { EventEmitter } from "node:events";
import { fstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { forkMock, readFileMock, reapMock } = vi.hoisted(() => ({ forkMock: vi.fn(), readFileMock: vi.fn(), reapMock: vi.fn(async () => undefined) }));
vi.mock("node:child_process", () => ({ fork: forkMock }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: (...args: unknown[]) => { readFileMock(...args); return (actual.readFile as (...a: unknown[]) => unknown)(...args); } };
});
vi.mock("../../extraction/readerUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../extraction/readerUser")>()),
  activeReaderUser: () => "litt-reader",
  reapGroup: reapMock,
  trackReaderGroup: () => () => {},
}));
import { extractGoogleDriveBinary } from "../googleDriveExtract";

afterEach(() => vi.clearAllMocks());

it("reads a linked file as the reader user, with no capability, from an open descriptor, and ends it by closing its stdin", async () => {
  const stdin = { destroy: vi.fn(), on: vi.fn() };
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), send: vi.fn(), stdin, pid: 4242 });
  forkMock.mockReturnValue(child);
  const dir = mkdtempSync(join(tmpdir(), "mike-drive-test-"));
  writeFileSync(join(dir, "content"), "synthetic bytes");
  const result = extractGoogleDriveBinary(join(dir, "content"), "application/pdf");
  await vi.waitFor(() => expect(forkMock).toHaveBeenCalled());
  const [, , options] = forkMock.mock.calls[0];
  // Under a limit on the reader user's processes, then the switch.
  expect(options.execPath).toBe("prlimit");
  expect(options.execArgv.slice(0, 3)).toEqual([expect.stringMatching(/^--nproc=\d+:\d+$/), "--", "setpriv"]);
  expect(options.execArgv.slice(3, 14)).toEqual([
    "--reuid", "litt-reader", "--regid", "litt-reader", "--clear-groups",
    "--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--",
  ]);
  expect(options.execArgv[14]).toBe(process.execPath);
  // The file belongs to the API (mode 0600): the reader is given the open file, and the
  // API reads none of it and sends none of its bytes.
  expect(options.stdio).toEqual(["pipe", "ignore", "ignore", "ipc", expect.any(Number)]);
  expect(options.env.LITT_LIFELINE_FD).toBe("0");
  // Its own process group, so the whole group can be ended whatever the reader does.
  expect(options.detached).toBe(true);
  const message = child.send.mock.calls[0][0];
  expect(message.bytes).toBeUndefined();
  expect(message.fd).toBe(4);
  expect(readFileMock).not.toHaveBeenCalled();
  const descriptor = options.stdio[4] as number;
  child.emit("message", { text: "read" });
  await expect(result).resolves.toBe("read");
  expect(stdin.destroy).toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  expect(reapMock).toHaveBeenCalledWith("litt-reader", 4242);
  // The API's copy of the descriptor is closed once the child holds its own.
  expect(() => fstatSync(descriptor)).toThrow();
  rmSync(dir, { recursive: true, force: true });
});

it("refuses at the deadline and ends the reader's whole group, without waiting for the reader to close", async () => {
  vi.stubEnv("GOOGLE_DRIVE_PARSE_TIMEOUT_SECONDS", "1");
  const stdin = { destroy: vi.fn(), on: vi.fn() };
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), send: vi.fn(), stdin, pid: 4343 });
  forkMock.mockReturnValue(child);
  const dir = mkdtempSync(join(tmpdir(), "mike-drive-test-"));
  writeFileSync(join(dir, "content"), "synthetic bytes");
  // The reader never answers, never exits and never closes.
  await expect(extractGoogleDriveBinary(join(dir, "content"), "application/pdf")).rejects.toThrow(/could not be read within the processing limits/);
  expect(reapMock).toHaveBeenCalledWith("litt-reader", 4343);
  expect(stdin.destroy).toHaveBeenCalled();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
}, 15_000);
