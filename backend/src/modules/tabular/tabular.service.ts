// Service facade for the tabular-review module. Named re-exports only — the
// module's public service surface in one place, without leaking intra-module
// helpers. Routes import from the topic files directly (they live in the same
// module); everything OUTSIDE the module — the extraction worker, the
// stale-work sweep, tests that want a stable path — imports from here and
// only here.

export { loadReviewRow } from "./tabular.rows";
export { extractRowColumns, finalizeCell } from "./tabular.extractRow";
export {
    finishGenerationIfIdle,
    renewGeneration,
    validateSelectedModel,
    REVIEW_EDIT_FORBIDDEN,
    TABULAR_GENERATION_HEARTBEAT_MS,
    type Column,
} from "./tabular.shared";

export { handleExtractionExtract, markExtractionJobFailed } from "./tabular.extractionJobs";
export { sweepStaleGeneratingCells } from "./tabular.maintenance";

export { runExtractionJob, markExtractionFailed, extractionJobOperation, isRefusalShownToUser } from "./tabular.extraction";

// What the MCP tools (modules/mcp) use: the same services the routes call.
export { listTabularReviews, createTabularReview, getTabularReviewDetail } from "./tabular.reviews";
export { parseTabularReviewScope } from "./tabular.overview";
export { prepareTabularGenerate, preparedGenerateFailure } from "./tabular.generate";
export {
    startTabularGeneration,
    runTabularGeneration,
    stopTabularGeneration,
    savedTabularModel,
    reviewRunKey,
    type StartedTabularGeneration,
} from "./tabular.generation";
export { isReviewGenerationRunning, parseCellContent, type TabularFailure } from "./tabular.shared";

// The review chat (what POST /:reviewId/chat and the chat list routes use), for
// the MCP tools: the turn without HTTP, and the same reads and access gates.
export {
    abandonTabularChatTurn,
    parseTabularChatRequest,
    runTabularChatTurn,
    startTabularChatTurn,
    type ParsedTabularChatRequest,
    type StartedTabularChatTurn,
    type StartTabularChatTurnResult,
    type TabularChatTurnSink,
} from "./tabular.chatTurn";
export {
    ensureReviewChatReadAccess,
    ensureReviewChatWriteAccess,
    listTabularReviewChatMessages,
    listTabularReviewChatSources,
    listTabularReviewChats,
    type ReviewChatSummary,
} from "./tabular.chats";
