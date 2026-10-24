import type { UserExportType } from "@/app/lib/mikeApi";
import { runUserExport } from "@/app/lib/asyncExport";

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

/**
 * Build a durable export (see asyncExport) and save it in the browser. A
 * double click dedupes onto the running job server-side, and a build that
 * outlives this tab is found finished when started again.
 */
export async function saveUserExport(
  type: UserExportType,
  params: Record<string, unknown>,
  fallbackFilename: string,
) {
  const { blob, filename } = await runUserExport(type, params);
  downloadBlob(blob, filename ?? fallbackFilename);
}
