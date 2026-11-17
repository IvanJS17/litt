// A playbook review done by the CLIENT's own AI (MCP mode B, design §2.3-2.4).
//
// LiTT runs no model here. `preparePlaybookClientReview` does the checks a
// review request goes through (the playbook can be opened and is ready, its
// rules fit the engine's limit) and hands back the engine's own instructions
// and the rules; `savePlaybookClientReview` takes the findings the client
// produced, validates them with the engine's own rules (`normalizeFindings`:
// known rule ids, quotes that must be found in the text) and records them as a
// completed run. No tracked changes are made and no document version is
// written. The run carries `model = "client_ai"` and no model route, which the
// database already allows (runs written before routes were pinned have none).

import crypto from "node:crypto";
import { createServerSupabase } from "../../lib/supabase";
import { findingSchema } from "./playbooks.schemas";
import { stripProvenance } from "./playbooks.starter";
import type { PlaybookContent, PlaybookFinding } from "./playbooks.types";
import {
  assertPlaybookReady,
  getPlaybook,
  ISSUE_STATUSES,
  normalizeFindings,
  PlaybookRequestError,
  playbookContentSchema,
  publicRun,
  REVIEW_SYSTEM_PROMPT,
  reviewPrompt,
  stableIds,
} from "./playbooks.operations";

type Db = ReturnType<typeof createServerSupabase>;

/** The model label recorded on a run the client's AI produced. */
export const CLIENT_AI_MODEL = "client_ai";
/** The engine's limit on the rules of one review (see beginPlaybookReview). */
const MAX_PLAYBOOK_CHARS = 100_000;

export type ClientReviewOptions = {
  reviewMode: "strict" | "permissive";
  reviewScope: "full" | "issues";
  instructions?: string;
};

export type ClientReviewRule = { id: string; name: string; topicId: string | null; topicName: string | null };

async function readyPlaybook(db: Db, userId: string, email: string | null | undefined, playbookId: string) {
  const playbook = await getPlaybook(userId, playbookId, db, email);
  assertPlaybookReady(playbook);
  const parsed = playbookContentSchema.safeParse(playbook.content);
  if (!parsed.success)
    throw new PlaybookRequestError(
      "Complete the playbook name, rules, and positions before running a review.",
    );
  const content = stableIds(parsed.data);
  const stripped = JSON.stringify(stripProvenance(content));
  if (stripped.length > MAX_PLAYBOOK_CHARS)
    throw new PlaybookRequestError(
      "The playbook is too large for a complete review. Split it into smaller playbooks.",
    );
  const hash = crypto.createHash("sha256").update(stripped).digest("hex");
  return { playbook, content, hash };
}

function ruleList(content: PlaybookContent): ClientReviewRule[] {
  const rules: ClientReviewRule[] = [];
  for (const rule of content.rules)
    rules.push({ id: rule.id!, name: rule.name, topicId: null, topicName: null });
  for (const topic of content.topics)
    for (const rule of topic.rules)
      rules.push({ id: rule.id!, name: rule.name, topicId: topic.id ?? null, topicName: topic.name });
  return rules;
}

/** The checks of a review request, then what a client's AI needs to do it. */
export async function preparePlaybookClientReview(
  db: Db,
  args: { userId: string; userEmail?: string | null; playbookId: string } & ClientReviewOptions,
) {
  const { playbook, content, hash } = await readyPlaybook(db, args.userId, args.userEmail, args.playbookId);
  // The engine's own instructions, without the contract: the text is read apart.
  const brief = reviewPrompt(content, "", args.reviewMode, args.instructions, [], args.reviewScope)
    .replace(/\n\nCONTRACT:\n$/, "");
  return {
    playbookId: playbook.id,
    playbookName: playbook.name,
    orgId: playbook.orgId,
    hash,
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    brief,
    rules: ruleList(content),
  };
}

export type ClientFindingInput = {
  ruleId: string | null;
  status: PlaybookFinding["status"];
  quote?: string;
  location?: string;
  analysis: string;
  suggestedText?: string;
  insertAfter?: string;
};

/** Validate the client's findings against the engine's rules and record the run. */
export async function savePlaybookClientReview(
  db: Db,
  args: {
    userId: string;
    userEmail?: string | null;
    playbookId: string;
    /** The playbook's hash when the ticket was issued; the rules must not have changed since. */
    expectedHash: string;
    documentId: string;
    documentName: string | null;
    documentText: string;
    summary: string;
    findings: ClientFindingInput[];
  } & ClientReviewOptions,
) {
  const { content, hash } = await readyPlaybook(db, args.userId, args.userEmail, args.playbookId);
  if (hash !== args.expectedHash)
    throw new PlaybookRequestError(
      "The playbook changed after the review was prepared. Prepare the review again.",
      409,
      { code: "playbook_changed" },
    );
  const names = new Map(ruleList(content).map((rule) => [rule.id, rule.name]));
  const parsed = args.findings.map((finding) =>
    findingSchema.safeParse({
      topicId: null,
      ruleId: finding.ruleId,
      ruleName: (finding.ruleId && names.get(finding.ruleId)) || "Outside the playbook",
      status: finding.status,
      quote: finding.quote ?? "",
      location: finding.location ?? "",
      analysis: finding.analysis,
      suggestedText: finding.suggestedText ?? "",
      insertAfter: finding.insertAfter ?? "",
    }),
  );
  const accepted = parsed.flatMap((result) => (result.success ? [result.data] : []));
  const normalized = normalizeFindings(content, args.documentText, accepted, {
    flagMissingRules: args.reviewScope === "full",
  });
  const findings: PlaybookFinding[] =
    args.reviewScope === "issues" ? normalized.filter((f) => ISSUE_STATUSES.has(f.status)) : normalized;

  // A quote the client gave that is not in the text is dropped by the engine's
  // normalization (it comes back empty); say so instead of passing it as good.
  const claimed = new Map(accepted.map((f) => [f.ruleId ?? `outside:${f.analysis}`, f.quote]));
  const verification = findings.map((finding) => {
    const proposed = claimed.get(finding.ruleId ?? `outside:${finding.analysis}`) ?? "";
    return {
      findingId: finding.id,
      ruleId: finding.ruleId,
      quoteVerified: finding.quote ? true : proposed ? (false as const) : null,
    };
  });
  const rejected = args.findings.length - accepted.length;
  const droppedUnknownRules = accepted.filter(
    (f) => f.status !== "outside_scope" && !(f.ruleId && names.has(f.ruleId)),
  ).length;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    playbook_id: args.playbookId,
    content_json: content,
    user_id: args.userId,
    model: CLIENT_AI_MODEL,
    document_name: args.documentName,
    document_id: args.documentId,
    edited_version_id: null,
    review_mode: args.reviewMode,
    review_scope: args.reviewScope,
    status: "completed",
    summary: args.summary,
    findings_json: findings,
    error: null,
    started_at: now,
    completed_at: now,
    created_at: now,
    updated_at: now,
  };
  const inserted = await db.from("playbook_runs").insert(row);
  if (inserted.error) throw inserted.error;
  return { run: publicRun(row, new Set()), verification, rejected, droppedUnknownRules };
}
