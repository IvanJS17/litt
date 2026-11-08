// Shapes shared by the training-turn wiring (see ./index.ts).

import type { TrainingStage } from "@mike/contracts";
import type { UserApiKeys } from "../llm";
import type { Db } from "../supabase";

/** The four places a person can take a turn. */
export type TrainingSurface = "chat" | "project_chat" | "word" | "tabular";

/** What a request body says about training. Unknown fields are ignored. */
export type TrainingBody = {
    /** The raw `attempt`; checked against the stage by the attempt behavior. */
    attempt: unknown;
    /** The raw `confidence`; checked by the confidence behavior. */
    confidence: unknown;
    /** Reserved for later cards; always null today. */
    mode: null;
    divergence: null;
};

/** The pasante's own mark on their approach: 1 «casi adivino» to 4 «seguro». */
export type TrainingConfidence = 1 | 2 | 3 | 4;

/** The one training parameter of the chat engine (`runLLMStream`). */
export type TrainingEnginePlan = {
    /** Text appended to the system prompt for this turn. */
    systemAddendum?: string;
    allowDocumentMutation?: false;
    includeAskInputs?: false;
    noSubagents?: true;
    /**
     * The organization whose written criteria the turn may consult
     * (list_firm_criteria). Read-only, with the caller's own membership.
     */
    firmCriteriaOrgId?: string;
    /** Offer compute_methodology (a junior's turn); absent for every other turn. */
    methodology?: true;
};

/**
 * The saved turn a hook may act on: whose it is, where, the saved assistant
 * message and what the conversation's own route needs to call a model again
 * (governed BYOK: never another model or key).
 */
export type TrainingTurnOutcome = {
    db: Db;
    userId: string;
    chatId: string;
    /** The assistant message the answer was saved in. */
    messageId: string;
    answer: string;
    model: string;
    apiKeys?: UserApiKeys;
    /**
     * Writes the llm.egress of a call the hook is about to make with this
     * route: same provider, model, credential and host as the turn's own,
     * recorded before any text is sent. A hook that calls a model awaits it
     * first and makes no call if it fails.
     */
    recordEgress: () => Promise<void>;
};

/** A hook that runs once the final answer is durable. */
export type AfterTurnHook = (ctx: {
    plan: TrainingTurnPlan;
    completed: boolean;
    /** Null when the turn was not saved (a local-only Word chat). */
    outcome: TrainingTurnOutcome | null;
}) => void | Promise<void>;

export type TrainingTurnPlan = {
    surface: TrainingSurface;
    /** The raw effective stage: the one the output lock uses. */
    stage: TrainingStage | null;
    passActive: boolean;
    /** The pupil's own approach, trimmed; null when the turn needs none. */
    attempt: string | null;
    /** The thermometer mark, when the turn owes an attempt; otherwise null. */
    confidence: TrainingConfidence | null;
    mode: null;
    step: null;
    /** The organization a note about this turn belongs to. */
    orgId: string | null;
    systemAddendum?: string;
    toolPolicy: Omit<TrainingEnginePlan, "systemAddendum">;
    afterTurn: AfterTurnHook[];
};

export type TrainingTurnFailure = {
    ok: false;
    status: 400;
    code: string;
    detail: string;
};

/** What a behavior reads about the turn once its stage is resolved. */
export type ResolvedTurn = {
    surface: TrainingSurface;
    body: TrainingBody;
    stage: TrainingTurnPlan["stage"];
    passActive: boolean;
    orgId: string | null;
};

/** A behavior refines the plan or refuses the turn. */
export type TrainingBehavior = (
    resolved: ResolvedTurn,
    plan: TrainingTurnPlan,
) => TrainingTurnFailure | TrainingTurnPlan;
