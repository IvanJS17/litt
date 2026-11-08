// LiTT playbooks with a starting point, layer 1 (docs/playbooks.md, "Using a
// playbook as a starting point"): an independent copy of any playbook the
// caller can open. The copy is the caller's, a draft, and records the
// playbook it came from. It takes the rules and nothing of the original's
// case: no questionnaire answers, no reference documents, no source file.

import crypto from "node:crypto";
import { parseContentVisibility } from "../../lib/access";
import { createServerSupabase, type Db } from "../../lib/supabase";
import { recordPlaybookAudit } from "./playbooks.audit";
import {
  creationScope,
  getPlaybook,
  PlaybookRequestError,
} from "./playbooks.operations";
import { allRules } from "./playbooks.starter";
import type { Playbook, PlaybookContent } from "./playbooks.types";

type Rule = PlaybookContent["rules"][number];

/**
 * What the copy keeps of a rule's backing. The original's attachments stay
 * with the original, and so does their text: a legal reference verified
 * against one becomes "not verified", and a clause origin becomes a
 * suggestion without backing, and so does an answer origin, since the copy
 * carries no questionnaire answers (it loses its `questionIds`). References
 * lose their `sourceId` and `quote`, origins their `sourceId`, `quote` and
 * `questionIds`, so no verbatim client text or attachment pointer travels
 * into the copy. The `note` and the rule's own text stay: the rule's author
 * wrote them.
 */
function unbackedOrigin(origin: NonNullable<Rule["origin"]>): NonNullable<Rule["origin"]> {
  if (origin.kind === "ai_general") return origin;
  const {
    sourceId: _sourceId,
    quote: _quote,
    questionIds: _questionIds,
    kind: _kind,
    ...rest
  } = origin;
  return { ...rest, kind: "ai_general", unbacked: true };
}

function unverifiedRef(ref: NonNullable<Rule["legalRefs"]>[number]) {
  const { sourceId: _sourceId, quote: _quote, ...rest } = ref;
  return { ...rest, verified: false };
}

/**
 * A rule as the copy keeps it: its origin and legal references stay (they
 * belong to the rule) minus what rested on the original's attachments, and
 * its file markers go, because they point into the original's source file,
 * which the copy does not have.
 */
function copiedRule(rule: Rule): Rule {
  const position = <P extends { sampleClauses: { sourceRefs: string[] }[] }>(value: P): P => ({
    ...value,
    sampleClauses: value.sampleClauses.map((clause) => ({ ...clause, sourceRefs: [] })),
  });
  return {
    ...rule,
    sourceRefs: [],
    ...(rule.origin ? { origin: unbackedOrigin(rule.origin) } : {}),
    ...(rule.legalRefs ? { legalRefs: rule.legalRefs.map(unverifiedRef) } : {}),
    standard: rule.standard ? position(rule.standard) : null,
    fallbacks: rule.fallbacks.map(position),
    unacceptable: rule.unacceptable.map(position),
  };
}

export function copiedContent(content: PlaybookContent, name: string): PlaybookContent {
  return {
    ...content,
    name,
    rules: content.rules.map(copiedRule),
    topics: content.topics.map((topic) => ({ ...topic, rules: topic.rules.map(copiedRule) })),
  };
}

/**
 * Copy a playbook the caller can open (viewer or more) into a workspace the
 * caller can create in: the original's own workspace unless the body names
 * another. The original is only read.
 */
export async function copyPlaybook(
  userId: string,
  id: string,
  raw: { name?: unknown; workspace?: unknown; visibility?: unknown } = {},
  db: Db = createServerSupabase(),
  email?: string | null,
): Promise<Playbook> {
  // Not found for anyone who cannot open the original, as every read is.
  const original = await getPlaybook(userId, id, db, email);
  const orgId = await creationScope(
    db,
    userId,
    raw.workspace ?? original.orgId ?? "personal",
  );
  const visibility = parseContentVisibility(raw.visibility, orgId);
  if (!visibility.ok) throw new PlaybookRequestError(visibility.detail);
  if (raw.name !== undefined && typeof raw.name !== "string")
    throw new PlaybookRequestError("El nombre del playbook debe ser texto.");
  const name = (typeof raw.name === "string" && raw.name.trim()) || original.name;
  if (name.length > 200)
    throw new PlaybookRequestError("El nombre del playbook es demasiado largo.");

  const copyId = crypto.randomUUID();
  const now = new Date().toISOString();
  const content = copiedContent(original.content, name);
  const { error } = await db.from("playbooks").insert({
    id: copyId,
    user_id: userId,
    name,
    description: content.description,
    content_json: content,
    org_id: orgId,
    // Absent keeps the column's default: private.
    ...(visibility.visibility ? { visibility: visibility.visibility } : {}),
    status: "draft",
    is_model: false,
    derived_from_playbook_id: original.id,
    // The original's case stays with the original.
    intake_json: null,
    source_filename: null,
    source_storage_key: null,
    import_model: null,
    created_at: now,
    updated_at: now,
  });
  if (error) throw error;
  void recordPlaybookAudit(db, {
    userId,
    userEmail: email,
    orgId,
    action: "playbook.copied",
    title: name,
    detail: {
      playbook_id: copyId,
      derived_from_playbook_id: original.id,
      rules: allRules(content).length,
    },
  });
  return getPlaybook(userId, copyId, db, email);
}
