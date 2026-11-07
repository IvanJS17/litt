// LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Draft
// and ready" and "Models"): an editor marks a draft ready, and marks or
// unmarks a ready playbook as a model for its workspace.

import { z } from "zod";
import { createServerSupabase, type Db } from "../../lib/supabase";
import { recordPlaybookAudit } from "./playbooks.audit";
import {
  assertPlaybookNotBeingReplaced,
  editablePlaybook,
  getPlaybook,
  PlaybookRequestError,
  playbookContentSchema,
} from "./playbooks.operations";
import {
  allRules,
  PLAYBOOK_CHANGES_PENDING_CODE,
  PLAYBOOK_CHANGES_PENDING_MESSAGE,
  PLAYBOOK_MODEL_EMPTY_CODE,
  PLAYBOOK_MODEL_EMPTY_MESSAGE,
  provenanceCounts,
} from "./playbooks.starter";
import type { Playbook } from "./playbooks.types";

const stateSchema = z
  .object({
    // One way only in layer 1: there is no "back to draft".
    status: z.literal("ready").optional(),
    isModel: z.boolean().optional(),
  })
  .strict()
  .refine((state) => state.status !== undefined || state.isModel !== undefined);

export const PLAYBOOK_STATE_CHANGED_MESSAGE =
  "El playbook cambió mientras se guardaba. Recarga la página e inténtalo de nuevo.";

/**
 * Mark a draft ready and/or set the model mark. Editor or owner. Marking
 * ready checks the complete content and refuses while proposed changes await
 * a decision; rules without backing and unverified references do not block
 * (the interface confirms with their counts, which the audit row keeps). The
 * write applies only over the version read, so it never overwrites an edit
 * saved in between.
 */
export async function setPlaybookState(
  userId: string,
  id: string,
  raw: unknown,
  db: Db = createServerSupabase(),
  email?: string | null,
): Promise<Playbook> {
  const parsed = stateSchema.safeParse(raw);
  if (!parsed.success)
    throw new PlaybookRequestError(
      "Indica status \"ready\" o isModel verdadero o falso.",
    );
  const playbook = await editablePlaybook(userId, id, db, email);
  const markReady = parsed.data.status === "ready" && playbook.status === "draft";
  const nextStatus = markReady ? "ready" : playbook.status;
  const nextModel = parsed.data.isModel ?? playbook.isModel;
  if (nextModel && nextStatus !== "ready")
    throw new PlaybookRequestError(
      "Solo un playbook listo puede marcarse como modelo.",
      409,
    );
  if (!markReady && nextModel === playbook.isModel) return playbook;
  // A model is offered as a starting point: an empty one is not one.
  if (nextModel && !playbook.isModel && allRules(playbook.content).length === 0)
    throw new PlaybookRequestError(PLAYBOOK_MODEL_EMPTY_MESSAGE, 409, {
      code: PLAYBOOK_MODEL_EMPTY_CODE,
    });

  // Any state write, the model mark alone included, waits for a replacement
  // or proposals compiling over this playbook.
  await assertPlaybookNotBeingReplaced(db, id);
  if (markReady) {
    if (!playbookContentSchema.safeParse(playbook.content).success)
      throw new PlaybookRequestError(
        "Completa el nombre, las reglas y las posiciones antes de marcar el playbook como listo.",
      );
    const pending = await db
      .from("playbook_changes")
      .select("id")
      .eq("playbook_id", id)
      .eq("status", "pending")
      .limit(1);
    if (pending.error) throw pending.error;
    if ((pending.data ?? []).length > 0)
      throw new PlaybookRequestError(PLAYBOOK_CHANGES_PENDING_MESSAGE, 409, {
        code: PLAYBOOK_CHANGES_PENDING_CODE,
      });
  }

  const { data, error } = await db
    .from("playbooks")
    .update({
      status: nextStatus,
      is_model: nextModel,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("updated_at", playbook.updatedAt)
    .select("id");
  if (error) throw error;
  if (!data?.length)
    throw new PlaybookRequestError(PLAYBOOK_STATE_CHANGED_MESSAGE, 409);

  const audit = { userId, userEmail: email, orgId: playbook.orgId, title: playbook.name };
  if (markReady)
    void recordPlaybookAudit(db, {
      ...audit,
      action: "playbook.marked_ready",
      detail: { playbook_id: id, ...provenanceCounts(playbook.content) },
    });
  if (nextModel !== playbook.isModel)
    void recordPlaybookAudit(db, {
      ...audit,
      action: nextModel ? "playbook.model_marked" : "playbook.model_unmarked",
      detail: { playbook_id: id },
    });
  return getPlaybook(userId, id, db, email);
}
