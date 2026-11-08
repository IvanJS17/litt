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
import { launchCounterpartClose } from "../trainingCounterpart";
import { accountabilityHook, isAccountable } from "./accountability";
import { applyAttempt } from "./attempt";
import { withFirmCriteria } from "./criteria";
import { readTrainingBody } from "./body";
import { confidenceBehavior } from "./confidence";
import { modesBehavior } from "./modes";
import { hasUnverifiedCitation } from "./unverified";
import { methodologyBehavior } from "./methodology";
import type {
    ResolvedTurn,
    TrainingBehavior,
    TrainingEnginePlan,
    TrainingSurface,
    TrainingTurnFailure,
    TrainingTurnPlan,
} from "./types";

export { readTrainingBody } from "./body";
export { TRAINING_CONFIDENCE_REQUIRED_CODE } from "./confidence";
export {
    availableModes,
    noteChatOf,
    TRAINING_COUNTERPART_DONE_CODE,
    TRAINING_HINT_LIMIT_CODE,
    TRAINING_MODE_NOT_ALLOWED_CODE,
} from "./modes";
export { hasUnverifiedCitation } from "./unverified";
export { criteriaOpen, resolveCriteriaDelegation } from "./criteriaContrast";
export type {
    CriteriaDelegation,
    CriteriaRun,
    TrainingBody,
    TrainingConfidence,
    TrainingEnginePlan,
    TrainingMode,
    TrainingSurface,
    TrainingTurnFailure,
    TrainingTurnPlan,
} from "./types";

type Resolved = ResolvedTurn;
type Behavior = TrainingBehavior;

const attemptBehavior: Behavior = (resolved, plan) => {
    // An urgency pass lifts the requirement, not the stage.
    const check = applyAttempt(resolved.passActive ? null : resolved.stage, resolved.body.attempt);
    return check.ok ? { ...plan, attempt: check.attempt } : check;
};

const firmCriteriaBehavior: Behavior = (resolved, plan) => withFirmCriteria(plan, resolved.stage, resolved.orgId);

// A junior's answer is held to account after the turn (./accountability.ts).
const accountabilityBehavior: Behavior = (resolved, plan) =>
    isAccountable(resolved.stage, resolved.orgId)
        ? { ...plan, afterTurn: [...plan.afterTurn, accountabilityHook] }
        : plan;

/** One line per behavior; later cards add theirs here. */
// Order matters: modesBehavior is last. A mode only restricts, so it sees the
// plan the others built and takes back anything that would write or widen
// (methodology included); no earlier behavior can undo a mode's limits.
const BEHAVIORS: readonly Behavior[] = [
    attemptBehavior,
    confidenceBehavior,
    accountabilityBehavior,
    methodologyBehavior,
    firmCriteriaBehavior,
    modesBehavior,
];

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
        /** The chat the turn continues, if the surface already keeps one (a hint's rung is counted from its notes). */
        chatId?: string | null;
        /** False when the server keeps no transcript or notes of this chat (Word with local storage). */
        persisted?: boolean;
    },
): Promise<{ ok: true; plan: TrainingTurnPlan } | TrainingTurnFailure> {
    const body = readTrainingBody(args.body);
    const common = {
        db,
        userId: args.userId,
        chatId: args.chatId ?? null,
        persisted: args.persisted !== false,
    };
    let resolved: Resolved;
    if (args.surface === "word") {
        const { stage, orgId } = await resolveWordTrainingStage(db, args.userId);
        resolved = { ...common, surface: args.surface, body, stage, passActive: false, orgId };
    } else {
        const turn = await resolveTurnTraining(db, args.userId, args.scope);
        resolved = {
            ...common,
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
        const next = await behavior(resolved, plan);
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
        confidence: plan.confidence,
        mode: plan.mode,
        step: plan.step,
        // Pending until the turn is delivered: a hint or a counterpart turn has
        // no answer to contrast, so finishTrainingTurn settles it as skipped,
        // and the ladder (lib/trainingHint.ts) counts only those. The close of
        // a round is contrasted with its own sections.
        contrastStatus: "pending",
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
        /**
         * The citations persisted with the answer, whichever shape the
         * surface keeps them in. One the server could not verify makes the
         * note answer_unverified: such a turn does not count as evidence.
         */
        citations?: unknown;
        /** The saved turn, for the hooks; omit when nothing was saved. */
        turn?: {
            userId: string;
            chatId: string;
            messageId: string | null | undefined;
            /** See TrainingTurnOutcome.recordEgress; the route of the turn. */
            recordEgress: () => Promise<void>;
        };
    },
): void {
    if (!args.completed) return;
    // A delivered hint or counterpart turn has nothing to contrast: it counts
    // on the ladder from here on, and not before.
    if (args.note && (args.plan?.mode === "hint" || args.plan?.mode === "counterpart")) {
        const noteId = args.note.id;
        void Promise.resolve(
            db.from("training_turn_notes").update({ contrast_status: "skipped" }).eq("id", noteId).eq("contrast_status", "pending"),
        ).then(
            (result) => {
                if (result?.error) console.warn("[training] mode note not settled", { noteId, error: result.error });
            },
            (error) => console.warn("[training] mode note not settled", { noteId, error }),
        );
    }
    // A hint or a counterpart turn has no answer to compare with: its note is
    // already skipped. The close of a round is contrasted with its own sections.
    if (args.note && args.plan?.mode === "counterpart_close") {
        launchCounterpartClose(db, {
            noteId: args.note.id,
            attempts: args.plan.roundAttempts ?? [args.note.attempt],
            answer: args.answer,
            model: args.model,
            apiKeys: args.apiKeys,
        });
    } else if (args.note && !args.plan?.mode) {
        launchTurnContrast(db, {
            noteId: args.note.id,
            attempt: args.note.attempt,
            answer: args.answer,
            model: args.model,
            apiKeys: args.apiKeys,
            answerUnverified: hasUnverifiedCitation(args.citations),
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
                      recordEgress: args.turn.recordEgress,
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
