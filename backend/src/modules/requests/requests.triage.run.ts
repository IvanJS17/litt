/**
 * One run of Donna's triage over a request (docs/request-triage.md).
 *
 * What it reads: the request's title and the text of ALL the documents linked
 * to it as rounds (the latest round of each document), up to a size budget; the
 * card says what was and was not read. Nothing else leaves LiTT: no matter name,
 * profile, memory, chat or other requests.
 *
 *  1. Jev classifies (the platform's key): type, complexity, urgency, candidate.
 *     Candidates go as an opaque key and their function in the matter. If Jev
 *     fails the run says «clasificación no disponible»: the firm's key is never
 *     used to classify instead.
 *  2. The firm's own AI route (the key of the person or the firm, never the
 *     platform's) drafts the strategy, the follow-up questions and the
 *     documents to draft, with the playbooks linked to the type. Without a key
 *     this part does not run; the classification does.
 *  3. The code validates every answer, then writes ONE insert-only run row
 *     (no document text, no title), the items it proposed and one event.
 *
 * Nothing is applied: the lawyer accepts, edits or discards each item. The run
 * never assigns, writes a request field or sends anything to the client.
 */

import crypto from "node:crypto";
import { AppError } from "../../lib/appError";
import { estimateCostUsd, meteredCompletion, recordAiCallUsage } from "../../lib/aiCallUsage";
import { insertAuditEvent } from "../../lib/audit";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { askJev, jevApiKey, JEV_MODEL, JevError } from "../../lib/jev";
import { completeText } from "../../lib/llm";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { locateQuote } from "../chat/chat.service";
import { resolveExtractionRoute } from "../client-profile/client-profile.service";
import { recordChatEgressOrThrow } from "../user/user.service";
import { listAssignees } from "./requests.assignees";
import { recordRequestEvent } from "./requests.events";
import { isRecord } from "./requests.shared";
import { loadTypes } from "./requests.types";
import { countMonthRuns } from "./requests.triage.usage";
import {
  applyAlarm,
  buildJevQuestions,
  buildTriageSystemPrompt,
  buildTriageUserPrompt,
  DONNA_CAP_CODE,
  DONNA_CAP_DETAIL,
  DONNA_DISABLED_CODE,
  DONNA_MONTHLY_RUN_CAP,
  docId,
  hasAlarmWord,
  JEV_SURFACE,
  jevState,
  parseGenerative,
  readClassification,
  selectDocuments,
  TRIAGE_IN_PROGRESS_CODE,
  TRIAGE_MAX_OUTPUT_TOKENS,
  TRIAGE_SURFACE,
  TRIAGE_TIMEOUT_MS,
  typeName,
  type Candidate,
  type Classification,
  type Generative,
  type PlaybookRef,
  type RoundDocument,
  type TriageDocument,
} from "./requests.triage.shared";

export type TriageContext = {
  userId: string;
  userEmail?: string | null;
  orgId: string;
  projectId: string;
  matterId: string;
  requestId: string;
  trigger: "auto" | "manual";
};

export type TriageDeps = {
  /** The platform's Jev key; defaults to TYPESAFE_API_KEY. */
  jevKey?: string | null;
  askJev?: typeof askJev;
  completeText?: typeof completeText;
  resolveRoute?: typeof resolveExtractionRoute;
  now?: () => Date;
};

type RequestRow = { id: string; title: string; type_id: string };

const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");
const NOT_FOUND = "Not found";

// Runs in this process. A second one for the same request is refused (a double
// click, or a manual run while the automatic one is still going).
const inFlight = new Map<string, Promise<unknown>>();

export function isTriagePending(requestId: string): boolean {
  return inFlight.has(requestId);
}

/** Tests wait here for the background runs of the requests they created. */
export async function settleTriageRuns(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight.values()]);
}

/** Whether the project's Donna switch is on. A missing or unreadable project reads as off (fail closed). */
export async function donnaEnabled(db: Db, projectId: string): Promise<ServiceResult<boolean>> {
  const { data, error } = await db.from("projects").select("donna_enabled").eq("id", projectId).maybeSingle();
  if (error) return internalFailure(error);
  return ok(isRecord(data) && data.donna_enabled === true);
}

