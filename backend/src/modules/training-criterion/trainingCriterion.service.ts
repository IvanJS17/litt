// Facade of LiTT training layer 3 «Criterio» (docs/training.md). Later cards
// add their files and their lines here; no chat module imports this one (the
// chat surfaces talk to lib/trainingTurn).
export { NOTE_NOT_JUDGEABLE_CODE, overrideNoteVerdict } from "./trainingCriterion.verdict";
export type { VerdictOverrideResult } from "./trainingCriterion.verdict";
export { getMyCriterion, getPupilCriterion } from "./trainingCriterion.view";
export {
    answerRetake,
    RETAKE_IN_PROGRESS_CODE,
    RETAKE_NOT_DUE_CODE,
    RETAKE_NOT_OPEN_CODE,
    startRetake,
} from "./trainingCriterion.retakes";
