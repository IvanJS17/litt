import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Transport liveness for a provider call. OpenRouter (and other SSE servers)
 * send comment lines such as `: OPENROUTER PROCESSING`, and Anthropic sends
 * `event: ping`, while a model is still working. The AI SDK drops both, so
 * the stream watchdog
 * (providerDeadlines) never sees them; this carries the signal around the
 * parser. providerDeadlines opens a scope around `doStream`; a fetch wrapper
 * built by `withSseKeepAlive` reports into the scope that was open when the
 * request was made.
 */
const scope = new AsyncLocalStorage<() => void>();

export function runWithLivenessListener<T>(
  listener: () => void,
  fn: () => T,
): T {
  return scope.run(listener, fn);
}

const COLON = 0x3a;
const LF = 0x0a;
const CR = 0x0d;
// Anthropic streams `event: ping` (then `data: {"type": "ping"}`) while it is
// still working; the AI SDK drops it. The field is matched exactly at line
// start, with the optional single space SSE allows after the colon.
const PING_LINE = new TextEncoder().encode("event: ping");
const PING_LINE_NO_SPACE = new TextEncoder().encode("event:ping");

/**
 * Stateful scan for SSE keep-alive lines that survives arbitrary chunk
 * boundaries: a comment line (first byte `:`) or an exact `event: ping`
 * field line. Returns true when a chunk contains the start of a comment or
 * the end of a ping line. `data:` lines never match, whatever they contain.
 */
export function sseCommentDetector(): (chunk: Uint8Array) => boolean {
  let atLineStart = true;
  // Bytes of the current line matched so far against each ping spelling
  // (-1 once the line has diverged from it).
  let spaced = 0;
  let compact = 0;
  return (chunk) => {
    let found = false;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;
      const eol = byte === LF || byte === CR;
      if (atLineStart && byte === COLON) found = true;
      if (eol) {
        if (spaced === PING_LINE.length || compact === PING_LINE_NO_SPACE.length) {
          found = true;
        }
        spaced = 0;
        compact = 0;
      } else {
        if (spaced >= 0) {
          spaced =
            spaced < PING_LINE.length && PING_LINE[spaced] === byte ? spaced + 1 : -1;
        }
        if (compact >= 0) {
          compact =
            compact < PING_LINE_NO_SPACE.length && PING_LINE_NO_SPACE[compact] === byte
              ? compact + 1
              : -1;
        }
      }
      atLineStart = eol;
    }
    return found;
  };
}

/**
 * Wrap a fetch so SSE comment and `event: ping` lines in a response body notify the liveness
 * listener of the calling scope. Bytes pass through unchanged.
 */
export function withSseKeepAlive(baseFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    const listener = scope.getStore();
    if (
      !listener ||
      !response.body ||
      !response.headers.get("content-type")?.includes("text/event-stream")
    ) {
      return response;
    }
    const detect = sseCommentDetector();
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (detect(chunk)) listener();
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
