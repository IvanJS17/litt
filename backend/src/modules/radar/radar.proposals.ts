/**
 * AI proposals of NEW obligation rules from a law text (S8b,
 * docs/obligation-rules.md, "Rule proposals"). On the lawyer's click the model
 * of the space reads ONE version of a document that lives in a FIRM PROJECT
 * (never a client matter) and proposes obligations, each with a literal quote
 * the code must find in that text. A proposal is an unverified draft that a
 * lawyer may send to legal (a download, nothing is transmitted to LiTT);
 * legal verifies it against the official source and a reviewed pull request
 * adds the rule to the catalog. Nothing here writes the catalog or turns a
 * rule on, and no date, operation or calculation ever comes from the model:
 * the one time-like field is `plazo_propuesto`, free draft text that no
 * calculation reads.
 *
 * What leaves LiTT, per click: the fixed prompt with the CODES of the catalog
 * and the version's text, and nothing else (no file or project name, account,
 * client data, chat, other documents). It goes from the server to the
 * provider of the route the project chat would use in this space, with that
 * route's key (a personal or the firm's key, never LiTT's); there is no other
 * route and no silent fallback. It never goes to TypeSafe, LandingAi, a web
 * search or Jev, and the button never starts OCR or a split.
 *
 * Who: any member of the project reads and exports; an owner or editor of the
 * project proposes and decides. Where the law text lives: a document of an
 * organization project that no matter is bound to.
 */

import crypto from "node:crypto";
import type {
  ProfilePerson,
  RuleProposal,
  RuleProposalExport,
  RuleProposalRun,
  RuleProposals,
  RuleProposalStaleReason,
} from "@mike/contracts";
import { checkProjectAccess } from "../../lib/access";
import { selectInBatches } from "../../lib/batchedQuery";
import { AppError } from "../../lib/appError";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { completeText } from "../../lib/llm";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { UserFacingError } from "../../lib/userFacingError";
import { isUuid } from "../../lib/uuid";
import { locateQuote } from "../chat/chat.service";
import {
  buildExtractionPrompt,
  cleanText,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_TIMEOUT_MS,
  findLiveVersion,
  isRecord,
  MAX_EXTRACT_TEXT_CHARS,
  readModelArray,
  readSources,
  resolveExtractionRoute,
  sha256,
  SOURCE_TEXT_UNAVAILABLE_CODE,
  sourceStateFor,
  sourceVersions,
  VERSION_NOT_IN_MATTER_CODE,
} from "../client-profile/client-profile.service";
import { recordChatEgressOrThrow } from "../user/user.service";
import { namePeople } from "./radar.people";
import { exportFileName, renderProposalsMarkdown, type ExportProposal } from "./radar.proposals.markdown";
import {
  buildProposeSystemPrompt,
  planProposals,
  PROPOSAL_ALREADY_DECIDED_CODE,
  PROPOSAL_DECISION_REASON_MAX,
  PROPOSAL_FIRM_PROJECT_REQUIRED_CODE,
  PROPOSAL_INVALID_CODE,
  PROPOSAL_LIMIT_CODE,
  PROPOSAL_MATTER_PROJECT_CODE,
  PROPOSAL_NEW_FLOW,
  PROPOSAL_OBSOLETE_CODE,
  PROPOSAL_QUOTE_MAX,
  PROPOSAL_UNKNOWN_CATALOG_CODE,
  PROPOSAL_WRITE_REQUIRED_CODE,
  PROPOSE_SURFACE,
} from "./radar.proposals.shared";
import { OBLIGATION_RULES } from "./radar.rules.catalog";
import { isUsable, type ObligationRuleDef } from "./radar.rules";
import {
  SUGGEST_OUTPUT_INVALID_CODE,
  SUGGEST_PROVIDER_FAILED_CODE,
  SUGGEST_PROVIDER_REFUSED_CODE,
  SUGGEST_TEXT_TOO_LARGE_CODE,
} from "./radar.suggest.shared";

const NOT_FOUND = "Not found";
const MAX_PROPOSALS_PER_PROJECT = 2000;

