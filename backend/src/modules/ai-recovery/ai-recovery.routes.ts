import { Router, type Response } from "express";

import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import { sendInternalError } from "../../lib/httpError";
import {
  sendServiceFailure,
  type ServiceResult,
} from "../../lib/serviceResult";
import type { AuthenticatedIdentity } from "../../lib/recovery/identity/authStateMatrix";
import {
  appendRedlineBundle,
  completeReview,
  createReview,
  decideReviewItem,
  listExecutions,
  produceReport,
  publishApprovedArtifact,
  readDrivePublication,
  readRedlineBundle,
  readReport,
  readReview,
  reconcileDrivePublication,
} from "./ai-recovery.service";
import {
  hasExactKeys,
  isNonEmptyString,
  isPostgresUuid,
  isRecord,
  isUuid,
} from "./ai-recovery.validation";

export const aiRecoveryRouter = Router({ mergeParams: true });

const DECISION_KEYS = [
  "idempotency_key",
  "decision",
  "finding_text",
  "comment",
] as const;
const TERMINAL_STATE_KEYS = ["idempotency_key", "terminal_state"] as const;
const APPROVED_REPORT_IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

function identityOf(res: Response): AuthenticatedIdentity | null {
  const identity = res.locals.authenticatedIdentity as
    | AuthenticatedIdentity
    | undefined;
  return identity ?? null;
}

/**
 * Send one service result. A success is 200 unless the caller says otherwise
 * (a first write answers 201); a failure keeps the shared mapping, so the
 * `code`/`detail` pair the client already reads does not drift per handler.
 */
function send<T>(
  res: Response,
  result: ServiceResult<T>,
  status = 200,
): Response {
  if (!result.ok) return sendServiceFailure(res, result);
  return res.status(status).json(result.data);
}

function applied(receipt: { disposition: string }): number {
  return receipt.disposition === "applied" ? 201 : 200;
}

aiRecoveryRouter.get("/", requireAuth, async (req, res) => {
  const projectId = req.params.projectId;
  const identity = identityOf(res);
  if (!isNonEmptyString(projectId) || !identity) {
    return sendInternalError(res, new Error("invalid authenticated request"));
  }
  return send(
    res,
    await listExecutions(createServerSupabase(), {
      project_id: projectId,
      identity,
    }),
  );
});

aiRecoveryRouter.get("/:executionId/review", requireAuth, async (req, res) => {
  const projectId = req.params.projectId;
  const executionId = req.params.executionId;
  const identity = identityOf(res);
  if (
    !isNonEmptyString(projectId) ||
    !isNonEmptyString(executionId) ||
    !identity
  ) {
    return sendInternalError(res, new Error("invalid authenticated request"));
  }
  return send(
    res,
    await readReview(createServerSupabase(), {
      project_id: projectId,
      execution_id: executionId,
      identity,
    }),
  );
});

aiRecoveryRouter.get(
  "/:executionId/review/drive-publications/:publicationId",
  requireAuth,
  async (req, res) => {
    const { projectId, executionId, publicationId } = req.params;
    const identity = identityOf(res);
    if (
      !isPostgresUuid(projectId) ||
      !isPostgresUuid(executionId) ||
      !isPostgresUuid(publicationId) ||
      !identity
    )
      return res.status(400).json({
        code: "invalid_drive_publication",
        detail: "Invalid Drive publication.",
      });
    return send(
      res,
      await readDrivePublication(createServerSupabase(), {
        project_id: projectId,
        execution_id: executionId,
        publication_id: publicationId,
        identity,
      }),
    );
  },
);

aiRecoveryRouter.post(
  "/:executionId/review/drive-publications",
  requireAuth,
  async (req, res) => {
    const received = req.body;
    const body = isRecord(received) ? { ...received } : received;
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ["export_id", "expected_review_revision"]) ||
      !isPostgresUuid(body.export_id) ||
      !Number.isSafeInteger(body.expected_review_revision) ||
      (body.expected_review_revision as number) < 1
    )
      return res.status(400).json({
        code: "invalid_drive_publication",
        detail: "Invalid Drive publication.",
      });

    const { projectId, executionId } = req.params;
    const identity = identityOf(res);
    if (!isPostgresUuid(projectId) || !isPostgresUuid(executionId) || !identity)
      return res.status(400).json({
        code: "invalid_drive_publication",
        detail: "Invalid Drive publication.",
      });

    const result = await publishApprovedArtifact(createServerSupabase(), {
      project_id: projectId,
      execution_id: executionId,
      identity,
      export_id: body.export_id,
      expected_review_revision: body.expected_review_revision as number,
      transport: req.app.locals.recoveryDriveTransport,
    });
    return send(res, result, result.ok && result.data.disposition === "uploaded" ? 201 : 200);
  },
);

