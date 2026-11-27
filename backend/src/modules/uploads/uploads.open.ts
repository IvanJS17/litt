// Opening an upload session, minus HTTP: parse the client's manifest, prove the
// caller may write to its destination, then create the session and its signed
// URLs. `POST /upload-sessions` and the MCP upload tool both call this, so the
// limits, the content types and the destination authorization are one rule.

import { randomUUID } from "node:crypto";

import { resolveUploadSpace } from "../../lib/storageQuota";
import type { Db } from "../../lib/supabase";
import { validateDestinationAccess } from "./uploads.access";
import {
  parseUploadSessionRequest,
  UploadSessionValidationError,
} from "./uploads.manifest";
import { createUploadSession } from "./uploads.sessions";
import { failure, internalFailure, type UploadResult } from "./uploads.shared";

export async function openUploadSession(
  db: Db,
  args: {
    userId: string;
    userEmail: string | undefined;
    /** The raw manifest, exactly as the web client sends it. */
    body: unknown;
    hourlySessionLimit: number;
  },
): Promise<UploadResult<Record<string, unknown>>> {
  const sessionId = randomUUID();
  let manifest;
  try {
    manifest = parseUploadSessionRequest(args.body, args.userId, sessionId);
  } catch (error) {
    if (error instanceof UploadSessionValidationError) {
      return failure(error.status, { code: error.code, detail: error.message });
    }
    throw error;
  }

  const access = await validateDestinationAccess(
    manifest,
    args.userId,
    args.userEmail,
    db,
  );
  if (!access.ok) return access;

  // The space the files will fill; the database refuses the session, in the
  // same transaction that creates it, when that space has no room left.
  const space = await resolveUploadSpace(db, {
    purpose: manifest.purpose,
    destination: manifest.destination as Record<string, unknown>,
    userId: args.userId,
  });
  if (!space.ok) return internalFailure(new Error(space.detail));

  return await createUploadSession(db, {
    sessionId,
    userId: args.userId,
    space: space.space,
    manifest,
    hourlySessionLimit: args.hourlySessionLimit,
  });
}
