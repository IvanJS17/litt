// Shared logging helpers. Three modules carried a byte-identical copy of
// `devLog` (a fourth, lib/chat/types.ts, exported the copy the chat tree
// imports); this is the single definition they all use.

import { inspect } from "node:util";
import { diagnosticErrorTags } from "./observability/diagnostics";

// Registry markers also match errors from another copy of the SDK.
const AI_SDK_ERROR = Symbol.for("vercel.ai.error");
const AI_GATEWAY_ERROR = Symbol.for("vercel.ai.gateway.error");

// An SDK class name such as AI_JSONParseError; anything else is not printed.
const SDK_ERROR_NAME = /^[A-Za-z_]{1,64}$/;

/**
 * A log-safe stand-in for an AI SDK or gateway error, or undefined for any
 * other value. Provider errors and their causes can contain prompts, model
 * output, headers and request URLs, so only the class name and allowlisted
 * diagnostic tags survive.
 */
export function redactedProviderError(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const marked = error as Record<symbol, unknown>;
  if (marked[AI_SDK_ERROR] !== true && marked[AI_GATEWAY_ERROR] !== true) {
    return undefined;
  }
  const name = (error as { name?: unknown }).name;
  const label =
    typeof name === "string" && SDK_ERROR_NAME.test(name)
      ? `AI provider error ${name}`
      : "AI provider error";
  return `${label} ${inspect(diagnosticErrorTags(error))}`;
}

/** Stack frames of an error, without the header line that repeats its message. */
function stackFrames(error: Error): string[] {
  const { stack, message } = error;
  if (typeof stack !== "string" || typeof message !== "string") return [];
  const end = stack.indexOf(message);
  // A message edited after the stack was captured cannot be cut out: print none.
  if (end < 0) return [];
  return stack
    .slice(end + message.length)
    .split("\n")
    .filter((line) => /^\s+at \S/.test(line));
}

/**
 * Redact AI SDK errors wherever the process logs one. Every console.* call
 * formats its arguments with util.inspect, so this hook is the single choke
 * point, including for a provider error nested as the cause of our own
 * error. The Error object is untouched; any other error prints as before
 * (returning `this` tells inspect to use its default formatting). Each
 * process and worker thread has its own Error.prototype and installs this
 * from its entry point (src/logRedaction.ts).
 */
export function installErrorLogRedaction(): void {
  Object.defineProperty(Error.prototype, inspect.custom, {
    value(this: Error) {
      const redacted = redactedProviderError(this);
      return redacted === undefined
        ? this
        : [redacted, ...stackFrames(this)].join("\n");
    },
    configurable: true,
    writable: true,
    enumerable: false,
  });
}

/**
 * Exported for call sites that gate WORK (extra lookups, payload assembly)
 * behind dev mode, not just the log line itself.
 */
export const isDev = process.env.NODE_ENV !== "production";

/**
 * Verbose tracing that is only useful while developing. Silent in production,
 * so call sites can log request/response shapes without a runtime cost or a
 * noisy production log.
 */
export const devLog = (...args: Parameters<typeof console.log>) => {
  if (isDev) console.log(...args);
};

/**
 * Always-on error log, tagged with the subsystem that produced it, so a
 * failure can be traced to the subsystem that raised it without every call
 * site inventing its own prefix format.
 */
export function logError(
  scope: string,
  err: unknown,
  ctx?: Record<string, unknown>,
) {
  const tag = `[${scope}]`;
  if (ctx) console.error(tag, err, ctx);
  else console.error(tag, err);
}
