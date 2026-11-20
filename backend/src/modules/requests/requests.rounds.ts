/**
 * Negotiation rounds of a request: an existing document version linked to the
 * request with a round number and a date. The version stays the documents
 * module's; this file only reads it to check that it belongs to the matter's
 * project and never writes a version row. The number of distinct rounds is the
 * request's effort measure.
 */

import type { MatterRequestRound } from "@mike/contracts";
import { authorizeMatterMember } from "../matters/matters.service";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { recordRequestEvent } from "./requests.events";
import { scheduleDocumentTriage } from "./requests.triage.run";
import {
  isIsoDate,
  isRecord,
  MAX_ROUND_NUMBER,
  NOT_A_RETAINER_CODE,
  ROUND_ALREADY_LINKED_CODE,
  today,
  uuidOrNull,
  VERSION_NOT_IN_MATTER_CODE,
  INVALID_REQUEST_CODE,
} from "./requests.shared";

type Actor = {
  userId: string;
  userEmail?: string | null;
  projectId: unknown;
  matterId: unknown;
  requestId: unknown;
};

const NOT_FOUND = "Not found";

type RoundRow = {
  id: string;
  round_number: number;
  round_date: string;
  document_id: string;
  version_id: string;
};

export async function loadRounds(
  db: Db,
  requestId: string,
): Promise<ServiceResult<MatterRequestRound[]>> {
  const { data, error } = await db
    .from("matter_request_rounds")
    .select("id, round_number, round_date, document_id, version_id")
    .eq("request_id", requestId)
    .order("round_number", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return internalFailure(error);
  const rows = (data ?? []) as unknown as RoundRow[];
  if (rows.length === 0) return ok([]);
  const { data: versions, error: versionError } = await db
    .from("document_versions")
    .select("id, version_number, filename")
    .in(
      "id",
      rows.map((row) => row.version_id),
    );
  if (versionError) return internalFailure(versionError);
  const byId = new Map(
    ((versions ?? []) as unknown as { id: string; version_number: number | null; filename: string | null }[]).map(
      (row) => [row.id, row],
    ),
  );
  return ok(
    rows.map((row) => ({
      ...row,
      version_number: byId.get(row.version_id)?.version_number ?? null,
      filename: byId.get(row.version_id)?.filename ?? null,
    })),
  );
}

async function writableRequest(db: Db, actor: Actor) {
  const access = await authorizeMatterMember(db, { ...actor, write: true });
  if (!access.ok) return access;
  if (!access.data.isRetainer)
    return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
  if (typeof actor.requestId !== "string" || !isUuid(actor.requestId))
    return failure("not_found", NOT_FOUND);
  const { data, error } = await db
    .from("matter_requests")
    .select("id")
    .eq("id", actor.requestId)
    .eq("matter_id", access.data.matterId)
    .maybeSingle();
  if (error) return internalFailure(error);
  if (!data) return failure("not_found", NOT_FOUND);
  return ok({ access: access.data, requestId: actor.requestId });
}

export async function linkRound(
  db: Db,
  actor: Actor & { body: unknown },
): Promise<ServiceResult<MatterRequestRound>> {
  try {
    const target = await writableRequest(db, actor);
    if (!target.ok) return target;
    const { access, requestId } = target.data;
    const body = actor.body;
    if (!isRecord(body)) return failure("validation", "A request body is required.", INVALID_REQUEST_CODE);
    const versionId = uuidOrNull(body.version_id);
    if (!versionId) return failure("validation", "version_id must be a document version id.", INVALID_REQUEST_CODE);
    if (
      body.round_number != null &&
      (typeof body.round_number !== "number" ||
        !Number.isSafeInteger(body.round_number) ||
        body.round_number < 1 ||
        body.round_number > MAX_ROUND_NUMBER)
    )
      return failure(
        "validation",
        `round_number must be a whole number from 1 to ${MAX_ROUND_NUMBER}.`,
        INVALID_REQUEST_CODE,
      );
    if (body.round_date != null && !isIsoDate(body.round_date))
      return failure("validation", "round_date must be a date (YYYY-MM-DD).", INVALID_REQUEST_CODE);

    // The version must be a live one of a document in this matter's project.
    const { data: version, error: versionError } = await db
      .from("document_versions")
      .select("id, document_id, version_number, filename, deleted_at")
      .eq("id", versionId)
      .maybeSingle();
    if (versionError) return internalFailure(versionError);
    const found = version as unknown as {
      id: string;
      document_id: string;
      version_number: number | null;
      filename: string | null;
      deleted_at: string | null;
    } | null;
    type DocumentOwner = { project_id: string | null; archived_at: string | null };
    let document = null as DocumentOwner | null;
    if (found) {
      const { data: owner, error: ownerError } = await db
        .from("documents")
        .select("project_id, archived_at")
        .eq("id", found.document_id)
        .maybeSingle();
      if (ownerError) return internalFailure(ownerError);
      document = owner as unknown as DocumentOwner | null;
    }
    if (
      !found ||
      found.deleted_at ||
      !document ||
      document.archived_at ||
      document.project_id !== access.projectId
    )
      return failure(
        "validation",
        "The version is not a document of this matter.",
        VERSION_NOT_IN_MATTER_CODE,
      );

    const { data: existing, error: existingError } = await db
      .from("matter_request_rounds")
      .select("id, round_number, version_id")
      .eq("request_id", requestId);
    if (existingError) return internalFailure(existingError);
    const rows = (existing ?? []) as unknown as { id: string; round_number: number; version_id: string }[];
    if (rows.some((row) => row.version_id === versionId))
      return failure("conflict", "That version is already a round of the request.", ROUND_ALREADY_LINKED_CODE);
    const roundNumber =
      (body.round_number as number | undefined) ??
      rows.reduce((max, row) => Math.max(max, row.round_number), 0) + 1;
    if (roundNumber > MAX_ROUND_NUMBER)
      return failure("validation", "The request has as many rounds as it can.", INVALID_REQUEST_CODE);
    const roundDate = (body.round_date as string | undefined) ?? today();

    const { data: inserted, error } = await db
      .from("matter_request_rounds")
      .insert({
        request_id: requestId,
        matter_id: access.matterId,
        round_number: roundNumber,
        round_date: roundDate,
        document_id: found.document_id,
        version_id: versionId,
        created_by: actor.userId,
      })
      .select("id, round_number, round_date, document_id, version_id")
      .single();
    if (error && isRecord(error) && error.code === "23505")
      return failure("conflict", "That version is already a round of the request.", ROUND_ALREADY_LINKED_CODE);
    if (error || !inserted) return internalFailure(error);
    await recordRequestEvent(db, {
      requestId,
      matterId: access.matterId,
      actorUserId: actor.userId,
      action: "round_linked",
      detail: { round_number: roundNumber, document_id: found.document_id, version_id: versionId },
    });
    // Donna reads the new document too, in the background (docs/request-triage.md).
    scheduleDocumentTriage(db, {
      userId: actor.userId,
      userEmail: actor.userEmail,
      orgId: access.organizationId,
      projectId: access.projectId,
      matterId: access.matterId,
      requestId,
    });
    return ok({
      ...(inserted as unknown as RoundRow),
      version_number: found.version_number,
      filename: found.filename,
    });
  } catch (error) {
    return internalFailure(error);
  }
}

export async function unlinkRound(
  db: Db,
  actor: Actor & { roundId: unknown },
): Promise<ServiceResult<{ removed: true }>> {
  try {
    const target = await writableRequest(db, actor);
    if (!target.ok) return target;
    const { access, requestId } = target.data;
    if (typeof actor.roundId !== "string" || !isUuid(actor.roundId))
      return failure("not_found", NOT_FOUND);
    const { data, error } = await db
      .from("matter_request_rounds")
      .delete()
      .eq("id", actor.roundId)
      .eq("request_id", requestId)
      .select("round_number, document_id, version_id")
      .maybeSingle();
    if (error) return internalFailure(error);
    if (!data) return failure("not_found", NOT_FOUND);
    const row = data as unknown as { round_number: number; document_id: string; version_id: string };
    await recordRequestEvent(db, {
      requestId,
      matterId: access.matterId,
      actorUserId: actor.userId,
      action: "round_unlinked",
      detail: { round_number: row.round_number, document_id: row.document_id, version_id: row.version_id },
    });
    return ok({ removed: true });
  } catch (error) {
    return internalFailure(error);
  }
}
