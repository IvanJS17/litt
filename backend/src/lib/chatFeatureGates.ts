// LiTT gates for chat capabilities that need an owner decision (ledger 16.3,
// "Web search and subagents in chat"). Both are off unless the deployment
// switches them on, whatever a user's own settings say:
//
// - web search sends the user's question to a search service (the model
//   provider's or a third party's), a destination the conversation's route
//   does not name. It stays off.
// - subagents: on in production by the owner's decision of 2026-10-30. A
//   subagent runs on one of the named model routes the user configured in
//   Settings > Subagents (after the `model_map` mode of the Hermes
//   advanced-delegation plugin), or on the conversation's model when there
//   are none. The assistant sees only route names and descriptions; a route
//   that cannot run fails closed and never falls back to another model.
//
// Turning one on is a deployment decision recorded with the owner's approval.

export function chatWebSearchEnabled(): boolean {
    return process.env.LITT_CHAT_WEB_SEARCH?.trim() === "enabled";
}

export function chatSubagentsEnabled(): boolean {
    return process.env.LITT_CHAT_SUBAGENTS?.trim() === "enabled";
}