/** The ready, firm-wide playbooks linked to a type: what the card suggests. */
export async function playbooksForType(db: Db, orgId: string, typeId: string): Promise<ServiceResult<PlaybookRef[]>> {
  const { data: links, error } = await db
    .from("request_type_playbooks")
    .select("playbook_id")
    .eq("org_id", orgId)
    .eq("type_id", typeId)
    .is("unlinked_at", null)
    .order("linked_at", { ascending: true })
    .limit(50);
  if (error) return internalFailure(error);
  const ids = ((links ?? []) as unknown as { playbook_id: string }[]).map((row) => row.playbook_id);
  if (ids.length === 0) return ok([]);
  const { data, error: playbookError } = await db
    .from("playbooks")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("visibility", "organization")
    .eq("status", "ready")
    .in("id", ids)
    .order("name", { ascending: true });
  if (playbookError) return internalFailure(playbookError);
  return ok((data ?? []) as unknown as PlaybookRef[]);
}

type RoundRow = { document_id: string; version_id: string; round_number: number; created_at: string | null };

/** The documents of the request: the latest round of each document, newest first. */
async function loadRoundDocuments(db: Db, requestId: string): Promise<ServiceResult<RoundDocument[]>> {
  const { data, error } = await db
    .from("matter_request_rounds")
    .select("document_id, version_id, round_number, created_at")
    .eq("request_id", requestId)
    .order("round_number", { ascending: false })
    .limit(500);
  if (error) return internalFailure(error);
  const rows = ((data ?? []) as unknown as RoundRow[]).sort(
    (a, b) => b.round_number - a.round_number || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")),
  );
  const latest = new Map<string, RoundRow>();
  for (const row of rows) if (!latest.has(row.document_id)) latest.set(row.document_id, row);
  const documents: RoundDocument[] = [];
  for (const row of latest.values()) {
    const state = await loadVersionTextState(db, row.document_id, row.version_id);
    documents.push({ versionId: row.version_id, documentId: row.document_id, text: state?.text ?? null });
  }
  return ok(documents);
}

type Item = {
  kind: string;
  position: number;
  value_type_id?: string | null;
  value_enum?: string | null;
  value_user_id?: string | null;
  confidence?: number | null;
  low_confidence?: boolean;
  forced_by_alarm?: boolean;
  draft_text?: string | null;
  draft_purpose?: string | null;
  playbook_id?: string | null;
  version_id?: string | null;
  start_char?: number | null;
  end_char?: number | null;
  text_sha256?: string | null;
};

function classificationItems(classification: Classification): Item[] {
  const items: Item[] = [];
  const { type, complexity, urgency, candidate } = classification;
  if (type) items.push({ kind: "type", position: 0, value_type_id: type.typeId, confidence: type.confidence, low_confidence: type.low });
  if (complexity) items.push({ kind: "complexity", position: 0, value_enum: complexity.value, confidence: complexity.confidence, low_confidence: complexity.low });
  if (urgency)
    items.push({
      kind: "urgency",
      position: 0,
      value_enum: urgency.value,
      confidence: urgency.confidence,
      low_confidence: urgency.confidence !== null && urgency.confidence < 0.7,
      forced_by_alarm: urgency.forcedByAlarm,
    });
  if (candidate) items.push({ kind: "candidate", position: 0, value_user_id: candidate.userId, confidence: candidate.confidence, low_confidence: candidate.low });
  return items;
}

type GenerativeOutcome = {
  status: "ok" | "empty" | "no_key" | "unavailable" | "invalid";
  provider: string | null;
  model: string | null;
  items: Item[];
  quotesRejected: number;
};

