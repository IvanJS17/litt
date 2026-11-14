// Client half of the durable export flow: schedule the build, poll it, then
// fetch the finished artifact. Used by every caller whose payload is too big
// to build inside a request — the History CSV and bulk document zips — so the
// export survives a slow build and a closed tab alike.

import {
    downloadUserExport,
    getUserExportStatus,
    startUserExport,
    type UserExportType,
} from "@/app/lib/mikeApi";
import { UserVisibleError } from "@mike/client";

// Tests drive the loop with fake-fast polling; 2s is the interactive rate.
const POLL_MS = process.env.NODE_ENV === "test" ? 10 : 2000;
const POLL_LIMIT = 150; // ~5 minutes

/** Wait one poll interval, or reject as soon as the caller aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal!.reason);
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * `signal` belongs to the screen that asked: once it aborts (the person left
 * the page) the loop stops polling and downloads nothing. The job keeps
 * building on the server and is found finished when started again.
 */
export async function runUserExport(
    type: UserExportType,
    params?: Record<string, unknown>,
    signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string | null }> {
    const { export_id } = await startUserExport(type, params);
    for (let i = 0; i < POLL_LIMIT; i++) {
        await pause(POLL_MS, signal);
        const status = await getUserExportStatus(export_id);
        if (signal?.aborted) throw signal.reason;
        if (status.status === "failed")
            throw new UserVisibleError(
                "LiTT couldn't build the export. Try again, and contact support if it keeps happening.",
                { retryable: true },
            );
        if (status.status === "done") {
            const { blob, filename } = await downloadUserExport(export_id);
            if (signal?.aborted) throw signal.reason;
            return { blob, filename: filename ?? status.filename };
        }
    }
    throw new UserVisibleError(
        "The export is taking longer than expected. It may still be building, so try again in a few minutes.",
        { retryable: true },
    );
}
