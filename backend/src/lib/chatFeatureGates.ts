// LiTT gates for chat capabilities that need an owner decision (ledger 16.3,
// "Web search and subagents in chat"). Each is controlled by a deployment
// switch, whatever a user's own settings say:
//
// - web search: on by the owner's decision of 2026-11-10. It sends the user's
//   question to a search service (the model provider's or a third party's), a
//   destination the conversation's route does not name. It is switched off
//   with LITT_CHAT_WEB_SEARCH set to anything other than `enabled`.
// - subagents: on in production by the owner's decision of 2026-10-30. A
//   subagent runs on one of the named model routes the user configured in
//   Settings > Subagents (after the `model_map` mode of the Hermes
//   advanced-delegation plugin), or on the conversation's model when there
//   are none. The assistant sees only route names and descriptions; a route
//   that cannot run fails closed and never falls back to another model.
//
// - citation check (lib/citationSupport): sends each citation of an answer
//   (the claim, the quoted text and its context) to TypeSafe, a third party
//   in the United States, with the platform's TYPESAFE_API_KEY. Off unless
//   LITT_CITATION_CHECK is `enabled`, and also off without that key. It stays
//   off in production until the texts from socium-legal are published
//   (docs/citation-support-check.md). Each person can opt out.
//
// Turning one on is a deployment decision recorded with the owner's approval.

export function chatWebSearchEnabled(): boolean {
    return process.env.LITT_CHAT_WEB_SEARCH?.trim() === "enabled";
}

export function chatSubagentsEnabled(): boolean {
    return process.env.LITT_CHAT_SUBAGENTS?.trim() === "enabled";
}

export function citationCheckEnabled(): boolean {
    return process.env.LITT_CITATION_CHECK?.trim() === "enabled";
}

/** The platform's TypeSafe key, or null: with no key the check does not exist. Never log it. */
export function citationCheckApiKey(): string | null {
    if (!citationCheckEnabled()) return null;
    return process.env.TYPESAFE_API_KEY?.trim() || null;
}
