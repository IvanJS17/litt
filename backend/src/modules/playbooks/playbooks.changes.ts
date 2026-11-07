// LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Using a
// playbook as a starting point"): the changes proposed for a copy, and the
// lawyer's decision on each one.
//
// The model answers with operations on the copy's rules (add, modify,
// remove), never with a whole playbook. The server checks each one against
// the copy as it is: an operation on a rule that does not exist, a
// modification that changes nothing, or a second operation on one rule is
// dropped and counted; `before` is always read from the copy, never taken
// from the model; and each proposed rule's origin is decided as a draft's is.
//
// Accepting applies one change, and only over the rule it was proposed for:
// a rule edited since then answers 409 playbook_change_stale and the change
// stays pending. Rejecting records the decision and touches nothing else.

import { createServerSupabase, type Db } from "../../lib/supabase";
import { recordPlaybookAudit } from "./playbooks.audit";
import {
  normalizeDraftRule,
  verifyDraftProvenance,
  type DraftProvenanceCounts,
  type DraftSource,
} from "./playbooks.draft";
import {
  assertPlaybookNotBeingReplaced,
  editablePlaybook,
  editablePlaybookSchema,
  getPlaybook,
  parseModelJson,
  PlaybookRequestError,
} from "./playbooks.operations";
import type { PlaybookAnswers } from "./playbooks.questionnaire";
import { ruleSchema } from "./playbooks.schemas";
import {
  PLAYBOOK_CHANGE_DECIDED_CODE,
  PLAYBOOK_CHANGE_DECIDED_MESSAGE,
  PLAYBOOK_CHANGE_STALE_CODE,
  PLAYBOOK_CHANGE_STALE_MESSAGE,
} from "./playbooks.starter";
import type { Playbook, PlaybookChange, PlaybookContent } from "./playbooks.types";

type Rule = PlaybookContent["rules"][number];
type Op = PlaybookChange["op"];

/** At most this many changes are kept from one proposal; the rest are dropped. */
export const MAX_PROPOSED_CHANGES = 40;

/** The fields a modification is compared on; provenance is not one of them. */
export const COMPARED_RULE_FIELDS = [
  "name",
  "concept",
  "scope",
  "required",
  "guidance",
  "standard",
  "fallbacks",
  "unacceptable",
  "conditions",
  "actions",
] as const;

const OPS = new Set<Op>(["add_rule", "modify_rule", "remove_rule"]);

/** A change the server accepted from the model, before it is stored. */
export type ProposedChange = {
  op: Op;
  ruleId: string;
  topicId: string | null;
  before: Rule | null;
  after: Rule | null;
  changedFields: string[];
  rationale: string;
};

