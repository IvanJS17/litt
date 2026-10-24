/**
 * AI evidence module facade.
 *
 * Everything outside `modules/ai-recovery/` (today: `app.ts`, and the tests)
 * imports this module through these named re-exports only. `export *` is not
 * used: the architecture test rejects it, and an explicit list is what makes a
 * silent surface change visible in review.
 */

export { listExecutions, readReview } from "./ai-recovery.executions";
export type { AiExecutionSummary } from "./ai-recovery.executions";
export {
  completeReview,
  createReview,
  decideReviewItem,
} from "./ai-recovery.reviews";
export {
  appendRedlineBundle,
  readRedlineBundle,
} from "./ai-recovery.redline";
export {
  APPROVED_REPORT_FILENAME,
  APPROVED_REPORT_MIME,
  produceReport,
  readReport,
} from "./ai-recovery.reports";
export {
  publishApprovedArtifact,
  readDrivePublication,
  reconcileDrivePublication,
} from "./ai-recovery.drive";
