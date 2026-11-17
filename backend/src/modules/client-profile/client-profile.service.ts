/**
 * Facade of the client-profile module: the living profile of a retainer
 * client, facts with a verified citation and the lawyer's confirmation
 * (docs/client-profile.md).
 */

export { confirmProfileFact, rejectProfileFact } from "./client-profile.decide";
export { createProfileFact, getClientProfile, loadFacts } from "./client-profile.facts";
