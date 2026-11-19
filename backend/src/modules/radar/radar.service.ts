/**
 * Facade of the radar module: the deadline radar of a retainer matter, computed
 * in code from confirmed client-profile facts (docs/deadline-radar.md).
 */

export { actOnRadarItem } from "./radar.act";
export { getMatterRadar } from "./radar.read";
export { getRadarToday } from "./radar.today";
export { getMatterRules, setMatterRule } from "./radar.rules.manage";
export {
  acceptRuleSuggestion,
  decideRuleSuggestions,
  discardRuleSuggestion,
  getRuleSuggestions,
  getSuggestionRoute,
  suggestRules,
} from "./radar.suggest";
export { planRuleRead, readRuleBatch } from "./radar.suggest.all";
export { answerRuleQuestion } from "./radar.questions";
export {
  discardProposal,
  exportRuleProposals,
  getProposalRoute,
  getRuleProposals,
  markProposalImplemented,
  proposeRules,
  sendProposalToLegal,
} from "./radar.proposals";