aiRecoveryRouter.post(
  "/:executionId/review/drive-publications/:publicationId/reconcile",
  requireAuth,
  async (req, res) => {
    const received = req.body;
    const body = isRecord(received) ? { ...received } : received;
    if (!isRecord(body) || !hasExactKeys(body, []))
      return res.status(400).json({
        code: "invalid_drive_publication",
        detail: "Invalid Drive publication.",
      });

    const { projectId, executionId, publicationId } = req.params;
    const identity = identityOf(res);
    if (
      !isPostgresUuid(projectId) ||
      !isPostgresUuid(executionId) ||
      !isPostgresUuid(publicationId) ||
      !identity
    )
      return res.status(400).json({
        code: "invalid_drive_publication",
        detail: "Invalid Drive publication.",
      });

    return send(
      res,
      await reconcileDrivePublication(createServerSupabase(), {
        project_id: projectId,
        execution_id: executionId,
        publication_id: publicationId,
        identity,
        transport: req.app.locals.recoveryDriveTransport,
      }),
    );
  },
);

aiRecoveryRouter.post("/:executionId/review", requireAuth, async (req, res) => {
  const body = req.body;
  if (
    !isRecord(body) ||
    !hasExactKeys(body, ["idempotency_key", "review_id"]) ||
    !isNonEmptyString(body.idempotency_key) ||
    !isNonEmptyString(body.review_id)
  )
    return res
      .status(400)
      .json({ code: "invalid_review", detail: "Invalid review." });

  const { projectId, executionId } = req.params;
  const identity = identityOf(res);
  if (
    !isNonEmptyString(projectId) ||
    !isNonEmptyString(executionId) ||
    !identity
  ) {
    return sendInternalError(res, new Error("invalid authenticated request"));
  }

  const result = await createReview(createServerSupabase(), {
    project_id: projectId,
    execution_id: executionId,
    identity,
    idempotency_key: body.idempotency_key,
    review_id: body.review_id,
  });
  return send(res, result, result.ok ? applied(result.data.receipt) : 200);
});

aiRecoveryRouter.post(
  "/:executionId/review/items/:itemId/decision",
  requireAuth,
  async (req, res) => {
    const body = req.body;
    if (
      !isRecord(body) ||
      !hasExactKeys(
        body,
        DECISION_KEYS.filter((key) => body[key] !== undefined),
      ) ||
      !isNonEmptyString(body.idempotency_key) ||
      !isNonEmptyString(body.decision) ||
      !(
        "accepted" === body.decision ||
        "rejected" === body.decision ||
        "edited" === body.decision
      )
    )
      return res
        .status(400)
        .json({ code: "invalid_review", detail: "Invalid review." });

    const { projectId, executionId, itemId } = req.params;
    const identity = identityOf(res);
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(executionId) ||
      !isNonEmptyString(itemId) ||
      !identity
    ) {
      return sendInternalError(res, new Error("invalid authenticated request"));
    }

    return send(
      res,
      await decideReviewItem(createServerSupabase(), {
        project_id: projectId,
        execution_id: executionId,
        item_id: itemId,
        identity,
        idempotency_key: body.idempotency_key,
        decision: body.decision,
        ...(body.finding_text === undefined
          ? {}
          : { finding_text: body.finding_text }),
        ...(body.comment === undefined ? {} : { comment: body.comment }),
      }),
    );
  },
);

aiRecoveryRouter.post(
  "/:executionId/review/complete",
  requireAuth,
  async (req, res) => {
    const body = req.body;
    if (
      !isRecord(body) ||
      !hasExactKeys(body, TERMINAL_STATE_KEYS) ||
      !isNonEmptyString(body.idempotency_key) ||
      (body.terminal_state !== "approved" &&
        body.terminal_state !== "changes_requested")
    )
      return res
        .status(400)
        .json({ code: "invalid_review", detail: "Invalid review." });

    const { projectId, executionId } = req.params;
    const identity = identityOf(res);
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(executionId) ||
      !identity
    ) {
      return sendInternalError(res, new Error("invalid authenticated request"));
    }

    return send(
      res,
      await completeReview(createServerSupabase(), {
        project_id: projectId,
        execution_id: executionId,
        identity,
        idempotency_key: body.idempotency_key,
        terminal_state: body.terminal_state,
      }),
    );
  },
);

