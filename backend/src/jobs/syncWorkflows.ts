import "dotenv/config";
import { AppError } from "../lib/appError";
import { createServerSupabase } from "../lib/supabase";
import {
  flushReports,
  reportError,
  setOperation,
} from "../lib/observability/report";
import { syncWorkflowCatalog } from "../lib/workflowCatalogSync";

async function main() {
  setOperation("workflows.sync");
  const result = await syncWorkflowCatalog(createServerSupabase());
  console.log(
    `Synced ${result.workflows} Mike workflows and ${result.assets} assets from ${result.sourceCommit}`,
  );
}

void main().catch(async (error) => {
  // The sync's own failure (a git fetch, an upload, the replace RPC) is the
  // cause, so its code reaches the report as failure_code under one kind. The
  // reported object is also what gets logged, so the log line keeps its stack.
  const failure = new AppError(
    "workflows.sync_failed",
    "Mike workflow sync failed",
    { cause: error },
  );
  reportError(failure, { tags: { component: "workflow-sync" }, level: "fatal" });
  console.error("Mike workflow sync failed", failure);
  await flushReports();
  process.exit(1);
});
