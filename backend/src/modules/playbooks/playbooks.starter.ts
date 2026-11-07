// LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Draft
// and ready"): the error codes the draft state answers with, and the two
// rules that keep a rule's provenance honest. A leaf of the module: it
// imports no implementation, so playbooks.operations can use it.

import type { PlaybookContent } from "./playbooks.types";

/** 409: a draft cannot be used in a review until an editor marks it ready. */
export const PLAYBOOK_DRAFT_CODE = "playbook_draft";
export const PLAYBOOK_DRAFT_MESSAGE =
  "Este playbook es un borrador. Un editor debe marcarlo como listo antes de usarlo en revisiones.";

/** 409: a copy cannot be marked ready while proposed changes await a decision. */
export const PLAYBOOK_CHANGES_PENDING_CODE = "playbook_changes_pending";
export const PLAYBOOK_CHANGES_PENDING_MESSAGE =
  "Este playbook tiene cambios propuestos sin decidir. Acepta o rechaza cada uno antes de marcarlo como listo.";

/** 409: the rule changed after the change was proposed; reloading helps. */
export const PLAYBOOK_CHANGE_STALE_CODE = "playbook_change_stale";
export const PLAYBOOK_CHANGE_STALE_MESSAGE =
  "La regla cambió después de que se propuso este cambio. Recarga los cambios propuestos.";

type Rule = PlaybookContent["rules"][number];

/** Every rule of the playbook, loose and inside topics. */
export function allRules(content: PlaybookContent): Rule[] {
  return [...content.rules, ...content.topics.flatMap((topic) => topic.rules)];
}

function mapRules(
  content: PlaybookContent,
  map: (rule: Rule) => Rule,
): PlaybookContent {
  return {
    ...content,
    rules: content.rules.map(map),
    topics: content.topics.map((topic) => ({
      ...topic,
      rules: topic.rules.map(map),
    })),
  };
}

function withoutProvenance(rule: Rule): Rule {
  const { origin: _origin, legalRefs: _legalRefs, ...rest } = rule;
  return rest;
}

/**
 * The server owns a rule's `origin` and `legalRefs`: a saved rule keeps the
 * ones stored for its id, whatever the client sent, and a rule the store does
 * not have gets none. An editor can neither invent "answer to question 6" nor
 * remove "not verified".
 */
export function keepServerOwnedRuleFields(
  stored: PlaybookContent,
  incoming: PlaybookContent,
): PlaybookContent {
  const byId = new Map<string, Rule>();
  for (const rule of allRules(stored)) if (rule.id) byId.set(rule.id, rule);
  return mapRules(incoming, (rule) => {
    const kept = withoutProvenance(rule);
    const saved = rule.id ? byId.get(rule.id) : undefined;
    if (saved?.origin) kept.origin = saved.origin;
    if (saved?.legalRefs) kept.legalRefs = saved.legalRefs;
    return kept;
  });
}

/**
 * The rules as a review prompt sends them: without provenance, which is for
 * the people editing the playbook, not for the review. The run's snapshot
 * keeps it.
 */
export function stripProvenance(content: PlaybookContent): PlaybookContent {
  return mapRules(content, withoutProvenance);
}

/** What marking a playbook ready records: counts, never rule text. */
export function provenanceCounts(content: PlaybookContent): {
  rules: number;
  unbacked_rules: number;
  unverified_refs: number;
} {
  const rules = allRules(content);
  return {
    rules: rules.length,
    unbacked_rules: rules.filter((rule) => rule.origin?.unbacked).length,
    unverified_refs: rules.reduce(
      (count, rule) =>
        count + (rule.legalRefs ?? []).filter((ref) => !ref.verified).length,
      0,
    ),
  };
}
