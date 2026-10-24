import {
  downloadUserExport,
  getUserExportStatus,
  startUserExport,
  type UserExportType,
} from "@/app/lib/mikeApi";
import { UserVisibleError } from "@/app/lib/userFacingError";

/** Save a blob through a temporary link, as a browser download. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXPORT_POLL_MS = process.env.NODE_ENV === "test" ? 10 : 2000;
const EXPORT_POLL_LIMIT = 150; // ~5 minutes

/**
 * Exports run as durable backend jobs: schedule, poll until built, then
 * download the artifact. A double click dedupes onto the running job
 * server-side, and a build that outlives this tab can be re-downloaded by
 * starting it again (the poll finds the finished job).
 */
export async function runUserExport(
  type: UserExportType,
  params: Record<string, unknown>,
  fallbackFilename: string,
) {
  const { export_id } = await startUserExport(type, params);
  for (let i = 0; i < EXPORT_POLL_LIMIT; i++) {
    await new Promise((resolve) => setTimeout(resolve, EXPORT_POLL_MS));
    const status = await getUserExportStatus(export_id);
    if (status.status === "failed") {
      throw new UserVisibleError(
        "LiTT couldn't build the export. Try again, and contact support if it keeps happening.",
        { retryable: true },
      );
    }
    if (status.status === "done") {
      const { blob, filename } = await downloadUserExport(export_id);
      downloadBlob(blob, filename ?? status.filename ?? fallbackFilename);
      return;
    }
  }
  throw new UserVisibleError(
    "The export is taking longer than expected. It may still be building, so try again in a few minutes.",
    { retryable: true },
  );
}
