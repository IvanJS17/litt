import "dotenv/config";
import { createServerSupabase } from "../lib/supabase";
import { safeError } from "../lib/safeError";
import { fillMissingVersionSizes } from "../modules/documents/documents.service";

// Run by hand at deploy time: `node dist/jobs/fillVersionSizes.js` is a dry run
// that only reads and prints counts; add `--write` to record the sizes. It
// changes no other data, deletes nothing and can be run again.
void fillMissingVersionSizes(createServerSupabase(), {
  write: process.argv.includes("--write"),
}).then((counts) => {
  if (counts.failed > 0) process.exitCode = 1;
}).catch((error) => {
  console.error("Filling version sizes failed", safeError(error));
  process.exitCode = 1;
});
