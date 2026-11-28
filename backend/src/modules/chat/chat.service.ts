// Stable public API. Keep implementations in the topic files below.
export {
  getAccessibleChat,
} from "./chat.access";
export { getAttachmentsOfChats, getChatMessages, getMessagesOfChats } from "./chat.messages";
export {
  withChatOrigin,
  chatOriginColumns,
  listChatsCreatedByGrant,
  type ChatOrigin,
  type GrantChat,
} from "./chat.origin";
export {
  assistantText,
  activeChatTurn,
  loadChatHistory,
  readChatTurn,
  stopChatTurn,
  type ChatTurnState,
  type ChatTurnStatus,
} from "./chat.history";
export {
  listChats,
  createChat,
  deleteChat,
  discardRejectedChatInput,
  type ChatWriteResult,
} from "./chat.crud";
export {
  listChatPeople,
  listChatGrants,
  grantChatAccess,
  revokeChatAccess,
  leaveChat,
  withChatLeaveAccess,
} from "./chat.sharing";
export { updateChatSettings } from "./chat.settings";
export { updateChatTitle } from "./chat.titles";
export { prepareChatStream } from "./chat.prepare";
// The chat turn without HTTP: parse a request body, start the turn, run its
// generation loop against a sink (see chat.turn.ts).
export {
  parseChatTurnRequest,
  startChatTurn,
  runChatTurn,
  abandonChatTurn,
  type ChatTurnSink,
  type ParsedChatTurnRequest,
  type StartedChatTurn,
  type StartChatTurnFailure,
} from "./chat.turn";
export {
  devLog,
  appendAssistantEventsToMessage,
  AssistantStreamError,
  assistantStreamErrorPayload,
  ASSISTANT_ERROR_MESSAGE,
  buildCancelledAssistantMessage,
  buildStoppedAssistantEvent,
  buildStoppedAssistantMessage,
  extractCitations,
  isAbortError,
  runLLMStream,
  stripTransientAssistantEvents,
  throwIfTurnStopped,
  PROJECT_EXTRA_TOOLS,
  parseChatMessages,
  parseOptionalAskInputsResponse,
  parseOptionalAttachedDocuments,
  parseOptionalChatId,
  parseOptionalDisplayedDoc,
  parseOptionalModel,
  parseOptionalReasoning,
  buildProjectDocContext,
  buildMessages,
  loadUserMessageSentTimes,
  loadAppWrittenUserMessages,
  appWrittenMessage,
  APP_MESSAGE_POLICY,
  userMessageStamper,
  type MessageTimeContext,
  buildUserPersonalisationPrompt,
  buildFirmProfilePrompt,
  buildWorkflowStore,
  attachPriorReasoning,
  createAssistantHistoryLoader,
  enrichWithPriorEvents,
  appendAskInputsResponseToAssistantMessage,
  runApprovedConnectorActions,
  writeApprovedConnectorFrames,
  generateSpotlightNonce,
  spotlightFilename,
  createSubagentRunStore,
  purgeExpiredSubagentRuns,
  type AskInputsResponseRequest,
  type AssistantEvent,
  type ChatDocumentReference,
  type ChatMessage,
  type SubagentRoutePlan,
  type TabularCellStore,
  TABULAR_TOOLS,
  parseOptionalDocumentContext,
  createReservedAssistantMessageUpdater,
  createWordClientToolsAdapter,
  isClientToolCallPending,
  logAssistantMessageFailure,
  requestIdOf,
  reserveAssistantMessage,
  submitClientToolResult,
  ACTIVE_WORD_DOCUMENT_ID,
  buildDocContext,
  buildWordChatSystemPrompt,
  withoutEmptyAssistantReservations,
  startedByConnectedApp,
  type ToolCapability,
} from "./engine/index";
export { generateAssistantChatTitle, logChatTitleFailure } from "./chat.title";

export {
  persistWordDocumentEdits,
  WORD_EDIT_FORMATS,
  type WordEditApplyMode,
} from "./engine/wordDocumentEdits";

// Locating a quote in a document's text, for services that check a model's
// quote against the source (the periodic full reading of the training layer).
export { createQuoteVerifier, locateQuote, verifyQuoteAgainstSource } from "./engine/verifyCitations";