type Actor = { userId: string; userEmail?: string | null; projectId: unknown };
type Dependencies = { completeText?: typeof completeText; now?: () => Date };

type ProjectAccess = { projectId: string; orgId: string; canWrite: boolean };

/**
 * The project gate: the project's own access rules (nothing new), an
 * organization project, bound to no matter, and for writing the owner or
 * editor role. A stranger gets the same 404 as a project that does not exist.
 */
async function authorizeProject(db: Db, actor: Actor, write: boolean): Promise<ServiceResult<ProjectAccess>> {
  const projectId = actor.projectId;
  if (typeof projectId !== "string" || !isUuid(projectId)) return failure("not_found", NOT_FOUND);
  const access = await checkProjectAccess(projectId, actor.userId, actor.userEmail, db);
  if (!access.ok) return failure("not_found", NOT_FOUND);
  const orgId = access.project.org_id ?? null;
  if (!orgId)
    return failure("conflict", "Rule proposals need a project of a firm.", PROPOSAL_FIRM_PROJECT_REQUIRED_CODE);
  // A client or retainer matter never feeds this flow: its project is bound to a matter.
  const { data: matter, error } = await db.from("matters").select("id").eq("project_id", projectId).limit(1);
  if (error) return internalFailure(error);
  if ((matter ?? []).length > 0)
    return failure("conflict", "Rule proposals cannot read the project of a matter.", PROPOSAL_MATTER_PROJECT_CODE);
  const canWrite = access.projectRole === "owner" || access.projectRole === "editor";
  if (write && !canWrite)
    return failure("forbidden", "Only an owner or editor of the project can propose or decide rules.", PROPOSAL_WRITE_REQUIRED_CODE);
  return ok({ projectId, orgId, canWrite });
}

type ProposalRow = {
  id: string;
  project_id: string;
  document_id: string;
  version_id: string;
  text_sha256: string;
  start_char: number;
  end_char: number;
  quote: string;
  page: number | null;
  draft: unknown;
  ai_provider: string | null;
  ai_model: string | null;
  created_by: string | null;
  created_at: string;
};
const PROPOSAL_COLUMNS =
  "id, project_id, document_id, version_id, text_sha256, start_char, end_char, quote, page, draft, ai_provider, ai_model, created_by, created_at";
type EventRow = {
  id: string;
  suggestion_id: string;
  actor_user_id: string | null;
  action: string;
  catalog_code: string | null;
  created_at: string;
};
type Status = RuleProposal["status"];

/** Oldest first; rows of the same instant keep the order the database gave them. */
const byCreatedAt = (a: { created_at: string }, b: { created_at: string }) =>
  a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;

const statusOf = (events: readonly Pick<EventRow, "action">[]): Status => {
  const last = events[events.length - 1]?.action;
  return last === "discarded" || last === "sent_to_legal" || last === "implemented" ? last : "pending";
};

type Draft = { law: string; article: string; obligation: string; anchor_name: string; plazo_propuesto: string | null };
function readDraft(value: unknown): Draft | null {
  if (!isRecord(value)) return null;
  const { law, article, obligation, anchor_name: anchor, plazo_propuesto: term } = value;
  if (typeof law !== "string" || typeof article !== "string" || typeof obligation !== "string" || typeof anchor !== "string") return null;
  return { law, article, obligation, anchor_name: anchor, plazo_propuesto: typeof term === "string" ? term : null };
}

