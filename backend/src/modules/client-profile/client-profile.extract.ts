/**
 * Assisted extraction (S6, docs/client-profile.md): on the lawyer's click, the
 * model of the space reads ONE version's text and proposes profile facts, each
 * with a literal quote the code must find in that text. Proposals are normal
 * facts, pending until a lawyer confirms or rejects them one by one.
 *
 * What leaves LiTT, per click: the fixed prompt and the version's text, and
 * nothing else (no file name, matter or client name, account, instructions,
 * memory, chat, other documents or existing facts). It goes from the server, to
 * the provider of the route the project chat would use in this space, with that
 * route's key; there is no other route and no silent fallback. It never goes
 * to TypeSafe, LandingAI or a web search, and the button never starts OCR or a
 * split: a version without ready text is refused.
 */

import crypto from "node:crypto";
import type { ProfileExtraction, ProfileExtractionRoute } from "@mike/contracts";
import { AppError } from "../../lib/appError";
import { completeText } from "../../lib/llm";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { UserFacingError } from "../../lib/userFacingError";
import { isUuid } from "../../lib/uuid";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { locateQuote } from "../chat/chat.service";
import { authorizeMatterMember } from "../matters/matters.service";
import {
  governChatRoute,
  listChatCredentialOptions,
  recordChatEgressOrThrow,
  resolveUserChatSelection,
  type ChatRouteFailure,
  type ResolvedChatRoute,
} from "../user/user.service";
import { insertFact, type Actor } from "./client-profile.facts";
import { findLiveVersion, sha256 } from "./client-profile.source";
import {
  ASSISTED_EXTRACTION_REASON,
  buildExtractionPrompt,
  EXTRACT_MAX_OUTPUT_TOKENS,
  EXTRACT_OUTPUT_INVALID_CODE,
  EXTRACT_PROVIDER_FAILED_CODE,
  EXTRACT_PROVIDER_REFUSED_CODE,
  EXTRACT_SYSTEM_PROMPT,
  EXTRACT_TEXT_TOO_LARGE_CODE,
  EXTRACT_TIMEOUT_MS,
  EXTRACTION_SURFACE,
  MAX_EXTRACT_TEXT_CHARS,
  planExtraction,
  readModelArray,
} from "./client-profile.extract.shared";
import {
  FACT_LIMIT_CODE,
  MAX_FACTS_PER_MATTER,
  NOT_A_RETAINER_CODE,
  parseFact,
  QUOTE_MAX,
  SOURCE_TEXT_UNAVAILABLE_CODE,
  VERSION_NOT_IN_MATTER_CODE,
} from "./client-profile.shared";

type Route = { route: ProfileExtractionRoute; resolved: ResolvedChatRoute };

const NOT_FOUND = "Not found";

function routeFailure(error: Pick<ChatRouteFailure, "status" | "code" | "detail"> | { status: number; code: string; detail: string }) {
  const kind = error.status === 400 ? "validation" : error.status === 409 ? "conflict" : "unprocessable";
  return failure(kind, error.detail, error.code);
}

/**
 * The route the project chat would take in this space for this person: the
 * same model selection, the same default key and the same governance, fixed
 * for the call. A model
 * or key that is missing fails closed with the chat's own code
 * (`missing_api_key`, `model_required`, `chat_route_credential_required`, …).
 */
async function resolveRoute(db: Db, args: { userId: string; orgId: string }): Promise<ServiceResult<Route>> {
  const selection = await resolveUserChatSelection(db, { userId: args.userId, orgId: args.orgId });
  if (!selection.ok) return routeFailure(selection);
  // What the chat's key selector preselects for a new conversation here (the
  // person's own key, then the firm's, then the deployment's); sent as the
  // explicit choice, exactly as the chat client does. None: it fails closed.
  const choices = await listChatCredentialOptions(db, {
    userId: args.userId,
    orgId: args.orgId,
    model: selection.selectedModel,
  });
  const governed = await governChatRoute(db, {
    userId: args.userId,
    orgId: args.orgId,
    chat: null,
    selectedModel: selection.selectedModel,
    requestedCredentialRef: choices?.default ?? null,
  });
  if (!governed.ok) return routeFailure(governed);
  return ok({ route: { provider: governed.route.provider, model: governed.route.model }, resolved: governed });
}

/** Whether the button can be offered, and to which provider the text would go. */
export async function getExtractionRoute(db: Db, actor: Actor): Promise<ServiceResult<ProfileExtractionRoute | null>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    if (!access.data.isRetainer || !access.data.canWrite) return ok(null);
    const resolved = await resolveRoute(db, { userId: actor.userId, orgId: access.data.organizationId });
    if (!resolved.ok) return ok(null);
    return ok(resolved.data.route);
  } catch (error) {
    return internalFailure(error);
  }
}

type Dependencies = { completeText?: typeof completeText };

