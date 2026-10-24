// LiTT gates for chat capabilities that need an owner decision (ledger 16.3,
// "Web search and subagents in chat"). Both arrive switched off for every
// user, whatever their own settings say:
//
// - web search sends the user's question to a search service (the model
//   provider's or a third party's), a destination the conversation's route
//   does not name;
// - a subagent could otherwise run on a model other than the one the
//   conversation is fixed to. When an operator turns subagents on, they still
//   run on the conversation's own model and credential.
//
// Turning one on is a deployment decision recorded with the owner's approval.

export function chatWebSearchEnabled(): boolean {
    return process.env.LITT_CHAT_WEB_SEARCH?.trim() === "enabled";
}

export function chatSubagentsEnabled(): boolean {
    return process.env.LITT_CHAT_SUBAGENTS?.trim() === "enabled";
}