/** The proposals of a project with their decisions and whether each still stands on its text. Read, never stored. */
async function loadProposals(db: Db, projectId: string, only?: string): Promise<ServiceResult<RuleProposal[]>> {
  let query = db
    .from("obligation_rule_suggestions")
    .select(PROPOSAL_COLUMNS)
    .eq("flow", PROPOSAL_NEW_FLOW)
    .eq("project_id", projectId);
  if (only) query = query.eq("id", only);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_PROPOSALS_PER_PROJECT);
  if (error) return internalFailure(error);
  const rows = (data ?? []) as unknown as ProposalRow[];
  if (rows.length === 0) return ok([]);

  let events: EventRow[];
  try {
    events = await selectInBatches<EventRow>("rule proposal events", rows.map((row) => row.id), (batch) =>
      db
        .from("obligation_rule_suggestion_events")
        .select("id, suggestion_id, actor_user_id, action, catalog_code, created_at")
        .in("suggestion_id", batch)
        .order("created_at", { ascending: true }),
    );
  } catch (cause) {
    return internalFailure(cause);
  }
  const bySuggestion = new Map<string, EventRow[]>();
  for (const event of [...events].sort(byCreatedAt))
    bySuggestion.set(event.suggestion_id, [...(bySuggestion.get(event.suggestion_id) ?? []), event]);

  // A discarded proposal is never out of date, so its source is not read.
  const open = rows.filter((row) => statusOf(bySuggestion.get(row.id) ?? []) !== "discarded");
  const sources = await readSources(db, projectId, open);
  if (!sources.ok) return sources;

  const proposals: RuleProposal[] = [];
  for (const row of rows) {
    const draft = readDraft(row.draft);
    if (!draft) continue;
    const history = bySuggestion.get(row.id) ?? [];
    const status = statusOf(history);
    const source = sourceStateFor(row, sources.data) ?? {
      versionNumber: null,
      filename: null,
      staleReason: "version_missing" as const,
      currentSha: null,
    };
    const stale = status === "discarded" ? null : (source.staleReason as RuleProposalStaleReason | null);
    const decision = history[history.length - 1];
    proposals.push({
      id: row.id,
      project_id: row.project_id,
      law: draft.law,
      article: draft.article,
      obligation: draft.obligation,
      anchor_name: draft.anchor_name,
      plazo_propuesto: draft.plazo_propuesto,
      quote: row.quote,
      page: row.page,
      source: {
        document_id: row.document_id,
        version_id: row.version_id,
        version_number: source.versionNumber,
        filename: source.filename,
        start_char: row.start_char,
        end_char: row.end_char,
        text_sha256: row.text_sha256,
      },
      ai_provider: row.ai_provider,
      ai_model: row.ai_model,
      status,
      stale_reason: stale,
      effective_status: stale && status === "pending" ? "obsolete" : status,
      catalog_code: [...history].reverse().find((event) => event.action === "implemented")?.catalog_code ?? null,
      created_by: row.created_by,
      created_at: row.created_at,
      decided_by: decision?.actor_user_id ?? null,
      decided_at: decision?.created_at ?? null,
    });
  }
  return ok(proposals);
}

/** Whether the button can be offered: the route the project chat would use here, for an owner or editor. */
export async function getProposalRoute(
  db: Db,
  actor: Actor,
): Promise<ServiceResult<{ provider: string; model: string } | null>> {
  try {
    const access = await authorizeProject(db, actor, false);
    if (!access.ok) return access;
    if (!access.data.canWrite) return ok(null);
    const resolved = await resolveExtractionRoute(db, { userId: actor.userId, orgId: access.data.orgId });
    return ok(resolved.ok ? resolved.data.route : null);
  } catch (error) {
    return internalFailure(error);
  }
}

export async function getRuleProposals(db: Db, actor: Actor): Promise<ServiceResult<RuleProposals>> {
  try {
    const access = await authorizeProject(db, actor, false);
    if (!access.ok) return access;
    const proposals = await loadProposals(db, access.data.projectId);
    if (!proposals.ok) return proposals;
    const versions = access.data.canWrite ? await sourceVersions(db, access.data.projectId) : ok([]);
    if (!versions.ok) return versions;
    const people: ProfilePerson[] = await namePeople(
      db,
      proposals.data.flatMap((proposal) => [proposal.created_by, proposal.decided_by]),
    );
    return ok({ can_write: access.data.canWrite, proposals: proposals.data, versions: versions.data, people });
  } catch (error) {
    return internalFailure(error);
  }
}

/** Every code of the catalog (a rule of any state: the model must not propose what exists). */
export function catalogCodes(catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES): string[] {
  return [...new Set(catalog.map((rule) => rule.code))].sort();
}