export async function extractProfileFacts(
  db: Db,
  actor: Actor & { versionId: unknown },
  dependencies: Dependencies = {},
): Promise<ServiceResult<ProfileExtraction>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer)
      return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    const versionId = actor.versionId;
    if (typeof versionId !== "string" || !isUuid(versionId)) return failure("not_found", NOT_FOUND);

    const version = await findLiveVersion(db, access.data.projectId, versionId);
    if (!version.ok) return version;
    if (!version.data)
      return failure("validation", "The version is not a document of this matter.", VERSION_NOT_IN_MATTER_CODE);

    // Only the text that is ready. Nothing here reads a file, runs OCR or splits it.
    const state = await loadVersionTextState(db, version.data.document_id, versionId);
    const text = state?.text ?? null;
    if (text === null || text.trim() === "")
      return failure(
        "unprocessable",
        "The text of that version is not ready, so it cannot be read.",
        SOURCE_TEXT_UNAVAILABLE_CODE,
      );
    if (text.length > MAX_EXTRACT_TEXT_CHARS)
      return failure(
        "unprocessable",
        `The text of that version is longer than ${MAX_EXTRACT_TEXT_CHARS} characters.`,
        EXTRACT_TEXT_TOO_LARGE_CODE,
      );

    const { data: existing, error: existingError } = await db
      .from("matter_profile_facts")
      .select("kind, data, version_id, start_char, end_char, text_sha256")
      .eq("matter_id", access.data.matterId)
      .limit(MAX_FACTS_PER_MATTER);
    if (existingError) return internalFailure(existingError);
    const known = (existing ?? []) as unknown as {
      kind: string;
      data: unknown;
      version_id: string;
      start_char: number;
      end_char: number;
      text_sha256: string;
    }[];
    let room = MAX_FACTS_PER_MATTER - known.length;
    if (room <= 0)
      return failure("conflict", "The profile holds as many facts as it can.", FACT_LIMIT_CODE);

    // The route first, before anything is sent: no key, no call, no other route.
    const routed = await resolveRoute(db, { userId: actor.userId, orgId: access.data.organizationId });
    if (!routed.ok) return routed;
    const { resolved } = routed.data;
    // Recorded before the text leaves; if it cannot be recorded, nothing is sent.
    await recordChatEgressOrThrow(db, {
      userId: actor.userId,
      orgId: access.data.organizationId,
      chatId: null,
      projectId: access.data.projectId,
      surface: EXTRACTION_SURFACE,
      resolved,
      extra: { matter_id: access.data.matterId, version_id: versionId },
    });

    let raw: string;
    try {
      raw = await (dependencies.completeText ?? completeText)({
        model: resolved.route.model,
        systemPrompt: EXTRACT_SYSTEM_PROMPT,
        user: buildExtractionPrompt(text, crypto.randomBytes(12).toString("hex")),
        maxTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        apiKeys: resolved.apiKeys,
        abortSignal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
      });
    } catch (error) {
      // Never the provider's words or request: they can carry the document.
      reportError(new AppError("client_profile.extraction_failed", "[client-profile] extraction call failed"), {
        tags: { operation: "client_profile.extract", provider: resolved.route.provider },
      });
      if (error instanceof UserFacingError)
        return failure("unprocessable", "The AI provider did not accept the request.", EXTRACT_PROVIDER_REFUSED_CODE);
      // 422 and not 503: the gateway rewrites every 5xx, and this code is the client's to read.
      return failure("unprocessable", "The AI provider could not answer.", EXTRACT_PROVIDER_FAILED_CODE);
    }

    const array = readModelArray(raw);
    if (!array)
      return failure("unprocessable", "The model did not answer with the expected list.", EXTRACT_OUTPUT_INVALID_CODE);

    const plan = planExtraction(array, versionId, (body) => {
      const parsed = parseFact(body);
      return parsed.ok ? parsed : { ok: false };
    });
    const seen = new Set(
      known
        .filter((fact) => fact.version_id === versionId)
        .map((fact) => dedupeKey(fact.kind, fact.data, fact.start_char, fact.end_char, fact.text_sha256)),
    );

    const out: ProfileExtraction = {
      proposed: 0,
      discarded_quote_not_found: 0,
      discarded_invalid: plan.invalid,
      discarded_duplicate: 0,
      fact_ids: [],
    };
    for (const { parsed } of plan.facts) {
      // The same check as a fact typed by hand: the quote must be in the version's text.
      const located = locateQuote(text, parsed.quote);
      if (!located) {
        out.discarded_quote_not_found += 1;
        continue;
      }
      if (located.excerpt.length > QUOTE_MAX || room <= 0) {
        out.discarded_invalid += 1;
        continue;
      }
      const key = dedupeKey(parsed.kind, parsed.data, located.start, located.end, sha256(text));
      if (seen.has(key)) {
        out.discarded_duplicate += 1;
        continue;
      }
      const saved = await insertFact(db, {
        matterId: access.data.matterId,
        userId: actor.userId,
        version: version.data,
        text,
        kind: parsed.kind,
        label: parsed.label,
        data: parsed.data,
        located,
        reason: ASSISTED_EXTRACTION_REASON,
      });
      if (!saved.ok) return saved;
      seen.add(key);
      room -= 1;
      out.proposed += 1;
      out.fact_ids.push(saved.data.id);
    }
    return ok(out);
  } catch (error) {
    return internalFailure(error);
  }
}

/** Same kind, same data, same passage of the same text: the same proposal. */
function dedupeKey(kind: string, data: unknown, start: number, end: number, textSha: string): string {
  return JSON.stringify([kind, canonical(data), start, end, textSha]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  return value;
}
