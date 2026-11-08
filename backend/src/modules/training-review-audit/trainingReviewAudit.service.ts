// Facade of LiTT training layer 3, bulk review designer (docs/training.md).
export { AUDIT_STALE_CODE } from "./trainingReviewAudit.shared";
export {
    completeReviewAudit,
    getReviewAudit,
    markReviewAuditCell,
    startReviewAudit,
} from "./trainingReviewAudit.junior";
export { evaluateReviewAudit, listPupilReviewAudits, readEvaluationBody } from "./trainingReviewAudit.mentor";
