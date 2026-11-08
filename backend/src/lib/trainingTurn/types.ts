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
    /** The raw `training_mode`; checked against the stage by the modes behavior. */
    mode: unknown;
    /** The raw `criteria_routes`: the two routes of a criteria contrast; checked by criteria.ts. */
    criteriaRoutes: unknown;
    /** The raw `criteria_explanation`: the person's own explanation, step 2 of the contrast. */
    criteriaExplanation: unknown;
    /** Reserved for later cards; always null today. */
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
     * The answer may name laws the server cannot show: the engine appends this
     * line when it names a legal reference no verified citation of the turn
     * backs (lib/trainingHint.ts). The server decides, never the model.
     */
    unverifiedFooter?: string;
    /**
     * The organization whose written criteria the turn may consult
     * (list_firm_criteria). Read-only, with the caller's own membership.
     */
    firmCriteriaOrgId?: string;
    /** Offer compute_methodology (a junior's turn); absent for every other turn. */
    methodology?: true;
    /**
     * A criteria contrast (docs/training.md, "Criteria contrast"): the answer
     * must hand the same assignment to exactly two subagents, each on the
     * route or approach decided here. Only restricts the subagent tool.
     */
    delegation?: CriteriaDelegation;
};

/** The two ways of reading a case a subagent may be given when the person has fewer than two routes. */
export type CriteriaApproach = "literal" | "systematic";

/** What one of the two subagents runs on: a route of the person's own, or a neutral approach on the conversation's model. */
export type CriteriaAssignment = { route: string | null; approach: CriteriaApproach | null };

/** What a subagent of the contrast actually ran on and returned, written by the engine. */
export type CriteriaRun = {
    route?: string;
    approach?: CriteriaApproach;
    provider?: string;
    model: string;
    status: string;
    brief: string;
};

export type CriteriaDelegation = {
    /** The route names the person chose, or null when they chose none. */
    requestedRoutes: string[] | null;
    /** Decided once the person's routes are known (resolveCriteriaDelegation); null before. */
    assignments: CriteriaAssignment[] | null;
    /** Filled by the engine, in assignment order; a missing entry is a subagent that did not run. */
    runs: (CriteriaRun | null)[];
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

/**
 * A turn mode: a pasante's hint or round with the counterparty's lawyer, or a
 * junior's criteria contrast (two subagents, then the person's explanation).
 */
export type TrainingMode =
    | "hint"
    | "counterpart"
    | "counterpart_close"
    | "criteria_contrast"
    | "criteria_explain";

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
    /** The mode of this turn, decided by the server (modes.ts); null for an ordinary turn. */
    mode: TrainingMode | null;
    /** Rung of the hint ladder, or turn of the counterpart round (1 to 3); set with `mode`. */
    step: 1 | 2 | 3 | null;
    /** Step 2 of a criteria contrast: the open contrast and what the person wrote. */
    criteria?: { contrastId: string; explanation: string };
    /** The attempts of the open counterpart round, oldest first, with this turn's last: the closing contrast compares them. */
    roundAttempts?: string[];
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
    /** Behaviors that read what the turn's chat already holds query with these. */
    db: Db;
    userId: string;
    /** The chat the turn continues, when it continues one the surface keeps; null for a new or unsaved chat. */
    chatId: string | null;
    /** False for a chat the server keeps no notes of (Word with local storage). */
    persisted: boolean;
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
) => TrainingTurnFailure | TrainingTurnPlan | Promise<TrainingTurnFailure | TrainingTurnPlan>;
