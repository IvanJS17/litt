import JSZip from "jszip";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { AppError } from "./appError";
import { uploadConversionTimeoutMs } from "./runtimeConfig";

let _convert:
  ((buf: Buffer, ext: string, filter: undefined) => Promise<Buffer>) | null =
  null;
let _sofficeBinaryPaths: string[] | null = null;

// Server-log text for the operator (never sent to a client). The backend
// Docker image and backend/nixpacks.toml both install LibreOffice; any other
// host has to install it or point at its soffice binary.
const CONVERTER_UNAVAILABLE_MESSAGE =
  "LibreOffice (soffice) was not found, so Office documents cannot be " +
  "converted to PDF (uploads are kept without a PDF rendition; previews " +
  "and text extraction of legacy Office files fail). Install LibreOffice " +
  "(the backend Docker image and backend/nixpacks.toml include it) or set " +
  "SOFFICE_BINARY_PATH or LIBREOFFICE_BINARY_PATH to the soffice " +
  "executable, then restart the backend and worker.";

/** Keep legacy consumer codes derived from the more precise diagnostic kind. */
const CONVERSION_CODES = {
  "conversion.unavailable": "conversion_unavailable",
  "conversion.timeout": "conversion_timeout",
  "conversion.failed": "conversion_failed",
  "conversion.no_output": "conversion_failed",
} as const;
type ConversionKind = keyof typeof CONVERSION_CODES;

export class ConversionError extends AppError {
  readonly code: (typeof CONVERSION_CODES)[ConversionKind];

  constructor(kind: ConversionKind, message: string, options?: { cause?: unknown }) {
    super(kind, message, options);
    this.code = CONVERSION_CODES[kind];
  }
}

/**
 * No usable LibreOffice. Discovered up front (no binary passed the access
 * check) it carries the `conversion_unavailable` code; discovered by a spawn
 * that failed it carries no code of its own, so the attempt's errno (ENOENT,
 * EACCES) on the cause is what reaches `failure_code`, as it did when the
 * raw spawn error was thrown. Both name the kind.
 */
function converterUnavailable(cause?: unknown): AppError {
  if (cause !== undefined) {
    return new AppError(
      "conversion.unavailable",
      CONVERTER_UNAVAILABLE_MESSAGE,
      { cause },
    );
  }
  return new ConversionError(
    "conversion.unavailable",
    CONVERTER_UNAVAILABLE_MESSAGE,
  );
}

function executablePath(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveSofficeBinaryPaths(): string[] {
  if (_sofficeBinaryPaths) return _sofficeBinaryPaths;

  const candidates = new Set<string>();
  for (const envName of [
    "SOFFICE_BINARY_PATH",
    "LIBREOFFICE_BINARY_PATH",
    "LIBRE_OFFICE_EXE",
  ]) {
    const value = process.env[envName]?.trim();
    if (value) candidates.add(value);
  }

  const pathDirs = (process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of pathDirs) {
    candidates.add(path.join(dir, "soffice"));
    candidates.add(path.join(dir, "libreoffice"));
  }

  for (const filePath of [
    "/usr/bin/libreoffice",
    "/usr/bin/soffice",
    "/snap/bin/libreoffice",
    "/opt/libreoffice/program/soffice",
    "/opt/libreoffice7.6/program/soffice",
    // The official macOS installer keeps soffice inside the app bundle and
    // puts nothing on PATH, so a backend run outside Docker on a Mac would
    // otherwise report LibreOffice as missing while it is installed.
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ]) {
    candidates.add(filePath);
  }

  _sofficeBinaryPaths = [...candidates].filter(executablePath);
  return _sofficeBinaryPaths;
}

async function getConvert() {
  if (!_convert) {
    const libre = await import("libreoffice-convert");
    const convertWithOptions = libre.default.convertWithOptions.bind(
      libre.default,
    ) as (
      buf: Buffer,
      ext: string,
      filter: undefined,
      options: {
        sofficeBinaryPaths?: string[];
        execOptions?: { timeout?: number; killSignal?: NodeJS.Signals };
      },
      callback?: (err: Error | null, result: Buffer) => void,
    ) => Promise<Buffer> | void;
    _convert = (buf, ext, filter) =>
      new Promise<Buffer>((resolve, reject) => {
        try {
          const maybePromise = convertWithOptions(
            buf,
            ext,
            filter,
            {
              sofficeBinaryPaths: resolveSofficeBinaryPaths(),
              // The library runs soffice with execFile: without these a
              // wedged soffice holds the caller forever.
              // Not a process group kill: libreoffice-convert does not expose
              // the child or let a launcher be put in front of soffice, and
              // execFile's timeout signals only the direct child. A descendant
              // that outlives it is reaped when the parser process group is
              // killed (isolated.ts killParser) for the callers running there;
              // officeFileToPdf, the upload-worker path, kills its group.
              execOptions: {
                timeout: uploadConversionTimeoutMs(),
                killSignal: "SIGKILL",
              },
            },
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            },
          );
          if (maybePromise && typeof maybePromise.then === "function") {
            maybePromise.then(resolve, reject);
          }
        } catch (err) {
          reject(err);
        }
      });
  }
  return _convert;
}

