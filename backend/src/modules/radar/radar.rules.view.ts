import type { ObligationRuleCitation, ObligationRuleMilestone, ObligationRuleOp } from "@mike/contracts";
import type { RuleCitation, RuleMilestone, RuleOp } from "./radar.rules";

const opView = (op: RuleOp): ObligationRuleOp => ("adjust" in op ? { adjust: op.adjust } : { unit: op.unit, amount: op.amount });

export const milestoneView = (milestone: RuleMilestone): ObligationRuleMilestone => ({ kind: milestone.kind, ops: milestone.ops.map(opView) });

export const citationView = (citation: RuleCitation): ObligationRuleCitation => ({
  source_code: citation.sourceCode,
  law: citation.law,
  location: citation.location,
  text: citation.text,
  url: citation.url,
  last_reform: citation.lastReform,
});

export { opView };
