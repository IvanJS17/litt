// Runs as the reader user, started by convert.ts. Receives one uploaded Office
// file on stdin, converts it with LibreOffice in a directory only it owns and
// writes the PDF to stdout. A failure is one JSON line on stderr and a non-zero
// exit. The API closes descriptor 3 to end it (extraction/lifeline.ts), and
// removes the directory (which it had made as this user) once the helper is gone.
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ConversionError, convertOfficeFileHere } from "./convert";
import { watchLifeline } from "./extraction/lifeline";

process.env.LITT_PARSER_PROCESS = "1";
// From the event loop, not a thread: this process ends by itself when it is done.
watchLifeline(process.env, false);

async function main(): Promise<void> {
  // The input is stored under a fixed name; only its extension (which tells LibreOffice
  // the format) comes from the API, already reduced to letters and digits.
  const extension = /^[A-Za-z0-9]{1,16}$/.test(process.argv[2] ?? "") ? `.${process.argv[2]}` : "";
  const scratch = process.argv[3] ?? "";
  if (!path.isAbsolute(scratch)) throw new ConversionError("conversion.failed", "invalid directory");
  const input = path.join(scratch, `input${extension}`);
  await pipeline(process.stdin, createWriteStream(input, { mode: 0o600 }));
  const output = await convertOfficeFileHere(input, path.join(scratch, "out"));
  // Not pipeline(): it would wait for the end of a standard stream that is never closed.
  await new Promise<void>((resolve, reject) => {
    const source = createReadStream(output);
    source.once("error", reject);
    source.once("end", resolve);
    source.pipe(process.stdout, { end: false });
  });
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    const kind = (error as { kind?: string } | null)?.kind ?? "conversion.failed";
    process.stderr.write(`${JSON.stringify({ kind, message: String((error as Error)?.message ?? error).slice(0, 2_000) })}\n`, () => process.exit(2));
  },
);