export type ProposalCounts = DraftProvenanceCounts & {
  changes: number;
  added: number;
  modified: number;
  removed: number;
  /** Operations the server dropped: unknown rule or topic, no real change, duplicate, invalid, over the limit. */
  discarded: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * JSON with object keys sorted and undefined values left out: a rule read
 * back from jsonb (which reorders keys) compares equal to the one stored.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** Where each rule of the playbook is: its topic, or null outside topics. */
function locateRules(content: PlaybookContent): Map<string, { rule: Rule; topicId: string | null }> {
  const located = new Map<string, { rule: Rule; topicId: string | null }>();
  for (const rule of content.rules) if (rule.id) located.set(rule.id, { rule, topicId: null });
  for (const topic of content.topics)
    for (const rule of topic.rules)
      if (rule.id) located.set(rule.id, { rule, topicId: topic.id ?? null });
  return located;
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/**
 * The rule the model proposes, shaped and checked as a complete rule, or
 * null when it is not one. Its origin may come with the change or inside
 * the rule; the change's own wins.
 */
function proposedRule(change: Record<string, unknown>): Rule | null {
  if (!isObject(change.after)) return null;
  const rule = { ...change.after, ...(change.origin !== undefined ? { origin: change.origin } : {}) };
  const parsed = ruleSchema.safeParse(normalizeDraftRule(rule));
  return parsed.success ? parsed.data : null;
}

/**
 * The model's operations, checked against the copy as it is now. Throws only
 * when the answer is not a list of changes at all (the caller asks once
 * more); a single unusable operation is dropped and counted.
 */
export function checkProposalOutput(
  raw: string,
  evidence: {
    content: PlaybookContent;
    answers: PlaybookAnswers;
    sources: Pick<DraftSource, "label" | "text">[];
  },
): { changes: ProposedChange[]; counts: ProposalCounts } {
  const parsed = parseModelJson(raw);
  if (!isObject(parsed) || !Array.isArray(parsed.changes))
    throw new Error('Devuelve un objeto JSON con la lista "changes".');
  const located = locateRules(evidence.content);
  const topicIds = new Set(
    evidence.content.topics.map((topic) => topic.id).filter((id): id is string => !!id),
  );
  const taken = new Set([...located.keys(), ...topicIds]);
  const touched = new Set<string>();
  let discarded = 0;
  let nextId = 1;
  const freshId = () => {
    let id = `proposed-rule-${nextId++}`;
    while (taken.has(id)) id = `proposed-rule-${nextId++}`;
    taken.add(id);
    return id;
  };

  const accepted: ProposedChange[] = [];
  for (const entry of parsed.changes) {
    const change = isObject(entry) ? entry : {};
    const op = change.op as Op;
    const rationale = text(change.rationale, 2_000);
    if (!OPS.has(op)) {
      discarded += 1;
      continue;
    }
    if (op === "add_rule") {
      const topicId = typeof change.topicId === "string" && change.topicId ? change.topicId : null;
      const after = proposedRule(change);
      if (!after || (topicId && !topicIds.has(topicId))) {
        discarded += 1;
        continue;
      }
      const ruleId = freshId();
      accepted.push({
        op,
        ruleId,
        topicId,
        before: null,
        after: { ...after, id: ruleId },
        changedFields: [...COMPARED_RULE_FIELDS],
        rationale,
      });
      continue;
    }
    const ruleId = typeof change.ruleId === "string" ? change.ruleId : "";
    const current = located.get(ruleId);
    // One operation per rule: a second one could only conflict with the first.
    if (!current || touched.has(ruleId)) {
      discarded += 1;
      continue;
    }
    if (op === "remove_rule") {
      touched.add(ruleId);
      accepted.push({
        op,
        ruleId,
        topicId: current.topicId,
        before: current.rule,
        after: null,
        changedFields: [],
        rationale,
      });
      continue;
    }
    const proposed = proposedRule(change);
    if (!proposed) {
      discarded += 1;
      continue;
    }
    const after = { ...proposed, id: ruleId };
    const changedFields = COMPARED_RULE_FIELDS.filter(
      (field) => canonicalJson(current.rule[field]) !== canonicalJson(after[field]),
    );
    if (!changedFields.length) {
      discarded += 1;
      continue;
    }
    touched.add(ruleId);
    accepted.push({
      op,
      ruleId,
      topicId: current.topicId,
      before: current.rule,
      after,
      changedFields,
      rationale,
    });
  }
  discarded += Math.max(0, accepted.length - MAX_PROPOSED_CHANGES);
  const kept = accepted.slice(0, MAX_PROPOSED_CHANGES);

  // Each proposed rule's origin is the server's decision, as in a draft.
  const proposedRules = kept.flatMap((change) => (change.after ? [change.after] : []));
  const verified = verifyDraftProvenance(
    {
      name: evidence.content.name,
      description: "",
      representedParty: "",
      documentTypes: [],
      jurisdictions: [],
      rules: proposedRules,
      topics: [],
    },
    { answers: evidence.answers, sources: evidence.sources },
  );
  let index = 0;
  const changes = kept.map((change) =>
    change.after ? { ...change, after: verified.content.rules[index++] } : change,
  );
  return {
    changes,
    counts: {
      ...verified.counts,
      changes: changes.length,
      added: changes.filter((change) => change.op === "add_rule").length,
      modified: changes.filter((change) => change.op === "modify_rule").length,
      removed: changes.filter((change) => change.op === "remove_rule").length,
      discarded,
    },
  };
}

// --- Reading and deciding -----------------------------------------------------

export function publicChange(row: Record<string, unknown>): PlaybookChange {
  return {
    id: String(row.id),
    playbookId: String(row.playbook_id),
    importId: row.import_id ? String(row.import_id) : null,
    op: row.op as Op,
    ruleId: String(row.rule_id),
    topicId: row.topic_id ? String(row.topic_id) : null,
    before: (row.before_json as Rule | null) ?? null,
    after: (row.after_json as Rule | null) ?? null,
    changedFields: Array.isArray(row.changed_fields) ? row.changed_fields.map(String) : [],
    rationale: String(row.rationale ?? ""),
    status: row.status === "accepted" || row.status === "rejected" ? row.status : "pending",
    decidedBy: row.decided_by ? String(row.decided_by) : null,
    decidedAt: row.decided_at ? String(row.decided_at) : null,
    createdAt: String(row.created_at),
  };
}

/** The changes proposed for a playbook, pending and decided, in the order proposed. Viewer or more. */
export async function listPlaybookChanges(
  userId: string,
  playbookId: string,
  db: Db = createServerSupabase(),
  email?: string | null,
): Promise<PlaybookChange[]> {
  await getPlaybook(userId, playbookId, db, email);
  const { data, error } = await db
    .from("playbook_changes")
    .select("*")
    .eq("playbook_id", playbookId)
    .order("created_at", { ascending: true })
    .limit(1_000);
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map(publicChange);
}

function stale(): PlaybookRequestError {
  return new PlaybookRequestError(PLAYBOOK_CHANGE_STALE_MESSAGE, 409, {
    code: PLAYBOOK_CHANGE_STALE_CODE,
  });
}

function decided(): PlaybookRequestError {
  return new PlaybookRequestError(PLAYBOOK_CHANGE_DECIDED_MESSAGE, 409, {
    code: PLAYBOOK_CHANGE_DECIDED_CODE,
  });
}

/**
 * The content with one change applied, or playbook_change_stale when the
 * rule it was proposed for is no longer what it was (edited or removed) or
 * the topic an added rule goes to is gone. A rule moved to another topic
 * with its content unchanged is not stale: the change applies where the
 * rule now is.
 */
export function applyChange(content: PlaybookContent, change: PlaybookChange): PlaybookContent {
  const located = locateRules(content).get(change.ruleId);
  if (change.op === "add_rule") {
    if (located || !change.after) throw stale();
    if (change.topicId === null) return { ...content, rules: [...content.rules, change.after] };
    if (!content.topics.some((topic) => topic.id === change.topicId)) throw stale();
    return {
      ...content,
      topics: content.topics.map((topic) =>
        topic.id === change.topicId ? { ...topic, rules: [...topic.rules, change.after!] } : topic,
      ),
    };
  }
  if (!located || canonicalJson(located.rule) !== canonicalJson(change.before)) throw stale();
  const replace = (rules: Rule[]) =>
    change.op === "remove_rule"
      ? rules.filter((rule) => rule.id !== change.ruleId)
      : rules.map((rule) => (rule.id === change.ruleId ? { ...change.after!, id: change.ruleId } : rule));
  return {
    ...content,
    rules: replace(content.rules),
    topics: content.topics.map((topic) => ({ ...topic, rules: replace(topic.rules) })),
  };
}

/**
 * Accept or reject one proposed change. Editor or owner. Rejecting records
 * the decision only. Accepting applies the change over the rule it was
 * proposed for, then claims it and saves the rules in one transaction
 * (accept_playbook_change) under the playbook's row lock and only over the
 * version read, so a second click cannot apply it twice and no write lands
 * in between; when either check fails the change stays pending and the
 * answer is 409 playbook_change_stale.
 */
export async function decidePlaybookChange(
  userId: string,
  playbookId: string,
  changeId: string,
  raw: unknown,
  db: Db = createServerSupabase(),
  email?: string | null,
): Promise<{ playbook: Playbook; change: PlaybookChange }> {
  const decision = isObject(raw) ? raw.decision : undefined;
  if (decision !== "accept" && decision !== "reject")
    throw new PlaybookRequestError('Indica decision "accept" o "reject".');
  const playbook = await editablePlaybook(userId, playbookId, db, email);
  const found = await db
    .from("playbook_changes")
    .select("*")
    .eq("id", changeId)
    .eq("playbook_id", playbookId)
    .maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) throw new PlaybookRequestError("Cambio no encontrado.", 404);
  if (found.data.status !== "pending") throw decided();
  let change = publicChange(found.data as Record<string, unknown>);

  if (decision === "accept") {
    // Applying a change rewrites the rules: it waits, as any edit does,
    // while proposals are computed over the playbook.
    await assertPlaybookNotBeingReplaced(db, playbookId);
    const current = await getPlaybook(userId, playbookId, db, email);
    const parsed = editablePlaybookSchema.safeParse(applyChange(current.content, change));
    if (!parsed.success)
      throw new PlaybookRequestError(
        "Aplicar este cambio dejaría el playbook fuera de sus límites.",
      );
    // The claim and the new rules in one transaction, under the playbook's
    // row lock, over the version read: a change is never accepted without
    // its rules, so marking the playbook ready cannot slip in between.
    const accepted = await db.rpc("accept_playbook_change", {
      p_playbook_id: playbookId,
      p_change_id: changeId,
      p_user_id: userId,
      p_read_updated_at: current.updatedAt,
      p_content: parsed.data,
    });
    if (accepted.error) throw accepted.error;
    if (accepted.data === "decided") throw decided();
    if (accepted.data === "missing") throw new PlaybookRequestError("Playbook no encontrado.", 404);
    // Another write landed between the read and this one.
    if (accepted.data !== "accepted") throw stale();
    const decidedRow = await db.from("playbook_changes").select("*").eq("id", changeId).maybeSingle();
    if (decidedRow.error) throw decidedRow.error;
    if (decidedRow.data) change = publicChange(decidedRow.data as Record<string, unknown>);
  } else {
    const claimed = await db
      .from("playbook_changes")
      .update({ status: "rejected", decided_by: userId, decided_at: new Date().toISOString() })
      .eq("id", changeId)
      .eq("status", "pending")
      .select("*");
    if (claimed.error) throw claimed.error;
    const row = ((claimed.data ?? []) as Record<string, unknown>[])[0];
    if (!row) throw decided();
    change = publicChange(row);
  }

  void recordPlaybookAudit(db, {
    userId,
    userEmail: email,
    orgId: playbook.orgId,
    action: decision === "accept" ? "playbook.change_accepted" : "playbook.change_rejected",
    title: playbook.name,
    detail: { playbook_id: playbookId, change_id: changeId, op: change.op, rule_id: change.ruleId },
  });
  return {
    playbook: decision === "accept" ? await getPlaybook(userId, playbookId, db, email) : playbook,
    change,
  };
}
