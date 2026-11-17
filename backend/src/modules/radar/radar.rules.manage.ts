/**
 * The obligation rules of a retainer matter: the catalog (code), whether each
 * rule is on for this matter and from which fact (events), and turning one on
 * or off. Everybody on the matter reads; owners and editors decide. A rule that
 * is not verified in the catalog is refused (409 obligation_rule_unverified)
 * however it is asked. Turning a rule on names its anchor: a confirmed, not
 * stale `date` fact of the matter, kept in the activation event.
 */

import type { MatterObligationRules, ObligationRule, ProfileFact } from "@mike/contracts";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { loadFacts } from "../client-profile/client-profile.service";
import { authorizeMatterMember } from "../matters/matters.service";
import { ANCHOR_MODES, anchorChoices, anchorDateOf, type ActiveRule, type AnchorMode } from "./radar.obligations";
import { namePeople } from "./radar.people";
import { OBLIGATION_RULES } from "./radar.rules.catalog";
import { findRule, isUsable, ruleKey, type ObligationRuleDef } from "./radar.rules";
import { loadRuleStates, OFF, recordRuleEvent, type RuleState } from "./radar.rules.state";
import { citationView, milestoneView, opView } from "./radar.rules.view";
import { ANCHOR_REQUIRED_CODE, ANCHOR_UNAVAILABLE_CODE, NOT_A_RETAINER_CODE, RULE_UNVERIFIED_CODE } from "./radar.shared";

const NOT_FOUND = "Not found";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function toRuleView(rule: ObligationRuleDef, state: RuleState): ObligationRule {
  const verified = rule.verification.status === "verified";
  // A rule that stopped being usable (unverified or broken in a later release) is off, whatever the events say.
  const active = state.active && isUsable(rule);
  return {
    key: ruleKey(rule),
    code: rule.code,
    version: rule.version,
    name_key: rule.nameKey,
    applies_when_key: rule.appliesWhenKey,
    anchor_key: rule.anchorKey,
    first_cycle: rule.firstCycle
      ? {
          from: rule.firstCycle.from,
          ops: rule.firstCycle.ops.map(opView),
          only_if: rule.firstCycle.onlyIf ?? null,
          cap_years: rule.firstCycle.capYears ?? null,
        }
      : null,
    kind: rule.kind,
    milestones: rule.milestones.map(milestoneView),
    requires_business_days: rule.requiresBusinessDays,
    citations: rule.citations.map(citationView),
    notes: rule.notes ?? null,
    consulted_on: rule.consultedOn,
    verification: {
      status: verified ? "verified" : "unverified",
      verified_by: rule.verification.status === "verified" ? rule.verification.verifiedBy : null,
      verified_on: rule.verification.status === "verified" ? rule.verification.verifiedOn : null,
    },
    active,
    anchor: active && state.anchor ? { fact_id: state.anchor.factId, mode: state.anchor.mode } : null,
    changed_by: state.by,
    changed_at: state.at,
  };
}

/** The catalog rules a matter has ON and that may still run (verified and sound), with their anchors. */
export async function loadActiveRules(
  db: Db,
  matterId: string,
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<ActiveRule[]>> {
  const usable = catalog.filter(isUsable);
  if (usable.length === 0) return ok([]);
  const states = await loadRuleStates(db, matterId);
  if (!states.ok) return states;
  const active: ActiveRule[] = [];
  for (const rule of usable) {
    const state = states.data.get(ruleKey(rule));
    if (state?.active && state.anchor) active.push({ rule, anchorFactId: state.anchor.factId, mode: state.anchor.mode });
  }
  return ok(active);
}

const choiceOf = (fact: ProfileFact) => ({
  fact_id: fact.id,
  label: fact.label,
  date_on: anchorDateOf(fact)!,
  date_kind: fact.data.date_kind ?? null,
});

export async function getMatterRules(
  db: Db,
  actor: { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown },
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<MatterObligationRules>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    if (!access.data.isRetainer) return ok({ retainer: false, can_write: false, rules: [], anchor_choices: [], people: [] });
    const states = await loadRuleStates(db, access.data.matterId);
    if (!states.ok) return states;
    const facts = await loadFacts(db, access.data);
    if (!facts.ok) return facts;
    const rules = catalog.map((rule) => toRuleView(rule, states.data.get(ruleKey(rule)) ?? OFF));
    return ok({
      retainer: true,
      can_write: access.data.canWrite,
      rules,
      anchor_choices: anchorChoices(facts.data)
        .map(choiceOf)
        .sort((a, b) => a.date_on.localeCompare(b.date_on) || a.label.localeCompare(b.label) || a.fact_id.localeCompare(b.fact_id)),
      people: await namePeople(db, rules.map((rule) => rule.changed_by)),
    });
  } catch (error) {
    return internalFailure(error);
  }
}

