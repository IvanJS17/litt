// The machine's reading and the comparison (docs/training.md, layer 3).
//
// Only after the person sent what they found (trainingFullReading.readings
// .ts): a model reads the same stored text and lists its findings, each with a
// literal quote; every finding whose quote is not located in the text
// (locateQuote, the same check citations use) is discarded, so what is kept
// always rests on a passage that exists. A second call pairs the machine's
// findings with the person's own lines. «Coincidieron / Solo lo viste tú /
// Solo lo vio la máquina» are computed from that pairing; the pairing is the
// only thing the model decides, and the screen says it is inferred.
//
// With what: the PERSON's route (governed BYOK, trainingFullReading.route.ts),
// stored on the row, no fallback; llm.egress before each call that sends
// text. One comparison runs at a time (status `comparing`, claimed with the
// row's previous state); a call that fails leaves `failed` and writes nothing
// else, and may be retried. The document's text and the findings are
// the client's, so a failure logs only the reading's id.

import type { TrainingReading } from "@mike/contracts";
import { promptNonce } from "../../lib/promptFence";
import { failure, internalFailure, ok, type ServiceResult } from "../../lib/serviceResult";
import type { Db } from "../../lib/supabase";
import {
    buildComparePrompt,
    buildComparison,
    buildReadingPrompt,
    isReadableDocumentText,
    parseMachineFindings,
    parseMatches,
    personItems,
    READING_COMPARE_MAX_TOKENS,
    READING_COMPARE_SYSTEM_PROMPT,
    READING_MAX_TOKENS,
    READING_SYSTEM_PROMPT,
} from "../../lib/trainingReading";
import { completeSupervision } from "../../lib/trainingSupervisionAi";
import { locateQuote } from "../chat/chat.service";
import { readStoredDocumentText } from "../documents/documents.service";
import { REVIEW_IN_PROGRESS_CODE } from "../training-supervision/trainingSupervision.service";
import { chatRouteColumns, parseCredentialRef, recordChatEgress } from "../user/user.service";
import { READING_DOCUMENT_UNAVAILABLE_CODE, ownReading } from "./trainingFullReading.readings";
import { readingRoute } from "./trainingFullReading.route";
import { effectiveReadingStatus, serializeReading, type ReadingRow } from "./trainingFullReading.rows";

const IN_PROGRESS = "Your reading is already being compared.";
const SEND_FIRST = "Send what you found before comparing.";
const UNAVAILABLE = "The document is no longer available to read.";

/** POST /training/me/readings/:id/compare: `{ credential_ref? }`. */
export async function compareReading(
    db: Db,
    args: { userId: string; userEmail: string | null; readingId: unknown; credentialRef?: unknown },
): Promise<ServiceResult<TrainingReading>> {
    const found = await ownReading(db, args);
    if (!found.ok) return found;
    const row = found.data;
    if (row.status === "compared") return ok(serializeReading(row));
    if (row.status === "assigned" || !row.findings) return failure("validation", SEND_FIRST);
    if (effectiveReadingStatus(row) === "comparing") return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);
    const credential = parseCredentialRef(args.credentialRef);
    if (!credential.ok) return failure("validation", credential.detail);

    // The document, under the person's own access to it, as it is now.
    let source: string | null = null;
    try {
        if (row.document_id && row.version_id) {
            const stored = await readStoredDocumentText(db, {
                userId: args.userId,
                userEmail: args.userEmail,
                documentId: row.document_id,
                versionId: row.version_id,
            });
            if (stored?.status === "ready" && isReadableDocumentText(stored.text)) source = stored.text;
        }
    } catch (error) {
        return internalFailure(error);
    }
    if (source === null) return failure("conflict", UNAVAILABLE, READING_DOCUMENT_UNAVAILABLE_CODE);

    const route = await readingRoute(db, {
        userId: args.userId,
        orgId: row.org_id,
        row,
        credentialRef: credential.value,
    });
    if (!route.ok) return route;
    const resolved = route.data;

    // Claim the reading: one comparison at a time (a stale one may be claimed again).
    const { data: claimed, error: claimError } = await db
        .from("training_readings")
        .update({ status: "comparing", ...chatRouteColumns(resolved.route), updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
    if (claimError) return internalFailure(claimError);
    if (((claimed ?? []) as unknown[]).length !== 1) return failure("conflict", IN_PROGRESS, REVIEW_IN_PROGRESS_CODE);

    const egress = (step: string) =>
        recordChatEgress(db, {
            userId: args.userId,
            orgId: row.org_id,
            chatId: null,
            projectId: row.project_id,
            surface: "training_reading",
            resolved,
            extra: { reading_id: row.id, step },
        });
    let result: { machine: NonNullable<ReturnType<typeof parseMachineFindings>>; comparison: ReturnType<typeof buildComparison> } | null =
        null;
    try {
        await egress("findings");
        const listed = await completeSupervision({
            model: resolved.route.model,
            apiKeys: resolved.apiKeys,
            systemPrompt: READING_SYSTEM_PROMPT,
            user: buildReadingPrompt(source, promptNonce()),
            maxTokens: READING_MAX_TOKENS,
        });
        const machine = parseMachineFindings(listed, source, locateQuote);
        if (!machine) throw new Error("findings without the required format");
        const items = personItems(row.findings);
        let pairs: { person: number; machine: number }[] = [];
        if (machine.findings.length > 0) {
            await egress("comparison");
            const paired = await completeSupervision({
                model: resolved.route.model,
                apiKeys: resolved.apiKeys,
                systemPrompt: READING_COMPARE_SYSTEM_PROMPT,
                user: buildComparePrompt(items, machine.findings, promptNonce()),
                maxTokens: READING_COMPARE_MAX_TOKENS,
            });
            const matches = parseMatches(paired, items.length, machine.findings.length);
            if (!matches) throw new Error("comparison without the required format");
            pairs = matches;
        }
        result = { machine, comparison: buildComparison(items, machine.findings.length, pairs, machine.discarded) };
    } catch (error) {
        // The document and the findings are the client's: log only the reading.
        console.warn("[training] reading comparison failed", {
            readingId: row.id,
            reason: error instanceof Error ? error.name : "error",
        });
    }

    const now = new Date().toISOString();
    const { data, error } = await db
        .from("training_readings")
        .update(
            result
                ? { status: "compared", machine_findings: result.machine.findings, comparison: result.comparison, updated_at: now }
                : { status: "failed", updated_at: now },
        )
        .eq("id", row.id)
        .eq("status", "comparing")
        .select("*");
    if (error) return internalFailure(error);
    const final = ((data ?? []) as unknown as ReadingRow[])[0];
    if (!final) return internalFailure(new Error("reading comparison settled elsewhere"));
    return ok(serializeReading(final));
}
