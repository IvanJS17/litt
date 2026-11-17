// The uploads module's stable facade.
//
// The upload protocol has one caller outside this directory besides app.ts
// (which mounts uploads.routes.ts at /upload-sessions): workerRuntime.ts,
// which starts the background processors. It comes through this file, so the
// module's internal decomposition can change without touching it.
//
//   uploads.manifest.ts   — request vocabulary, limits, and the one validator
//   uploads.shared.ts     — row shapes, the public file projection, failures
//   uploads.access.ts     — destination authorization
//   uploads.sessions.ts   — session lifecycle: create, sign, seal, cancel
//   uploads.processing.ts — the worker that turns sealed bytes into documents
//   uploads.open.ts       — open a session: validate, authorize, create
//   uploads.routes.ts     — the HTTP layer over the above (imports its
//                           siblings directly, like every other module)

export { startUploadProcessingWorkers } from "./uploads.processing";

// The control plane for transports other than the web routes (the MCP server):
// the same manifest validation and destination authorization, the same
// session lifecycle.
export { openUploadSession } from "./uploads.open";
export { getUploadSession, completeUploadSessionFile } from "./uploads.sessions";
export type { UploadFailure } from "./uploads.shared";
