// Shapes shared by the training-turn wiring (see ./index.ts).

import type { TrainingStage } from "@mike/contracts";

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
};

/** A hook that runs once the final answer is durable. */
export type AfterTurnHook = (ctx: {
    plan: TrainingTurnPlan;
    completed: boolean;
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
