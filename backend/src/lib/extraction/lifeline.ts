// Run by a process that the API started as another user (the document parser,
// the conversion helper, the Drive reader). The API cannot signal such a
// process, so it ends it by closing a pipe: a thread of its own, which a busy
// main thread does not delay, waits for that pipe to close and then ends the
// whole process group (LibreOffice included). It also ends when the API exits.
import { Socket } from "node:net";
import { Worker } from "node:worker_threads";

/** The environment variable naming the descriptor to watch. Set by the API only
 * when it switched user; without it nothing is watched. */
export const LIFELINE_ENV = "LITT_LIFELINE_FD";

/**
 * `inThread` (the default) watches from a worker thread, which a busy main thread
 * does not delay; it blocks in a read, so a process that watches this way ends
 * only by being killed (process.exit() would wait for that thread). A process that
 * must exit by itself and does no heavy work on its main thread passes `false`
 * and is watched from its event loop instead.
 */
export function watchLifeline(env: NodeJS.ProcessEnv = process.env, inThread = true): void {
  const fd = Number(env[LIFELINE_ENV]);
  delete env[LIFELINE_ENV];
  if (!Number.isInteger(fd) || fd < 0) return;
  if (!inThread) {
    const socket = new Socket({ fd, readable: true, writable: false });
    const end = () => { try { process.kill(-process.pid, "SIGKILL"); } catch { process.kill(process.pid, "SIGKILL"); } };
    socket.once("end", end);
    socket.once("close", end);
    socket.once("error", end);
    socket.on("data", () => {});
    socket.unref();
    return;
  }
  new Worker(`
    const fs = require("node:fs");
    const { pid, fd } = require("node:worker_threads").workerData;
    const buffer = Buffer.alloc(64);
    for (;;) {
      try { if (fs.readSync(fd, buffer, 0, buffer.length, null) === 0) break; }
      catch (error) {
        if (error.code !== "EAGAIN") break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
      }
    }
    try { process.kill(-pid, "SIGKILL"); } catch { process.kill(pid, "SIGKILL"); }
  `, { eval: true, execArgv: [], workerData: { pid: process.pid, fd } }).unref();
}
