import { fork } from "node:child_process";
import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { childProcessEnv } from "../childEnv";
import { LIFELINE_ENV } from "../extraction/lifeline";
import { activeReaderUser, launchChild } from "../extraction/readerUser";
import { googleDriveLimits } from "./googleDriveLimits";
import { GoogleDriveUserError } from "./googleDriveHttp";

let activeParsers = 0;
// Where the file's descriptor lands in the child: after stdin, stdout, stderr and the IPC channel.
const DESCRIPTOR_IN_CHILD = 4;

/** Parse untrusted binaries off the API event loop, with bounded concurrency,
 * a V8 heap limit and a wall-clock kill. Download and DOCX expansion limits are
 * enforced separately; V8's heap limit is not a total process RSS limit. */
export async function extractGoogleDriveBinary(
    filename: string,
    mimeType: string,
): Promise<string> {
    if (activeParsers >= 2) {
        throw new GoogleDriveUserError(
            "Google Drive file readers are busy. Please try again.",
        );
    }
    activeParsers++;
    const limits = googleDriveLimits();
    // The downloaded file is the API's own (mode 0600), which another user cannot
    // open: a child that runs as the reader user is given the open file as one more
    // descriptor. The API reads none of it, so nothing in proportion to the file
    // sits in its memory.
    const readerUser = activeReaderUser();
    let handle: FileHandle | undefined;
    try {
        handle = readerUser ? await open(filename, "r") : undefined;
        return await new Promise<string>((resolve, reject) => {
            const extension = __filename.endsWith(".ts") ? "ts" : "js";
            // The file is untrusted: where there is a reader user the child runs
            // as it (like the document parser) and is ended by closing its stdin.
            const launch = launchChild(
                process.execPath,
                [
                    ...(extension === "ts" ? ["--import", "tsx"] : []),
                    `--max-old-space-size=${limits.parserHeapMb}`,
                ],
                { asReader: readerUser },
            );
            const child = fork(
                path.join(__dirname, `googleDriveExtractChild.${extension}`),
                [],
                {
                    ...(launch.command === process.execPath ? {} : { execPath: launch.command }),
                    // Behind setpriv, node's own path and flags are part of the arguments.
                    execArgv: launch.args,
                    stdio: [readerUser ? "pipe" : "ignore", "ignore", "ignore", "ipc", ...(handle ? [handle.fd] : [])],
                    serialization: "advanced",
                    // Parsers never need deployment secrets or network credentials.
                    env: childProcessEnv({
                        NODE_ENV: process.env.NODE_ENV,
                        ...(readerUser ? { [LIFELINE_ENV]: "0", HOME: "/nonexistent" } : {}),
                    }),
                },
            );
            child.stdin?.on("error", () => {});
            let settled = false;
            const finish = (text?: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                // Another user's process cannot be signalled: closing stdin ends it.
                if (readerUser) child.stdin?.destroy();
                else child.kill("SIGKILL");
                if (text !== undefined) resolve(text);
                else
                    reject(
                        new GoogleDriveUserError(
                            "This Drive file could not be read within the processing limits. Open it in Google Drive.",
                        ),
                    );
            };
            const timer = setTimeout(() => finish(), limits.parseMs);
            child.once("error", () => finish());
            child.once("exit", () => finish());
            child.once("message", (message: unknown) => {
                const text = (message as { text?: unknown } | null)?.text;
                finish(typeof text === "string" ? text : undefined);
            });
            // The child holds its own copy of the descriptor now.
            void handle?.close().catch(() => {});
            child.send(
                { filename, mimeType, expandedBytes: limits.expandedBytes, ...(handle ? { fd: DESCRIPTOR_IN_CHILD } : {}) },
                (error) => {
                    if (error) finish();
                },
            );
        });
    } catch (error) {
        await handle?.close().catch(() => {});
        throw error;
    } finally {
        activeParsers--;
    }
}
