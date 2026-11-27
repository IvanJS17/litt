// The first import of every backend entry point (API process, worker thread,
// standalone worker). Nothing may log before this runs: provider errors carry
// the prompt and the provider's reply, and the server log is kept.
import { installErrorLogRedaction } from "./lib/log";

installErrorLogRedaction();
