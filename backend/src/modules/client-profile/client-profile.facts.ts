/**
 * The client profile of a retainer matter: list the facts and capture a new
 * one. A fact is saved only with a citation that is really in the cited
 * version's text (`locateQuote`, the same locator the chat uses); a quote that
 * is not there saves nothing. Nothing is deleted or edited: a fact is decided
 * (client-profile.decide.ts) or left pending.
 */

import type { ClientProfile, ProfileFact, ProfilePerson, ProfileSourceVersion } from "@mike/contracts";
import { loadCreatorProfiles } from "../../lib/userLookup";
import { AppError } from "../../lib/appError";
import { reportError } from "../../lib/observability/report";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import { isUuid } from "../../lib/uuid";
import { loadVersionTextState } from "../../lib/documentTextCache";
import { locateQuote } from "../chat/chat.service";
import { authorizeMatterMember, type MatterAccess } from "../matters/matters.service";
import { findLiveVersion, readSources, sha256, sourceStateFor } from "./client-profile.source";
import {
  EVENT_COLUMNS,
  FACT_COLUMNS,
  FACT_LIMIT_CODE,
  INVALID_FACT_CODE,
  MAX_FACTS_PER_MATTER,
  MAX_SOURCE_VERSIONS,
  NOT_A_RETAINER_CODE,
  parseFact,
  QUOTE_MAX,
  QUOTE_NOT_FOUND_CODE,
  SOURCE_TEXT_UNAVAILABLE_CODE,
  toFact,
  VERSION_NOT_IN_MATTER_CODE,
  type EventRow,
  type FactRow,
} from "./client-profile.shared";

export type Actor = {
  userId: string;
  userEmail?: string | null;
  projectId: unknown;
  matterId: unknown;
};

export const NOT_FOUND = "Not found";

export async function loadEvents(db: Db, matterId: string, factId?: string): Promise<ServiceResult<EventRow[]>> {
  let query = db.from("matter_profile_fact_events").select(EVENT_COLUMNS).eq("matter_id", matterId);
  if (factId) query = query.eq("fact_id", factId);
  const { data, error } = await query.order("created_at", { ascending: true }).limit(MAX_FACTS_PER_MATTER * 3);
  if (error) return internalFailure(error);
  return ok((data ?? []) as unknown as EventRow[]);
}

/** Facts of a matter with their events and the state of their sources. */
export async function loadFacts(
  db: Db,
  access: Pick<MatterAccess, "matterId" | "projectId">,
  only?: string,
): Promise<ServiceResult<ProfileFact[]>> {
  let query = db.from("matter_profile_facts").select(FACT_COLUMNS).eq("matter_id", access.matterId);
  if (only) query = query.eq("id", only);
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(MAX_FACTS_PER_MATTER);
  if (error) return internalFailure(error);
  const rows = (data ?? []) as unknown as FactRow[];
  const events = await loadEvents(db, access.matterId, only);
  if (!events.ok) return events;
  const byFact = new Map<string, EventRow[]>();
  for (const event of events.data) byFact.set(event.fact_id, [...(byFact.get(event.fact_id) ?? []), event]);
  // A rejected fact is never stale, so its source is not read.
  const open = rows.filter((row) => !(byFact.get(row.id) ?? []).some((event) => event.action === "rejected"));
  const sources = await readSources(db, access.projectId, open);
  if (!sources.ok) return sources;
  return ok(
    rows.map((row) => toFact(row, byFact.get(row.id) ?? [], sourceStateFor(row, sources.data))),
  );
}

async function sourceVersions(db: Db, projectId: string): Promise<ServiceResult<ProfileSourceVersion[]>> {
  const { data: documents, error } = await db
    .from("documents")
    .select("id")
    .eq("project_id", projectId)
    .is("archived_at", null)
    .limit(MAX_SOURCE_VERSIONS);
  if (error) return internalFailure(error);
  const ids = ((documents ?? []) as unknown as { id: string }[]).map((row) => row.id);
  if (ids.length === 0) return ok([]);
  const { data, error: versionError } = await db
    .from("document_versions")
    .select("id, document_id, version_number, filename")
    .in("document_id", ids)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_SOURCE_VERSIONS);
  if (versionError) return internalFailure(versionError);
  return ok(
    ((data ?? []) as unknown as { id: string; document_id: string; version_number: number | null; filename: string | null }[]).map(
      (row) => ({
        document_id: row.document_id,
        version_id: row.id,
        version_number: row.version_number,
        filename: row.filename,
      }),
    ),
  );
}

