/** Limits are deliberately independent of parsers and queue transports. */
export const EXTRACTION_MAX_BYTES = 150 * 1024 * 1024;
export const EXTRACTION_MAX_TEXT_BYTES = 16 * 1024 * 1024;
/** A file the parser returns (a compared .docx), not text. */
export const EXTRACTION_MAX_BINARY_BYTES = 64 * 1024 * 1024;

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// A DB claim becomes stale after ten minutes. Reserve time for I/O too.
export const extractionTimeoutMs = () => Math.min(positiveNumber("EXTRACTION_TIMEOUT_MS", 180_000), 300_000);
export const extractionMemoryMb = () => Math.min(65_536, Math.max(1, Math.floor(positiveNumber("EXTRACTION_MAX_MEMORY_MB", 1024))));

export class ExtractionLimitError extends Error {
  constructor(reason: string) {
    super(`document_too_large: ${reason}`);
    this.name = "ExtractionLimitError";
  }
}

/** Capacity is transient: never classify it as a document-size failure. */
export class ExtractionBusyError extends Error {
  constructor() {
    super("document_extraction_busy");
    this.name = "ExtractionBusyError";
  }
}

export function isAllocationFailure(error: unknown): boolean {
  return error instanceof Error && /array buffer allocation failed|invalid array buffer length|invalid string length|out of memory|\bENOMEM\b/i.test(error.message);
}

// How the parser child is launched. These live in this import-free file so
// the startup check in runtimeConfig can ask the same question as
// isolated.ts without importing the parser (which imports runtimeConfig).

/** The executable the parser child is launched through, or null when it runs directly. */
export function extractionLauncher(platform: NodeJS.Platform = process.platform): "prlimit" | null {
  return platform === "linux" ? "prlimit" : null;
}

export function extractionIsolated(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXTRACTION_ISOLATION !== "off";
}

/** The unprivileged account the parser is meant to run as (Linux only), or null.
 * The name is passed to setpriv as a user and as a group of the same name. */
export function extractionReaderUser(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | null {
  const name = env.EXTRACTION_READER_USER?.trim();
  return platform === "linux" && name && /^[a-z_][a-z0-9_-]{0,31}$/.test(name) ? name : null;
}
