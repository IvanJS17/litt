// Facade of LiTT training layer 4, the gym (docs/training.md).
export { createCase, deleteCase, draftCase, listCases, updateCase } from "./trainingGym.cases";
export {
    assignAttempt,
    getOwnAttempt,
    GYM_ATTEMPT_OPEN_CODE,
    GYM_CLOSED_CODE,
    GYM_NO_HINT_CODE,
    GYM_NOT_ASSIGNED_CODE,
    listOwnAttempts,
    listPupilAttempts,
    revealHint,
    saveFindings,
    startAttempt,
    submitAttempt,
} from "./trainingGym.attempts";
