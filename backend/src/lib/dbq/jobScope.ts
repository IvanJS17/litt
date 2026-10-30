// Per-job diagnostic scope for code that runs outside an HTTP request.
//
// A queue worker has no request boundary: the DB-queue runner, the BullMQ
// processors and the upload worker loops all run several jobs concurrently
// in one process, and an operation set on a shared scope would land on
// whichever job fails next. Running each job in its own scope keeps the
// operation and the stages with the job that produced them.

import { withDiagnosticScope } from "../observability/report";

/** Run one unit of background work in its own diagnostic scope. */
export function runIsolated<T>(work: () => Promise<T>): Promise<T> {
    return withDiagnosticScope(() => work());
}
