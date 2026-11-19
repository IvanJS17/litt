/**
 * Facade of the client-profile module: the living profile of a retainer
 * client, facts with a verified citation and the lawyer's confirmation
 * (docs/client-profile.md).
 */

export { confirmProfileFact, decideProfileFacts, rejectProfileFact } from "./client-profile.decide";
export { createProfileFact, getClientProfile, loadFacts, sourceVersions } from "./client-profile.facts";
export { extractProfileFacts, getExtractionRoute, resolveExtractionRoute } from "./client-profile.extract";
export type { ExtractionRoute } from "./client-profile.extract";
// What the rule suggestions of the radar (docs/obligation-rules.md) share with the extraction:
// the size and time caps, the reading of a model's JSON array and the source checks.
export {
  buildExtractionPrompt,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_TIMEOUT_MS,
  MAX_EXTRACT_TEXT_CHARS,
  readModelArray,
} from "./client-profile.extract.shared";
export { findLiveVersion, readSources, sha256, sourceStateFor } from "./client-profile.source";
export { cleanText, isRecord, SOURCE_TEXT_UNAVAILABLE_CODE, VERSION_NOT_IN_MATTER_CODE } from "./client-profile.shared";