aiRecoveryRouter.get(
  "/:executionId/review/redline-bundle",
  requireAuth,
  async (req, res) => {
    const { projectId, executionId } = req.params;
    const rawRevision = req.query.revision;
    const revision = rawRevision === undefined ? 1 : Number(rawRevision);
    const identity = identityOf(res);
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      (typeof rawRevision !== "undefined" &&
        (Array.isArray(rawRevision) ||
          String(rawRevision) !== String(revision)))
    ) {
      return res
        .status(400)
        .json({ code: "invalid_revision", detail: "Invalid revision." });
    }
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(executionId) ||
      !identity
    ) {
      return sendInternalError(res, new Error("invalid authenticated request"));
    }

    return send(
      res,
      await readRedlineBundle(createServerSupabase(), {
        project_id: projectId,
        execution_id: executionId,
        identity,
        revision,
      }),
    );
  },
);

aiRecoveryRouter.post(
  "/:executionId/review/redline-bundle",
  requireAuth,
  async (req, res) => {
    const body = req.body;
    if (
      !isRecord(body) ||
      !hasExactKeys(body, [
        "idempotency_key",
        "revision",
        "expected_review_revision",
      ]) ||
      !isNonEmptyString(body.idempotency_key) ||
      !Number.isSafeInteger(body.revision) ||
      (body.revision as number) < 1 ||
      !Number.isSafeInteger(body.expected_review_revision) ||
      (body.expected_review_revision as number) < 1
    )
      return res.status(400).json({
        code: "invalid_approved_redline",
        detail: "Invalid approved redline.",
      });

    const { projectId, executionId } = req.params;
    const identity = identityOf(res);
    if (
      !isNonEmptyString(projectId) ||
      !isNonEmptyString(executionId) ||
      !identity
    ) {
      return sendInternalError(res, new Error("invalid authenticated request"));
    }

    const result = await appendRedlineBundle(createServerSupabase(), {
      project_id: projectId,
      execution_id: executionId,
      identity,
      idempotency_key: body.idempotency_key,
      revision: body.revision as number,
      expected_review_revision: body.expected_review_revision as number,
    });
    return send(res, result, result.ok ? applied(result.data.receipt) : 200);
  },
);

aiRecoveryRouter.post(
  "/:executionId/review/approved-report",
  requireAuth,
  async (req, res) => {
    const body = req.body;
    if (
      !isRecord(body) ||
      !hasExactKeys(body, ["expected_review_revision", "idempotency_key"]) ||
      !isNonEmptyString(body.idempotency_key) ||
      !APPROVED_REPORT_IDEMPOTENCY_RE.test(body.idempotency_key) ||
      !Number.isSafeInteger(body.expected_review_revision) ||
      (body.expected_review_revision as number) < 1
    )
      return res.status(400).json({
        code: "invalid_approved_report",
        detail: "Invalid approved report.",
      });

    const { projectId, executionId } = req.params;
    const identity = identityOf(res);
    if (!isUuid(projectId) || !isUuid(executionId) || !identity)
      return res.status(400).json({
        code: "invalid_approved_report",
        detail: "Invalid approved report.",
      });

    const result = await produceReport(createServerSupabase(), {
      project_id: projectId,
      execution_id: executionId,
      identity,
      idempotency_key: body.idempotency_key,
      expected_review_revision: body.expected_review_revision as number,
    });
    return send(res, result, result.ok ? applied(result.data.receipt) : 200);
  },
);

aiRecoveryRouter.get(
  "/:executionId/review/approved-report",
  requireAuth,
  async (req, res) => {
    const { projectId, executionId } = req.params;
    const rawRevision = req.query.revision;
    const revision =
      rawRevision === undefined || Array.isArray(rawRevision)
        ? undefined
        : Number(rawRevision);
    const identity = identityOf(res);
    if (
      Object.keys(req.query).some((key) => key !== "revision") ||
      !isUuid(projectId) ||
      !isUuid(executionId) ||
      !identity ||
      (revision !== undefined &&
        (!Number.isSafeInteger(revision) ||
          revision < 1 ||
          !/^[1-9][0-9]*$/.test(rawRevision as string)))
    )
      return res.status(400).json({
        code: "invalid_approved_report",
        detail: "Invalid approved report.",
      });

    const result = await readReport(createServerSupabase(), {
      project_id: projectId,
      execution_id: executionId,
      identity,
      ...(revision === undefined ? {} : { revision }),
    });
    if (!result.ok) return sendServiceFailure(res, result);
    return res
      .type(result.data.mime_type)
      .set(
        "Content-Disposition",
        `attachment; filename="${result.data.filename}"`,
      )
      .send(Buffer.from(result.data.bytes));
  },
);
