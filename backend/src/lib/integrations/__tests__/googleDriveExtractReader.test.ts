import { EventEmitter } from "node:events";
import { fstatSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const { forkMock, readFileMock } = vi.hoisted(() => ({ forkMock: vi.fn(), readFileMock: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: forkMock }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: (...args: unknown[]) => { readFileMock(...args); return (actual.readFile as (...a: unknown[]) => unknown)(...args); } };
});
vi.mock("../../extraction/readerUser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../extraction/readerUser")>()),
  activeReaderUser: () => "litt-reader",
}));
import { extractGoogleDriveBinary } from "../googleDriveExtract";

afterEach(() => vi.clearAllMocks());

it("reads a linked file as the reader user, with no capability, from an open descriptor, and ends it by closing its stdin", async () => {
  const stdin = { destroy: vi.fn(), on: vi.fn() };
  const child = Object.assign(new EventEmitter(), { kill: vi.fn(), send: vi.fn(), stdin });
  forkMock.mockReturnValue(child);
  const dir = mkdtempSync(join(tmpdir(), "mike-drive-test-"));
  writeFileSync(join(dir, "content"), "synthetic bytes");
  const result = extractGoogleDriveBinary(join(dir, "content"), "application/pdf");
  await vi.waitFor(() => expect(forkMock).toHaveBeenCalled());
  const [, , options] = forkMock.mock.calls[0];
  expect(options.execPath).toBe("setpriv");
  expect(options.execArgv.slice(0, 11)).toEqual([
    "--reuid", "litt-reader", "--regid", "litt-reader", "--clear-groups",
    "--inh-caps", "-all", "--ambient-caps", "-all", "--no-new-privs", "--",
  ]);
  expect(options.execArgv[11]).toBe(process.execPath);
  // The file belongs to the API (mode 0600): the reader is given the open file, and the
  // API reads none of it and sends none of its bytes.
  expect(options.stdio).toEqual(["pipe", "ignore", "ignore", "ipc", expect.any(Number)]);
  expect(options.env.LITT_LIFELINE_FD).toBe("0");
  const message = child.send.mock.calls[0][0];
  expect(message.bytes).toBeUndefined();
  expect(message.fd).toBe(4);
  expect(readFileMock).not.toHaveBeenCalled();
  const descriptor = options.stdio[4] as number;
  child.emit("message", { text: "read" });
  await expect(result).resolves.toBe("read");
  expect(stdin.destroy).toHaveBeenCalled();
  expect(child.kill).not.toHaveBeenCalled();
  // The API's copy of the descriptor is closed once the child holds its own.
  expect(() => fstatSync(descriptor)).toThrow();
  rmSync(dir, { recursive: true, force: true });
});
