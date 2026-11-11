// The largest JSON body the API accepts. The server's own copy is
// JSON_BODY_LIMIT in backend/src/app.ts ("50mb", which Express reads as
// 50 * 1024 * 1024 bytes); keep the two in step.
export const JSON_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

/** True when a serialized JSON request body is over the server's limit. */
export function exceedsJsonBodyLimit(serializedBody: string): boolean {
  // Characters are at most 3 UTF-8 bytes (or 4 per surrogate pair), so a body
  // this short cannot be over the limit and is not encoded.
  if (serializedBody.length * 3 <= JSON_BODY_LIMIT_BYTES) return false;
  return new TextEncoder().encode(serializedBody).length > JSON_BODY_LIMIT_BYTES;
}