/** The anchor a request names, or the failure that says what is wrong with it. */
function anchorOf(rule: ObligationRuleDef, body: unknown): ServiceResult<{ factId: string; mode: AnchorMode }> {
  const factId = isRecord(body) ? body.anchor_fact_id : undefined;
  if (typeof factId !== "string" || !isUuid(factId))
    return failure("validation", "Choose the confirmed date the rule counts from.", ANCHOR_REQUIRED_CODE);
  const mode = isRecord(body) && body.anchor_mode != null ? body.anchor_mode : "direct";
  if (typeof mode !== "string" || !(ANCHOR_MODES as readonly string[]).includes(mode) || (mode === "first_cycle" && !rule.firstCycle))
    return failure("validation", "That way of counting from the date is not available for this rule.", ANCHOR_REQUIRED_CODE);
  return ok({ factId: factId.toLowerCase(), mode: mode as AnchorMode });
}

/**
 * Turns a rule on or off for the matter. Turning it on names the anchor; naming
 * another one while it is on records an off and an on. Repeating the current
 * state changes nothing.
 */
export async function setMatterRule(
  db: Db,
  actor: { userId: string; userEmail?: string | null; projectId: unknown; matterId: unknown; ruleKey: unknown; body?: unknown },
  on: boolean,
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<ObligationRule>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer) return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    const rule = typeof actor.ruleKey === "string" ? findRule(catalog, actor.ruleKey) : null;
    if (!rule) return failure("not_found", NOT_FOUND);
    if (on && !isUsable(rule))
      return failure("conflict", "That rule has not been verified, so it cannot be turned on.", RULE_UNVERIFIED_CODE);

    let anchor: { factId: string; mode: AnchorMode } | undefined;
    if (on) {
      const named = anchorOf(rule, actor.body);
      if (!named.ok) return named;
      const facts = await loadFacts(db, access.data);
      if (!facts.ok) return facts;
      if (!anchorChoices(facts.data).some((fact) => fact.id === named.data.factId))
        return failure("conflict", "That date is not a confirmed fact of this matter.", ANCHOR_UNAVAILABLE_CODE);
      anchor = named.data;
    }

    const before = await loadRuleStates(db, access.data.matterId);
    if (!before.ok) return before;
    const current = before.data.get(ruleKey(rule)) ?? OFF;
    const same = current.active === on && (!on || (current.anchor?.factId === anchor!.factId && current.anchor?.mode === anchor!.mode));
    if (!same) {
      const base = { matterId: access.data.matterId, ruleCode: rule.code, ruleVersion: rule.version, userId: actor.userId };
      // Changing the anchor of a rule that is on: off first, so each decision stays its own event.
      if (current.active && on) {
        const off = await recordRuleEvent(db, { ...base, action: "deactivate" });
        if (!off.ok) return off;
      }
      const recorded = await recordRuleEvent(db, { ...base, action: on ? "activate" : "deactivate", anchor });
      if (!recorded.ok) return recorded;
    }
    const after = await loadRuleStates(db, access.data.matterId);
    if (!after.ok) return after;
    return ok(toRuleView(rule, after.data.get(ruleKey(rule)) ?? OFF));
  } catch (error) {
    return internalFailure(error);
  }
}