async function draft(
  db: Db,
  ctx: TriageContext,
  deps: TriageDeps,
  input: { title: string; typeLabel: string | null; docs: readonly TriageDocument[]; playbooks: readonly PlaybookRef[] },
): Promise<GenerativeOutcome> {
  const none = (status: GenerativeOutcome["status"], provider: string | null = null, model: string | null = null): GenerativeOutcome => ({
    status,
    provider,
    model,
    items: [],
    quotesRejected: 0,
  });
  // The firm's route first, before anything is sent: no key, no call, no other route.
  const routed = await (deps.resolveRoute ?? resolveExtractionRoute)(db, { userId: ctx.userId, orgId: ctx.orgId });
  if (!routed.ok) return none("no_key");
  const { resolved } = routed.data;
  const route = { provider: resolved.route.provider, model: resolved.route.model };

  // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
  try {
    await recordChatEgressOrThrow(db, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      chatId: null,
      projectId: ctx.projectId,
      surface: TRIAGE_SURFACE,
      resolved,
      extra: { matter_id: ctx.matterId, request_id: ctx.requestId, document_count: String(input.docs.length) },
    });
  } catch (error) {
    reportError(new AppError("donna_triage.egress_record_failed", "[triage] egress record failed", { cause: error }), {
      tags: { operation: "requests.triage.egress" },
    });
    return none("unavailable", route.provider, route.model);
  }

  let answer: string;
  try {
    // Tokens and engine of the call go to ai_call_usage (lib/aiCallUsage), once it answered.
    const metered = meteredCompletion(
      db,
      {
        surface: TRIAGE_SURFACE,
        userId: ctx.userId,
        orgId: ctx.orgId,
        matterId: ctx.matterId,
        projectId: ctx.projectId,
        provider: route.provider,
        model: route.model,
      },
      deps.completeText ?? completeText,
    );
    answer = await metered({
      model: route.model,
      systemPrompt: buildTriageSystemPrompt(),
      user: buildTriageUserPrompt({ ...input, delimiter: crypto.randomBytes(12).toString("hex") }),
      maxTokens: TRIAGE_MAX_OUTPUT_TOKENS,
      apiKeys: resolved.apiKeys,
      abortSignal: AbortSignal.timeout(TRIAGE_TIMEOUT_MS),
    });
  } catch {
    // Never the provider's words or request: they can carry the documents.
    reportError(new AppError("donna_triage.byok_call_failed", "[triage] AI route call failed"), {
      tags: { operation: "requests.triage.byok", provider: route.provider },
    });
    return none("unavailable", route.provider, route.model);
  }

  const parsed = parseGenerative(answer);
  if (!parsed) return none("invalid", route.provider, route.model);
  const validated = validateDraft(parsed, input.docs, input.playbooks);
  if (validated.items.length === 0) return { status: "empty", provider: route.provider, model: route.model, ...validated };
  return { status: "ok", provider: route.provider, model: route.model, ...validated };
}

/** The code's checks on the drafts: a cited passage must be in its document; a playbook must be one that was sent. */
function validateDraft(
  generative: Generative,
  docs: readonly TriageDocument[],
  playbooks: readonly PlaybookRef[],
): { items: Item[]; quotesRejected: number } {
  const items: Item[] = [];
  let quotesRejected = 0;
  generative.strategy.forEach((step) => {
    const item: Item = { kind: "strategy", position: items.filter((one) => one.kind === "strategy").length, draft_text: step.text };
    if (step.documentId !== null && step.quote !== null) {
      const index = docs.findIndex((_, i) => docId(i) === step.documentId);
      const doc = index >= 0 ? docs[index] : null;
      const located = doc ? locateQuote(doc.text, step.quote) : null;
      if (!doc || !located) {
        // A step that cites a passage that is not there is dropped, and counted.
        quotesRejected += 1;
        return;
      }
      Object.assign(item, {
        version_id: doc.versionId,
        start_char: located.start,
        end_char: located.end,
        text_sha256: sha256(doc.text),
      });
    }
    items.push(item);
  });
  generative.questions.forEach((text, position) => items.push({ kind: "question", position, draft_text: text }));
  const sent = new Set(playbooks.map((playbook) => playbook.id));
  generative.documents.forEach((one, position) =>
    items.push({
      kind: "document",
      position,
      draft_text: one.name,
      draft_purpose: one.purpose,
      playbook_id: one.playbookId !== null && sent.has(one.playbookId) ? one.playbookId : null,
    }),
  );
  return { items, quotesRejected };
}

/** Runs triage for one request and records it. */
export async function executeTriage(
  db: Db,
  ctx: TriageContext,
  deps: TriageDeps = {},
): Promise<ServiceResult<{ runId: string }>> {
  if (inFlight.has(ctx.requestId))
    return failure("conflict", "A triage of this request is already running.", TRIAGE_IN_PROGRESS_CODE);
  const task = runTriage(db, ctx, deps);
  inFlight.set(ctx.requestId, task);
  try {
    return await task;
  } finally {
    inFlight.delete(ctx.requestId);
  }
}