/** Inflated-size caps for the rewrite below. It runs in the caller's process. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 160 * 1024 * 1024;

type ByteStream = {
  on(event: "data", cb: (chunk: Uint8Array) => void): ByteStream;
  on(event: "end", cb: () => void): ByteStream;
  on(event: "error", cb: (error: Error) => void): ByteStream;
  pause(): ByteStream;
  resume(): ByteStream;
};

/**
 * Inflate one entry, stopping as soon as `limit` bytes come out. A zip header
 * can declare any size, so the count is on the bytes that actually inflate;
 * null means the entry went over and was abandoned.
 */
function inflateWithin(entry: JSZip.JSZipObject, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const stream = (entry as unknown as { internalStream(type: "uint8array"): ByteStream })
      .internalStream("uint8array");
    const chunks: Uint8Array[] = [];
    let size = 0;
    stream
      .on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          stream.pause();
          chunks.length = 0;
          resolve(null);
        } else chunks.push(chunk);
      })
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)))
      .resume();
  });
}

/**
 * Some older Windows/Word archives store .docx entries with backslash
 * separators (e.g. `word\\document.xml`). Mammoth and LibreOffice both look
 * up entries by exact string and miss those files, producing empty output
 * or conversion failures. Rewrite any such entries to the canonical
 * forward-slash form before handing the buffer off.
 *
 * The rewrite inflates every entry in this process, so it is capped per part
 * and in total on the bytes that really inflate (a header can lie). Over a
 * cap the original is returned untouched, as for an unreadable zip.
 */
export async function normalizeDocxZipPaths(buffer: Buffer): Promise<Buffer> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return buffer;
  }
  if (!Object.keys(zip.files).some((name) => name.includes("\\"))) return buffer;
  const rebuilt = new JSZip();
  let total = 0;
  for (const [name, entry] of Object.entries(zip.files)) {
    const target = name.replace(/\\/g, "/");
    if (entry.dir) {
      rebuilt.folder(target);
      continue;
    }
    const content = await inflateWithin(entry, Math.min(MAX_PART_BYTES, MAX_TOTAL_BYTES - total));
    if (!content) return buffer;
    total += content.length;
    rebuilt.file(target, content);
  }
  return rebuilt.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Convert a DOCX/DOC buffer to PDF using LibreOffice.
 * Throws if LibreOffice is not installed or conversion fails.
 */
export async function docxToPdf(buffer: Buffer): Promise<Buffer> {
  if (resolveSofficeBinaryPaths().length === 0) {
    throw converterUnavailable();
  }
  const convert = await getConvert();
  const normalized = await normalizeDocxZipPaths(buffer);
  try {
    return await convert(normalized, ".pdf", undefined);
  } catch (error) {
    if (error instanceof AppError) throw error;
    // The library spawns soffice itself: a spawn failure is the converter
    // missing or unexecutable, the same condition officeFileToPdf names.
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "ENOENT" || code === "EACCES") throw converterUnavailable(error);
    // execFile reports its own deadline as killed + SIGKILL.
    const killed = error as { killed?: unknown; signal?: unknown } | null;
    if (killed?.killed === true && killed.signal === "SIGKILL") {
      throw new ConversionError(
        "conversion.timeout",
        `LibreOffice conversion timed out after ${uploadConversionTimeoutMs()}ms`,
        { cause: error },
      );
    }
    throw new ConversionError(
      "conversion.failed",
      "LibreOffice conversion failed",
      { cause: error },
    );
  }
}

