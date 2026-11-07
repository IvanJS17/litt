// Facade of LiTT training layer 2 «Supervisión» (docs/training.md).
export { assertCurrentMentor, assertLearningAccess, LEARNING_NOT_FOUND } from "./trainingSupervision.access";
export {
    createDefense,
    DEFENSE_ALREADY_RECORDED_CODE,
    generateDefenseQuestions,
    listDefenses,
    recordDefenseOutcome,
} from "./trainingSupervision.defenses";
export { acceptPromotion, getPromotion, PROMOTION_NOT_PROPOSED_CODE } from "./trainingSupervision.promotion";
export { getMySupervision } from "./trainingSupervision.me";
export {
    generateWorkReview,
    listPupilWorks,
    markWorkReviewed,
    REVIEW_IN_PROGRESS_CODE,
    REVIEW_KEY_REQUIRED_CODE,
} from "./trainingSupervision.reviews";
export {
    grantUrgencyPass,
    listUrgencyPasses,
    revokeUrgencyPass,
} from "./trainingSupervision.passes";
