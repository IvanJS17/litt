// Facade of LiTT training layer 2 «Supervisión» (docs/training.md).
export { assertLearningAccess, LEARNING_NOT_FOUND } from "./trainingSupervision.access";
export { getMySupervision } from "./trainingSupervision.me";
export {
    grantUrgencyPass,
    listUrgencyPasses,
    revokeUrgencyPass,
} from "./trainingSupervision.passes";