/**
 * Convert an Office document from disk and leave the generated PDF on disk.
 * This is the upload-worker path: it avoids loading either the source file or
 * converted PDF into the Node.js process.
 */
export async function officeFileToPdf(
  inputPath: string,
  outputDirectory: string,
): Promise<string> {
  const binary = resolveSofficeBinaryPaths()[0];
  if (!binary) {
    throw converterUnavailable();
  }

  await fs.promises.mkdir(outputDirectory, { recursive: true });
  const profileDirectory = path.join(outputDirectory, "libreoffice-profile");
  await fs.promises.mkdir(profileDirectory, { recursive: true });
  const profileUrl = pathToFileURL(profileDirectory).href;

  const timeoutMs = uploadConversionTimeoutMs();
  let stderr = "";
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        binary,
        [
          `-env:UserInstallation=${profileUrl}`,
          "--headless",
          "--convert-to",
          "pdf",
          "--outdir",
          outputDirectory,
          inputPath,
        ],
        // Its own process group, so the deadline reaches soffice.bin and any
        // other descendant, not only this direct child.
        { stdio: ["ignore", "ignore", "pipe"], detached: process.platform !== "win32" },
      );
      let timedOut = false;
      // LibreOffice can wedge on a malformed document and never exit, which
      // would hold this worker slot for the life of the process.
      const deadline = setTimeout(() => {
        timedOut = true;
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, timeoutMs);
      deadline.unref();
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-4_096);
      });
      child.once("error", (error) => {
        clearTimeout(deadline);
        // The binary was found but could not be started (removed since
        // discovery, not executable here): the converter is unavailable, and
        // the spawn error's errno rides along as the cause.
        reject(converterUnavailable(error));
      });
      child.once("close", (code) => {
        clearTimeout(deadline);
        if (timedOut) {
          reject(
            new ConversionError(
              "conversion.timeout",
              `LibreOffice conversion timed out after ${timeoutMs}ms`,
            ),
          );
        } else if (code === 0) {
          resolve();
        } else {
          reject(
            new ConversionError(
              "conversion.failed",
              `LibreOffice conversion failed with exit code ${code ?? "unknown"}${stderr ? `: ${stderr}` : ""}`,
            ),
          );
        }
      });
    });
  } finally {
    // A killed child leaves lock files behind in its user profile.
    await fs.promises
      .rm(profileDirectory, { recursive: true, force: true })
      .catch(() => {});
  }

  const outputPath = path.join(
    outputDirectory,
    `${path.parse(inputPath).name}.pdf`,
  );
  try {
    await fs.promises.access(outputPath, fs.constants.R_OK);
  } catch (error) {
    // soffice exits 0 without writing anything when it cannot load the
    // source ("Error: source file could not be loaded" on stderr). That is a
    // rejected document, not a missing file: the code says so for callers,
    // the kind names the shape for the report, and LibreOffice's reason stays
    // in the message for the server log (the report keeps only code and kind).
    throw new ConversionError(
      "conversion.no_output",
      `LibreOffice exited without producing a PDF${stderr ? `: ${stderr}` : ""}`,
      { cause: error },
    );
  }
  return outputPath;
}

/**
 * Storage key of a document's PDF rendition. With a version slug the key is
 * per version, so a rendition never overwrites another version's.
 */
export function convertedPdfKey(
  userId: string,
  docId: string,
  versionSlug?: string,
): string {
  return versionSlug
    ? `converted-pdfs/${userId}/${docId}/${versionSlug}.pdf`
    : `converted-pdfs/${userId}/${docId}.pdf`;
}