async function runTriage(db: Db, ctx: TriageContext, deps: TriageDeps): Promise<ServiceResult<{ runId: string }>> {
  try {
    const started = Date.now();
    const now = deps.now?.() ?? new Date();

    const enabled = await donnaEnabled(db, ctx.projectId);
    if (!enabled.ok) return enabled;
    if (!enabled.data) return failure("conflict", "Donna is off in this project.", DONNA_DISABLED_CODE);

    // The monthly cap, before anything is read or sent.
    const used = await countMonthRuns(db, ctx.orgId, now);
    if (!used.ok) return used;
    if (used.data >= DONNA_MONTHLY_RUN_CAP) return failure("conflict", DONNA_CAP_DETAIL, DONNA_CAP_CODE);

    const { data: requestData, error: requestError } = await db
      .from("matter_requests")
      .select("id, title, type_id")
      .eq("id", ctx.requestId)
      .eq("matter_id", ctx.matterId)
      .maybeSingle();
    if (requestError) return internalFailure(requestError);
    if (!requestData) return failure("not_found", NOT_FOUND);
    const request = requestData as unknown as RequestRow;

    const [types, assignees, rounds] = await Promise.all([
      loadTypes(db, ctx.orgId),
      listAssignees(db, { matterId: ctx.matterId, organizationId: ctx.orgId }),
      loadRoundDocuments(db, ctx.requestId),
    ]);
    if (!types.ok) return types;
    if (!assignees.ok) return assignees;
    if (!rounds.ok) return rounds;

    const selection = selectDocuments(rounds.data, request.title);
    const candidates: Candidate[] = assignees.data.map((one) => ({ user_id: one.user_id, role: one.role }));
    const state = jevState(request.title, selection.read);
    const charsSent = request.title.length + selection.read.reduce((sum, doc) => sum + doc.text.length, 0);
    const inputSha = sha256(JSON.stringify(state));

    // 1. Jev classifies.
    const plan = buildJevQuestions(types.data, candidates);
    let classification: Classification = { type: null, complexity: null, urgency: null, candidate: null, schemaFailures: 0 };
    let classifyStatus: "ok" | "unavailable" | "invalid" = "unavailable";
    let classifyError: string | null = null;
    let jev: { model: string; input: number | null; output: number | null } | null = null;
    const key = deps.jevKey === undefined ? jevApiKey() : deps.jevKey;
    if (!key) classifyError = "no_key";
    else {
      try {
        // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
        await insertAuditEvent(db, {
          userId: ctx.userId,
          userEmail: ctx.userEmail ?? null,
          orgId: ctx.orgId,
          action: "llm.egress",
          surface: JEV_SURFACE,
          projectId: ctx.projectId,
          model: JEV_MODEL,
          detail: {
            provider: "typesafe",
            host: "api.typesafe.ai",
            matter_id: ctx.matterId,
            request_id: ctx.requestId,
            document_count: String(selection.read.length),
          },
        });
        const response = await (deps.askJev ?? askJev)(key, { state, questions: plan.questions });
        jev = { model: response.model, input: response.inputTokens, output: response.outputTokens };
        await recordAiCallUsage(
          db,
          {
            surface: JEV_SURFACE,
            engine: "jev",
            userId: ctx.userId,
            orgId: ctx.orgId,
            matterId: ctx.matterId,
            projectId: ctx.projectId,
            provider: "typesafe",
            model: response.model,
          },
          { inputTokens: response.inputTokens, outputTokens: response.outputTokens },
        );
        classification = readClassification(response, plan, types.data, candidates);
        classifyStatus = classification.schemaFailures >= Object.keys(plan.questions).length ? "invalid" : "ok";
        if (classification.schemaFailures > 0 && classifyStatus === "ok") classifyError = "partial";
        if (classifyStatus === "invalid") classifyError = "bad_answer";
      } catch (error) {
        classifyError = error instanceof JevError ? error.code : "audit_failed";
        reportError(new AppError("donna_triage.jev_failed", `[triage] Jev classification failed: ${classifyError}`), {
          tags: { operation: "requests.triage.jev" },
        });
      }
    }
    // The alarm words raise the urgency whatever the engine did.
    classification = applyAlarm(classification, hasAlarmWord([request.title, ...selection.read.map((doc) => doc.text)]));

    // 2. The firm's own AI route drafts.
    const typeId = classification.type?.typeId ?? request.type_id;
    const chosen = types.data.find((type) => type.id === typeId);
    const playbooks = await playbooksForType(db, ctx.orgId, typeId);
    if (!playbooks.ok) return playbooks;
    const generative = await draft(db, ctx, deps, {
      title: request.title,
      typeLabel: chosen ? typeName(chosen) : null,
      docs: selection.read,
      playbooks: playbooks.data,
    });

    // 3. One insert-only run row, its items and one event. No text of any document, no title.
    const { data: run, error: runError } = await db
      .from("matter_request_triage_runs")
      .insert({
        org_id: ctx.orgId,
        project_id: ctx.projectId,
        matter_id: ctx.matterId,
        request_id: ctx.requestId,
        trigger: ctx.trigger,
        started_by: ctx.userId,
        classify_status: classifyStatus,
        classify_error: classifyError,
        jev_model: jev?.model ?? null,
        jev_input_tokens: jev?.input ?? null,
        jev_output_tokens: jev?.output ?? null,
        jev_cost_usd: jev ? estimateCostUsd("jev", { inputTokens: jev.input, outputTokens: jev.output }) : null,
        generative_status: generative.status,
        generative_provider: generative.provider,
        generative_model: generative.model,
        input_sha256: inputSha,
        chars_sent: charsSent,
        docs_total: rounds.data.length,
        docs_read: selection.read.length,
        docs_partial: selection.read.filter((doc) => doc.partial).length,
        read_version_ids: selection.read.map((doc) => doc.versionId),
        unread_version_ids: selection.unread.map((doc) => doc.versionId),
        quotes_rejected: generative.quotesRejected,
        schema_failures: classification.schemaFailures,
        duration_ms: Date.now() - started,
        created_at: now.toISOString(),
      })
      .select("id")
      .single();
    if (runError || !run) return internalFailure(runError ?? new Error("triage run insert returned no row"));
    const runId = (run as unknown as { id: string }).id;

    const items = [...classificationItems(classification), ...generative.items];
    if (items.length > 0) {
      const { error: itemsError } = await db.from("matter_request_triage_items").insert(
        items.map((item) => ({
          run_id: runId,
          request_id: ctx.requestId,
          matter_id: ctx.matterId,
          org_id: ctx.orgId,
          ...item,
        })),
      );
      if (itemsError) return internalFailure(itemsError);
    }
    await recordRequestEvent(db, {
      requestId: ctx.requestId,
      matterId: ctx.matterId,
      actorUserId: ctx.userId,
      action: "triage_proposed",
      detail: {
        run_id: runId,
        trigger: ctx.trigger,
        kinds: [...new Set(items.map((item) => item.kind))],
        classify_status: classifyStatus,
        generative_status: generative.status,
      },
    });
    return ok({ runId });
  } catch (error) {
    return internalFailure(error);
  }
}

/**
 * The automatic run on creating a request: in the background, so creating the
 * request does not wait for two engines. It runs only if the project's switch is
 * on and the month's cap is not reached; either way the request is already
 * created. A failure is reported, never shown as a failure of the creation.
 */
export function scheduleAutoTriage(db: Db, ctx: Omit<TriageContext, "trigger">, deps: TriageDeps = {}): void {
  const task = (async () => {
    try {
      const result = await runTriage(db, { ...ctx, trigger: "auto" }, deps);
      if (!result.ok && result.kind === "error")
        reportError(new AppError("donna_triage.auto_failed", "[triage] automatic run failed", { cause: result.error }), {
          tags: { operation: "requests.triage.auto" },
        });
    } catch (error) {
      reportError(new AppError("donna_triage.auto_failed", "[triage] automatic run failed", { cause: error }), {
        tags: { operation: "requests.triage.auto" },
      });
    }
  })();
  inFlight.set(ctx.requestId, task);
  void task.finally(() => {
    if (inFlight.get(ctx.requestId) === task) inFlight.delete(ctx.requestId);
  });
}
