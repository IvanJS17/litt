import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Transport liveness for a provider call. OpenRouter (and other SSE servers)
 * send comment lines such as `: OPENROUTER PROCESSING` while a model is still
 * working. The AI SDK's SSE parser drops comments, so the stream watchdog
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

/**
 * Stateful scan for SSE comment lines (a line whose first byte is `:`) that
 * survives arbitrary chunk boundaries. Returns true when a chunk contains the
 * start of at least one comment line.
 */
export function sseCommentDetector(): (chunk: Uint8Array) => boolean {
  let atLineStart = true;
  return (chunk) => {
    let found = false;
    for (let i = 0; i < chunk.length; i++) {
      const byte = chunk[i]!;
      if (atLineStart && byte === COLON) found = true;
      atLineStart = byte === LF || byte === CR;
    }
    return found;
  };
}

/**
 * Wrap a fetch so SSE comment lines in a response body notify the liveness
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