async function peopleOf(db: Db, facts: readonly ProfileFact[]): Promise<ProfilePerson[]> {
  const ids = new Set<string>();
  for (const fact of facts) {
    if (fact.created_by) ids.add(fact.created_by);
    for (const event of fact.events) if (event.actor_user_id) ids.add(event.actor_user_id);
  }
  const profiles = await loadCreatorProfiles(db, [...ids].map((user_id) => ({ user_id })));
  return [...ids].map((user_id) => {
    const profile = profiles.get(user_id);
    return { user_id, name: profile?.display_name ?? profile?.email ?? null };
  });
}

export async function getClientProfile(db: Db, actor: Actor): Promise<ServiceResult<ClientProfile>> {
  try {
    const access = await authorizeMatterMember(db, actor);
    if (!access.ok) return access;
    const { isRetainer, canWrite } = access.data;
    if (!isRetainer) return ok({ retainer: false, can_write: false, facts: [], versions: [], people: [] });
    const facts = await loadFacts(db, access.data);
    if (!facts.ok) return facts;
    const versions = canWrite ? await sourceVersions(db, access.data.projectId) : ok([]);
    if (!versions.ok) return versions;
    return ok({
      retainer: true,
      can_write: canWrite,
      facts: facts.data,
      versions: versions.data,
      people: await peopleOf(db, facts.data),
    });
  } catch (error) {
    return internalFailure(error);
  }
}

export async function createProfileFact(
  db: Db,
  actor: Actor & { body: unknown },
): Promise<ServiceResult<ProfileFact>> {
  try {
    const access = await authorizeMatterMember(db, { ...actor, write: true });
    if (!access.ok) return access;
    if (!access.data.isRetainer)
      return failure("conflict", "The matter is not a retainer.", NOT_A_RETAINER_CODE);
    const parsed = parseFact(actor.body);
    if (!parsed.ok) return failure("validation", parsed.detail, parsed.code);
    const { kind, label, data, versionId, quote } = parsed.value;

    const version = await findLiveVersion(db, access.data.projectId, versionId);
    if (!version.ok) return version;
    if (!version.data)
      return failure("validation", "The version is not a document of this matter.", VERSION_NOT_IN_MATTER_CODE);

    const state = await loadVersionTextState(db, version.data.document_id, versionId);
    if (!state || state.text === null)
      return failure(
        "unprocessable",
        "The text of that version is not ready, so the passage cannot be checked.",
        SOURCE_TEXT_UNAVAILABLE_CODE,
      );
    const located = locateQuote(state.text, quote);
    if (!located)
      return failure("unprocessable", "That passage is not in the document version.", QUOTE_NOT_FOUND_CODE);
    if (located.excerpt.length > QUOTE_MAX)
      return failure("validation", `The quote is at most ${QUOTE_MAX} characters.`, INVALID_FACT_CODE);

    const { data: existing, error: countError } = await db
      .from("matter_profile_facts")
      .select("id")
      .eq("matter_id", access.data.matterId)
      .limit(MAX_FACTS_PER_MATTER);
    if (countError) return internalFailure(countError);
    if ((existing ?? []).length >= MAX_FACTS_PER_MATTER)
      return failure("conflict", "The profile holds as many facts as it can.", FACT_LIMIT_CODE);

    const { data: inserted, error } = await db
      .from("matter_profile_facts")
      .insert({
        matter_id: access.data.matterId,
        kind,
        label,
        data,
        document_id: version.data.document_id,
        version_id: versionId,
        start_char: located.start,
        end_char: located.end,
        quote: located.excerpt,
        text_sha256: sha256(state.text),
        created_by: actor.userId,
      })
      .select(FACT_COLUMNS)
      .single();
    if (error || !inserted) return internalFailure(error);
    const row = inserted as unknown as FactRow;

    // Like the requests' events, a lost "created" row is reported and never
    // hides a fact that was saved; a decision's row is another matter
    // (client-profile.decide.ts) and is never swallowed.
    const { data: event, error: eventError } = await db
      .from("matter_profile_fact_events")
      .insert({ fact_id: row.id, matter_id: row.matter_id, actor_user_id: actor.userId, action: "created" })
      .select(EVENT_COLUMNS)
      .single();
    if (eventError)
      reportError(new AppError("client_profile.event_write_failed", "[client-profile] event insert failed", { cause: eventError }), {
        tags: { operation: "client_profile.event" },
      });
    const sources = new Map([
      [versionId, { versionNumber: version.data.version_number, filename: version.data.filename, staleReason: null, currentSha: sha256(state.text) }],
    ]);
    return ok(toFact(row, event ? [event as unknown as EventRow] : [], sourceStateFor(row, sources)));
  } catch (error) {
    return internalFailure(error);
  }
}

export const isFactId = (value: unknown): value is string => typeof value === "string" && isUuid(value);
