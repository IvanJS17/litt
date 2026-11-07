// Facade of LiTT training layer 2 «Supervisión» (docs/training.md).
export { assertLearningAccess, LEARNING_NOT_FOUND } from "./trainingSupervision.access";
export { getMySupervision } from "./trainingSupervision.me";
export {
    generateWorkReview,
    listPupilWorks,
    markWorkReviewed,
    REVIEW_IN_PROGRESS_CODE,
    REVIEW_KEY_REQUIRED_CODE,
} from "./trainingSupervision.reviews";
