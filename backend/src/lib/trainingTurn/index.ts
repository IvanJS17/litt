// The single wiring of a training turn (docs/training.md, docs/backend-architecture.md).
//
// Chat, project chat, Word and tabular review each take a turn the same way:
// resolve the author's stage, check what the stage requires of the message,
// record the private note once the user message is saved, and settle the
// contrast once the answer is durable. They call these three functions; a
// training behavior is a file in this folder and one line in BEHAVIORS.
//
// Layering: this is `lib/`, so it imports nothing from `modules/`.

import type { Db } from "../supabase";
import {
    resolveWordTrainingStage,
    type TrainingScope,
} from "../training";
import { resolveTurnTraining } from "../trainingPass";
import {
    createPendingTurnNote,
    launchTurnContrast,
    type CreatedTurnNote,
} from "../trainingNotes";
import type { UserApiKeys } from "../llm";
import { accountabilityHook, isAccountable } from "./accountability";
import { applyAttempt } from "./attempt";
import { readTrainingBody } from "./body";
import type {
    TrainingBody,
    TrainingEnginePlan,
    TrainingSurface,
    TrainingTurnFailure,
    TrainingTurnPlan,
} from "./types";

export { readTrainingBody } from "./body";
export type {
    TrainingBody,
    TrainingEnginePlan,
    TrainingSurface,
    TrainingTurnFailure,
    TrainingTurnPlan,
} from "./types";

type Resolved = {
    surface: TrainingSurface;
    body: TrainingBody;
    stage: TrainingTurnPlan["stage"];
    passActive: boolean;
    orgId: string | null;
};

/** A behavior refines the plan or refuses the turn. */
type Behavior = (
    resolved: Resolved,
    plan: TrainingTurnPlan,
) => TrainingTurnFailure | TrainingTurnPlan;

const attemptBehavior: Behavior = (resolved, plan) => {
    // An urgency pass lifts the requirement, not the stage.
    const check = applyAttempt(resolved.passActive ? null : resolved.stage, resolved.body.attempt);
    return check.ok ? { ...plan, attempt: check.attempt } : check;
};

// A junior's answer is held to account after the turn (./accountability.ts).
const accountabilityBehavior: Behavior = (resolved, plan) =>
    isAccountable(resolved.stage, resolved.orgId)
        ? { ...plan, afterTurn: [...plan.afterTurn, accountabilityHook] }
        : plan;

/** One line per behavior; later cards add theirs here. */
const BEHAVIORS: readonly Behavior[] = [attemptBehavior, accountabilityBehavior];

/**
 * Resolves the author's stage and applies every behavior. A refusal is the
 * 400 the surface returns as is; a stage read failure throws, so the surface
 * answers its own internal error and never skips what the stage requires.
 *
 * `scope` is ignored for Word: a Word chat has no organization or project,
 * so the one Word rule decides (resolveWordTrainingStage).
 */
export async function beginTrainingTurn(
    db: Db,
    args: {
        surface: TrainingSurface;
        userId: string;
        scope: TrainingScope;
        /** The request body, or what readTrainingBody returned for it. */
        body: unknown;
    },
): Promise<{ ok: true; plan: TrainingTurnPlan } | TrainingTurnFailure> {
    const body = readTrainingBody(args.body);
    let resolved: Resolved;
    if (args.surface === "word") {
        const { stage, orgId } = await resolveWordTrainingStage(db, args.userId);
        resolved = { surface: args.surface, body, stage, passActive: false, orgId };
    } else {
        const turn = await resolveTurnTraining(db, args.userId, args.scope);
        resolved = {
            surface: args.surface,
            body,
            stage: turn.stage,
            passActive: turn.passActive,
            orgId: args.scope.orgId,
        };
    }
    let plan: TrainingTurnPlan = {
        surface: resolved.surface,
        stage: resolved.stage,
        passActive: resolved.passActive,
        attempt: null,
        confidence: null,
        mode: null,
        step: null,
        orgId: resolved.orgId,
        toolPolicy: {},
        afterTurn: [],
    };
    for (const behavior of BEHAVIORS) {
        const next = behavior(resolved, plan);
        if ("ok" in next) return next;
        plan = next;
    }
    return { ok: true, plan };
}

/** The `trainingPlan` argument of runLLMStream; undefined while a plan asks nothing of the engine. */
export function trainingEnginePlan(plan: TrainingTurnPlan | null | undefined): TrainingEnginePlan | undefined {
    if (!plan) return undefined;
    const enginePlan: TrainingEnginePlan = {
        ...(plan.systemAddendum ? { systemAddendum: plan.systemAddendum } : {}),
        ...plan.toolPolicy,
    };
    return Object.keys(enginePlan).length > 0 ? enginePlan : undefined;
}

/**
 * Records the private note of a turn, pending, once the user message is
 * saved. No note when the turn carries no attempt, has no organization, or
 * the message was not persisted (a local-only Word chat keeps nothing).
 */
export async function recordTrainingNote(
    db: Db,
    args: {
        plan: TrainingTurnPlan;
        userId: string;
        chatId: string;
        messageId: string | null | undefined;
    },
): Promise<{ ok: true; note: CreatedTurnNote | null } | { ok: false; error: unknown }> {
    const { plan } = args;
    if (!plan.attempt || !plan.orgId || !args.messageId) return { ok: true, note: null };
    const created = await createPendingTurnNote(db, {
        surface: plan.surface === "project_chat" ? "chat" : plan.surface,
        orgId: plan.orgId,
        traineeUserId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        attempt: plan.attempt,
    });
    return created.ok ? { ok: true, note: created.note } : created;
}

/**
 * Settles a turn once its final answer is durable: the pasante's private
 * contrast is produced aside from the turn, with the conversation's own model
 * and credential. It cannot fail the turn. `completed` is false when the turn
 * ended in an error event (or its answer was not saved).
 */
export function finishTrainingTurn(
    db: Db,
    args: {
        plan: TrainingTurnPlan | null;
        note: CreatedTurnNote | null;
        completed: boolean;
        answer: string;
        model: string;
        apiKeys?: UserApiKeys;
        /** The saved turn, for the hooks; omit when nothing was saved. */
        turn?: { userId: string; chatId: string; messageId: string | null | undefined };
    },
): void {
    if (!args.completed) return;
    if (args.note) {
        launchTurnContrast(db, {
            noteId: args.note.id,
            attempt: args.note.attempt,
            answer: args.answer,
            model: args.model,
            apiKeys: args.apiKeys,
        });
    }
    if (args.plan) {
        const outcome =
            args.turn?.messageId
                ? {
                      db,
                      userId: args.turn.userId,
                      chatId: args.turn.chatId,
                      messageId: args.turn.messageId,
                      answer: args.answer,
                      model: args.model,
                      apiKeys: args.apiKeys,
                  }
                : null;
        for (const hook of args.plan.afterTurn) {
            // A hook never fails the turn.
            try {
                void Promise.resolve(hook({ plan: args.plan, completed: args.completed, outcome })).catch(() => {});
            } catch {
                // Ignored: see above.
            }
        }
    }
}
