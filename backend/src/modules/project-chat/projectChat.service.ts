// Service facade for the project-chat module. Named re-exports only: the
// module's public surface in one place, without leaking intra-module helpers.
// Routes import from the topic files directly (they live in the same module);
// everything OUTSIDE the module (the MCP tools, tests that want a stable path)
// imports from here and only here.

export { insertAssistantMessage, prepareProjectChatStream, updateChatTitle } from "./projectChat.prepare";
export type { ChatWriteResult, PreparedProjectChatStream } from "./projectChat.prepare";
export {
    abandonProjectChatTurn,
    parseProjectChatRequest,
    runProjectChatTurn,
    startProjectChatTurn,
    type ParsedProjectChatRequest,
    type ProjectChatTurnSink,
    type StartedProjectChatTurn,
    type StartProjectChatTurnFailure,
} from "./projectChat.turn";