export async function proposeRules(
  db: Db,
  actor: Actor & { versionId: unknown },
  dependencies: Dependencies = {},
  catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES,
): Promise<ServiceResult<RuleProposalRun>> {
  try {
    const access = await authorizeProject(db, actor, true);
    if (!access.ok) return access;
    const versionId = actor.versionId;
    if (typeof versionId !== "string" || !isUuid(versionId)) return failure("not_found", NOT_FOUND);

    const version = await findLiveVersion(db, access.data.projectId, versionId);
    if (!version.ok) return version;
    if (!version.data)
      return failure("validation", "The version is not a document of this project.", VERSION_NOT_IN_MATTER_CODE);

    // Only the text that is ready. Nothing here reads a file, runs OCR or splits it.
    const state = await loadVersionTextState(db, version.data.document_id, versionId);
    const text = state?.text ?? null;
    if (text === null || text.trim() === "")
      return failure("unprocessable", "The text of that version is not ready, so it cannot be read.", SOURCE_TEXT_UNAVAILABLE_CODE);
    // Never cut: a law read in part would look read in full. Upload the relevant chapters instead.
    if (text.length > MAX_EXTRACT_TEXT_CHARS)
      return failure("unprocessable", `The text of that version is longer than ${MAX_EXTRACT_TEXT_CHARS} characters.`, SUGGEST_TEXT_TOO_LARGE_CODE);

    const { data: existing, error: existingError } = await db
      .from("obligation_rule_suggestions")
      .select("version_id, text_sha256, start_char, end_char")
      .eq("flow", PROPOSAL_NEW_FLOW)
      .eq("project_id", access.data.projectId)
      .limit(MAX_PROPOSALS_PER_PROJECT);
    if (existingError) return internalFailure(existingError);
    const known = (existing ?? []) as unknown as { version_id: string; text_sha256: string; start_char: number; end_char: number }[];
    if (known.length >= MAX_PROPOSALS_PER_PROJECT)
      return failure("conflict", "The project holds as many proposals as it can.", PROPOSAL_LIMIT_CODE);
    const textSha = sha256(text);
    const spanKey = (version: string, sha: string, start: number, end: number) => `${version}:${sha}:${start}:${end}`;
    const seen = new Set(known.map((row) => spanKey(row.version_id, row.text_sha256, row.start_char, row.end_char)));

    // The route first, before anything is sent: no key, no call, no other route, no record.
    const routed = await resolveExtractionRoute(db, { userId: actor.userId, orgId: access.data.orgId });
    if (!routed.ok) return routed;
    const { resolved } = routed.data;

    // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
    await recordChatEgressOrThrow(db, {
      userId: actor.userId,
      orgId: access.data.orgId,
      chatId: null,
      projectId: access.data.projectId,
      surface: PROPOSE_SURFACE,
      resolved,
      extra: { version_id: versionId },
    });

    let answer: string;
    try {
      answer = await (dependencies.completeText ?? completeText)({
        model: resolved.route.model,
        systemPrompt: buildProposeSystemPrompt(catalogCodes(catalog)),
        user: buildExtractionPrompt(text, crypto.randomBytes(12).toString("hex")),
        maxTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        apiKeys: resolved.apiKeys,
        abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (error) {
      // Never the provider's words or request: they can carry the text.
      reportError(new AppError("rule_proposals.call_failed", "[radar] rule proposal call failed"), {
        tags: { operation: "radar.propose_rules", provider: resolved.route.provider },
      });
      if (error instanceof UserFacingError)
        return failure("unprocessable", "The AI provider did not accept the request.", SUGGEST_PROVIDER_REFUSED_CODE);
      // 422 and not 503: the gateway rewrites every 5xx, and this code is the client's to read.
      return failure("unprocessable", "The AI provider could not answer.", SUGGEST_PROVIDER_FAILED_CODE);
    }

    const array = readModelArray(answer);
    if (!array) return failure("unprocessable", "The model did not answer with the expected list.", SUGGEST_OUTPUT_INVALID_CODE);

    const plan = planProposals(array);
    const out: RuleProposalRun = {
      proposed: 0,
      discarded_quote_not_found: 0,
      discarded_duplicate: 0,
      discarded_invalid: plan.invalid,
      discarded_term_has_date: 0,
      proposal_ids: [],
    };
    for (const item of plan.items) {
      // 1. The quote is in the text, as the manual path finds it; what is kept is the document's own wording.
      const located = locateQuote(text, item.quote);
      if (!located) {
        out.discarded_quote_not_found += 1;
        continue;
      }
      if ([...located.excerpt].length > PROPOSAL_QUOTE_MAX) {
        out.discarded_invalid += 1;
        continue;
      }
      // 2. Not the same passage of the same text as an earlier proposal (by position and hash).
      const key = spanKey(versionId, textSha, located.start, located.end);
      if (seen.has(key)) {
        out.discarded_duplicate += 1;
        continue;
      }
      const { data: saved, error } = await db
        .from("obligation_rule_suggestions")
        .insert({
          flow: PROPOSAL_NEW_FLOW,
          org_id: access.data.orgId,
          matter_id: null,
          project_id: access.data.projectId,
          document_id: version.data.document_id,
          version_id: versionId,
          text_sha256: textSha,
          start_char: located.start,
          end_char: located.end,
          quote: located.excerpt,
          page: item.page,
          draft: {
            law: item.law,
            article: item.article,
            obligation: item.obligation,
            anchor_name: item.anchorName,
            plazo_propuesto: item.plazoPropuesto,
          },
          ai_provider: resolved.route.provider,
          ai_model: resolved.route.model,
          created_by: actor.userId,
        })
        .select("id")
        .single();
      if (error && isRecord(error) && error.code === "23505") {
        seen.add(key);
        out.discarded_duplicate += 1;
        continue;
      }
      if (error || !saved) return internalFailure(error ?? new Error("proposal insert returned no row"));
      seen.add(key);
      // A calendar date in the term: the term went (it was never saved), the proposal stays.
      if (item.termHadDate) out.discarded_term_has_date += 1;
      out.proposed += 1;
      out.proposal_ids.push((saved as unknown as { id: string }).id);
    }
    return ok(out);
  } catch (error) {
    return internalFailure(error);
  }
}

type Decision = "sent_to_legal" | "discarded" | "implemented";

async function decide(
  db: Db,
  actor: Actor & { proposalId: unknown; body: unknown },
  action: Decision,
  catalog: readonly ObligationRuleDef[],
): Promise<ServiceResult<RuleProposal>> {
  try {
    // A project member decides: the same gate as proposing. Nobody reaches this with an administrator's access alone.
    const access = await authorizeProject(db, actor, true);
    if (!access.ok) return access;
    if (typeof actor.proposalId !== "string" || !isUuid(actor.proposalId)) return failure("not_found", NOT_FOUND);

    let reason: string | null = null;
    let catalogCode: string | null = null;
    if (actor.body != null) {
      if (!isRecord(actor.body)) return failure("validation", "A request body must be an object.", PROPOSAL_INVALID_CODE);
      if (actor.body.reason != null && actor.body.reason !== "") {
        reason = cleanText(actor.body.reason, PROPOSAL_DECISION_REASON_MAX);
        if (!reason)
          return failure("validation", `reason must be 1 to ${PROPOSAL_DECISION_REASON_MAX} characters.`, PROPOSAL_INVALID_CODE);
      }
      if (action === "implemented") {
        const code = typeof actor.body.catalog_code === "string" ? actor.body.catalog_code.trim() : "";
        // The code of the deployed catalog (the code of this release), and a verified rule.
        if (!catalog.some((rule) => rule.code === code && isUsable(rule)))
          return failure("unprocessable", "That code is not a verified rule of the catalog.", PROPOSAL_UNKNOWN_CATALOG_CODE);
        catalogCode = code;
      }
    }
    if (action === "implemented" && !catalogCode)
      return failure("unprocessable", "That code is not a verified rule of the catalog.", PROPOSAL_UNKNOWN_CATALOG_CODE);

    const found = await loadProposals(db, access.data.projectId, actor.proposalId);
    if (!found.ok) return found;
    const proposal = found.data[0];
    if (!proposal) return failure("not_found", NOT_FOUND);

    const allowed =
      action === "sent_to_legal" ? proposal.status === "pending" : action === "implemented" ? proposal.status === "sent_to_legal" : proposal.status === "pending" || proposal.status === "sent_to_legal";
    if (!allowed) return failure("conflict", "That proposal was already decided.", PROPOSAL_ALREADY_DECIDED_CODE);
    // What goes to legal is what the lawyer can still read in the document.
    if (action === "sent_to_legal" && proposal.stale_reason)
      return failure("conflict", "The cited text changed; ask for proposals again.", PROPOSAL_OBSOLETE_CODE);

    const { error } = await db.from("obligation_rule_suggestion_events").insert({
      suggestion_id: proposal.id,
      matter_id: null,
      actor_user_id: actor.userId,
      action,
      reason,
      catalog_code: catalogCode,
    });
    if (error && isRecord(error) && error.code === "23514")
      return failure("conflict", "That proposal was already decided.", PROPOSAL_ALREADY_DECIDED_CODE);
    if (error) return internalFailure(error);

    const after = await loadProposals(db, access.data.projectId, proposal.id);
    if (!after.ok) return after;
    return after.data[0] ? ok(after.data[0]) : failure("not_found", NOT_FOUND);
  } catch (error) {
    return internalFailure(error);
  }
}

export const sendProposalToLegal = (db: Db, actor: Actor & { proposalId: unknown; body: unknown }, catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES) =>
  decide(db, actor, "sent_to_legal", catalog);
export const discardProposal = (db: Db, actor: Actor & { proposalId: unknown; body: unknown }, catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES) =>
  decide(db, actor, "discarded", catalog);
/** A person records that a pull request added the rule to the catalog, with the code it got. */
export const markProposalImplemented = (db: Db, actor: Actor & { proposalId: unknown; body: unknown }, catalog: readonly ObligationRuleDef[] = OBLIGATION_RULES) =>
  decide(db, actor, "implemented", catalog);

/**
 * The file for legal: the drafts of this project that were sent to legal and
 * not discarded, for anyone who can open the project. It is generated for the
 * person's own download; nothing is sent anywhere.
 */
export async function exportRuleProposals(
  db: Db,
  actor: Actor,
  dependencies: Pick<Dependencies, "now"> = {},
): Promise<ServiceResult<RuleProposalExport>> {
  try {
    const access = await authorizeProject(db, actor, false);
    if (!access.ok) return access;
    const proposals = await loadProposals(db, access.data.projectId);
    if (!proposals.ok) return proposals;
    const { data: project, error } = await db.from("projects").select("name").eq("id", access.data.projectId).maybeSingle();
    if (error) return internalFailure(error);
    const projectName = typeof (project as { name?: unknown } | null)?.name === "string" ? (project as { name: string }).name : "";
    const exportedAt = (dependencies.now?.() ?? new Date()).toISOString();

    const included: ExportProposal[] = proposals.data
      .filter((proposal) => proposal.status === "sent_to_legal" || proposal.status === "implemented")
      .sort(byCreatedAt)
      .map((proposal) => ({
        id: proposal.id,
        law: proposal.law,
        article: proposal.article,
        obligation: proposal.obligation,
        anchorName: proposal.anchor_name,
        plazoPropuesto: proposal.plazo_propuesto,
        quote: proposal.quote,
        page: proposal.page,
        source: {
          documentName: proposal.source.filename,
          versionNumber: proposal.source.version_number,
          versionId: proposal.source.version_id,
          textSha256: proposal.source.text_sha256,
          provider: proposal.ai_provider ?? "",
          model: proposal.ai_model ?? "",
        },
      }));
    return ok({
      filename: exportFileName(projectName, exportedAt),
      content: renderProposalsMarkdown(included, { projectName, exportedAt }),
      count: included.length,
    });
  } catch (error) {
    return internalFailure(error);
  }
}
