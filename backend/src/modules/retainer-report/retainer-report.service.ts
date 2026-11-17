/**
 * Facade of the retainer-report module: the report a lawyer sends to a
 * retainer client (a document LiTT computes from confirmed data and never
 * sends) and the lawyer's record that it was sent (docs/retainer-report.md).
 */

export { reportDocx, reportFilename, reportMarkdown } from "./retainer-report.docx";
export { getRetainerReport } from "./retainer-report.read";
export { listReportsSent, markReportSent } from "./retainer-report.sent";
