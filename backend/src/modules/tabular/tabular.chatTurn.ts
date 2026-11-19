// The tabular review chat turn, without HTTP.
//
// POST /tabular-review/:reviewId/chat used to carry the whole turn in its
// route handler. It is split in three steps, as the assistant chat's turn is
// (chat/chat.turn.ts), so the same turn can run behind any transport:
//
//   parseTabularChatRequest(body)    pure validation of the request body
//   startTabularChatTurn(db, args)   authorise and prepare (the review, its
//                                    grid, the chat row, the model policy, the
//                                    stored user turn, the prompt) and register
//                                    the server-owned run; answers a typed
//                                    result, never `res`
//   runTabularChatTurn(db, turn)     the generation loop: LLM stream, tools,
//                                    persistence, title, memory
//
// The loop writes SSE frames to a sink, never to a response. The web route's
// sink is the turn's run with a response attached (`attachAssistantTurnSse`);
// any other transport can read the run, or the persisted message, instead.

import { randomUUID } from "node:crypto";
import { finishTrainingTurn, readTrainingBody, trainingEnginePlan } from "../../lib/trainingTurn";
import { stopOutcomeFrame } from "../../lib/streamRuns";
import { startAssistantTurnRun, type AssistantTurnRun } from "../../lib/assistantTurnRuns";
import { parseCredentialRef } from "../user/user.service";
import { isReported, reportError } from "../../lib/observability/report";
import { AppError } from "../../lib/appError";
import type { Db } from "../../lib/supabase";
import {
    AssistantStreamError,
    assistantStreamErrorPayload,
    buildStoppedAssistantMessage,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    TABULAR_TOOLS,
    throwIfTurnStopped,
    type ChatMessage,
    parseOptionalModel,
    parseOptionalReasoning,
} from "../chat/chat.service";
import {
    releaseMemoryConversationTurn,
    scheduleMemoryConsolidation,
} from "../../lib/memory/schedule";
import {
    extractTabularAnnotations,
    markSavedTabularChatTurnStopped,
    prepareTabularChat,
    saveTabularChatTurn,
    titleTabularChat,
    type PreparedTabularChat,
} from "./tabular.chats";
import { checkTabularChatCitations } from "./tabular.citationSupport";
import type { TabularFailure } from "./tabular.shared";

/** A validated POST /tabular-review/:reviewId/chat body. */
export type ParsedTabularChatRequest = {
    messages: ChatMessage[];
    lastUserContent: string;
    chatId: string | undefined;
    reviewTitle: string | undefined;
    projectName: string | undefined;
    model: string | undefined;
    reasoning: string | undefined;
    credentialRef: string | null | undefined;
    /** Unvalidated request input; the preparation step validates it. */
    timeZone: unknown;
    training: ReturnType<typeof readTrainingBody>;
};

export type TabularChatRequestFailure = { ok: false; status: 400; detail: string };

/**
 * What the generation loop writes to: the turn's run (frames, stop signal),
 * or, for the one request that has no thread to key a run on, a single
 * socket.
 */
export type TabularChatTurnSink = Pick<AssistantTurnRun, "signal" | "write" | "finish"> &
    Partial<Pick<AssistantTurnRun, "id" | "touch" | "stopReason">>;

/** A turn that is authorised, prepared and (when it has a thread) registered. */
export type StartedTabularChatTurn = {
    userId: string;
    reviewId: string;
    /** Null only when chat creation was skipped: there is no thread to key a run on. */
    run: AssistantTurnRun | null;
    prepared: PreparedTabularChat;
    request: Pick<ParsedTabularChatRequest, "lastUserContent" | "reviewTitle" | "projectName">;
    assistantMessageId: string;
};

/**
 * Validates a POST /tabular-review/:reviewId/chat body, in the order the route
 * always ran its checks.
 */
export function parseTabularChatRequest(
    body: unknown,
): { ok: true; value: ParsedTabularChatRequest } | TabularChatRequestFailure {
    const record =
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
    const messages = (Array.isArray(record.messages) ? record.messages : []) as ChatMessage[];
    const parsedModel = parseOptionalModel(record.model);
    if (!parsedModel.ok) return { ok: false, status: 400, detail: parsedModel.detail };
    const parsedReasoning = parseOptionalReasoning(record.reasoning);
    if (!parsedReasoning.ok) return { ok: false, status: 400, detail: parsedReasoning.detail };
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser?.content?.trim())
        return { ok: false, status: 400, detail: "messages must include a user message" };
    const parsedCredentialRef = parseCredentialRef(record.credential_ref);
    if (!parsedCredentialRef.ok) return { ok: false, status: 400, detail: parsedCredentialRef.detail };
    return {
        ok: true,
        value: {
            messages,
            lastUserContent: lastUser.content,
            chatId: record.chat_id as string | undefined,
            reviewTitle: record.review_title as string | undefined,
            projectName: record.project_name as string | undefined,
            model: parsedModel.value,
            reasoning: parsedReasoning.value,
            credentialRef: parsedCredentialRef.value,
            timeZone: record.time_zone,
            training: readTrainingBody(record),
        },
    };
}

/** Hands the memory fence back (it lapses on its own if this fails). */
async function releaseTabularChatMemory(
    db: Db,
    chatId: string | null,
    memoryTurn: PreparedTabularChat["memoryTurn"],
) {
    if (!memoryTurn) return;
    try {
        await releaseMemoryConversationTurn({
            db,
            surface: "tabular",
            conversationId: chatId as string,
            turn: memoryTurn,
        });
    } catch (error) {
        // The lease lapses on its own; the turn is answered either way.
        // Reported as a warning, with the database's error as the cause.
        reportError(
            new AppError(
                "memory.consolidation_failed",
                "Memory activity lease could not be released",
                { cause: error },
            ),
            { level: "warning" },
        );
        console.warn("[memory] tabular activity release failed", { chatId });
    }
}

export type StartTabularChatTurnResult =
    | { ok: true; started: StartedTabularChatTurn }
    // A refused turn: the reason is the service's own (status, body or kind).
    | TabularFailure
    | { ok: false; kind: "turn_in_progress" };

/**
 * Everything a turn needs before its first frame: the review, its grid, the
 * chat record, the model policy, the persisted user turn, the prompt, and the
 * run (one per chat; a second answers `turn_in_progress`). A turn that does
 * not start releases its memory fence here; one that starts hands it to
 * `runTabularChatTurn`.
 */
export async function startTabularChatTurn(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        reviewId: string;
        parsed: ParsedTabularChatRequest;
    },
): Promise<StartTabularChatTurnResult> {
    const { userId, userEmail, reviewId, parsed } = args;
    // Everything before the first SSE byte: the review and its grid, the chat
    // record, the model policy, the persisted user turn, the prompt.
    const preparation = await prepareTabularChat(db, {
        reviewId,
        userId,
        userEmail,
        messages: parsed.messages,
        lastUserContent: parsed.lastUserContent,
        chatId: parsed.chatId,
        requestedModel: parsed.model,
        requestedCredentialRef: parsed.credentialRef,
        requestedReasoning: parsed.reasoning,
        requestedTimeZone: parsed.timeZone,
        attempt: parsed.training.attempt,
        confidence: parsed.training.confidence,
        trainingMode: parsed.training.mode,
    });
    if (!preparation.ok) return preparation;
    const prepared = preparation.data;
    const { chatId, memoryTurn } = prepared;
    const assistantMessageId = randomUUID();

    // The answer is a server-owned run from here on: it survives the caller's
    // socket (a refresh, a closed panel, a second tab taking over) and only
    // POST .../turn/:turnId/stop aborts it. A chat may have one at a time.
    const run = chatId
        ? startAssistantTurnRun({
              id: assistantMessageId,
              chatId,
              userId,
              assistantMessageId,
              surface: "tabular",
          })
        : null;
    if (chatId && !run) {
        // Refused before the first SSE byte, so the caller gets a status code
        // rather than an error frame — but the user turn is already stored,
        // so the fence this request opened has to be handed back here.
        await releaseTabularChatMemory(db, chatId, memoryTurn);
        return { ok: false, kind: "turn_in_progress" };
    }
    return {
        ok: true,
        started: {
            userId,
            reviewId,
            run,
            prepared,
            request: {
                lastUserContent: parsed.lastUserContent,
                reviewTitle: parsed.reviewTitle,
                projectName: parsed.projectName,
            },
            assistantMessageId,
        },
    };
}

/**
 * For a transport that started a turn and then could not attach to it: gives
 * back the memory fence it holds and ends its run. A turn that reaches
 * `runTabularChatTurn` never needs this.
 */
export async function abandonTabularChatTurn(db: Db, started: StartedTabularChatTurn) {
    started.run?.finish();
    await releaseTabularChatMemory(db, started.prepared.chatId, started.prepared.memoryTurn);
}

/**
 * The generation loop of a started turn. It always ends the sink (`finish`)
 * exactly once and always settles the memory fence: handed to the curator on
 * a completed answer, released otherwise.
 */
export async function runTabularChatTurn(
    db: Db,
    started: StartedTabularChatTurn,
    sink: TabularChatTurnSink | null = started.run,
): Promise<void> {
    if (!sink) throw new AppError("tabular.chat_no_sink", "[tabular/chat] a turn without a thread needs a sink");
    const { userId, assistantMessageId } = started;
    const {
        apiMessages,
        apiKeys: api_keys,
        chatId,
        chatTitle,
        inputMessageId,
        isFirstExchange,
        memorySharedAudience,
        memoryTurn,
        model: selectedChatModel,
        orgId,
        readableMemoryProjectId,
        reasoningLevel: selectedReasoningLevel,
        reviewTitle,
        sourceDocumentIds,
        tabularStore,
        titleModel,
        trainingNote,
        trainingPlan,
        trainingEgress,
        writableMemoryProjectId,
    } = started.prepared;
    const { lastUserContent, reviewTitle: clientReviewTitle, projectName: clientProjectName } = started.request;
    // The fence `prepareTabularChat` opened is released here unless this turn
    // hands it to the curator (`scheduleMemoryConsolidation`).
    let memoryTurnScheduled = false;
    const releaseMemoryFence = () => releaseTabularChatMemory(db, chatId, memoryTurn);
    const write = sink.write;

    if (chatId && sink.id) {
        write(
            `data: ${JSON.stringify({
                type: "chat_id",
                chatId,
                turnId: sink.id,
            })}\n\n`,
        );
    }

    // Whether the finished answer was stored, once it was. A stop that is seen
    // only after the save marks that row as stopped instead of inserting the
    // turn a second time.
    let assistantSaved = false;
    try {
        const { fullText, events } = await runLLMStream({
            onActivity: sink.touch,
            apiMessages,
            docStore: new Map(),
            docIndex: {},
            userId,
            db,
            write,
            extraTools: TABULAR_TOOLS,
            trainingPlan: trainingEnginePlan(trainingPlan),
            tabularStore,
            buildCitations: (text) =>
                extractTabularAnnotations(text, tabularStore),
            model: selectedChatModel,
            reasoning: selectedReasoningLevel,
            apiKeys: api_keys,
            orgId,
            signal: sink.signal,
            conversationId: chatId,
            includeMemory: true,
            memoryProjectId: readableMemoryProjectId,
            memorySharedAudience,
            emitDone: false,
        });
        // A stream that returns after the turn was stopped must not be saved
        // as a completed answer: the abort handler below stores the stop.
        throwIfTurnStopped(sink.signal, { fullText, events });

        const persistedEvents = stripTransientAssistantEvents(events);
        const annotations = extractTabularAnnotations(fullText, tabularStore);

        if (chatId) {
            const saved = await saveTabularChatTurn(db, {
                chatId,
                messageId: assistantMessageId,
                authorUserId: userId,
                memoryInputMessageId: inputMessageId,
                content: persistedEvents,
                annotations,
                sourceDocumentIds,
                touch: "when-saved",
            });
            if (saved.error)
                console.error(
                    "[tabular/chat] failed to save assistant response",
                    saved.error,
                );
            assistantSaved = saved.saved;
            // Silent citation support check: after the answer is saved, aside
            // from the turn (never awaited, never throws).
            if (assistantSaved && !persistedEvents.some((event) => event.type === "ask_inputs" || event.type === "error"))
                checkTabularChatCitations({
                    db,
                    userId,
                    orgId,
                    messageId: assistantMessageId,
                    fullText: fullText ?? "",
                    annotations,
                    store: tabularStore,
                });
            // LiTT training: the final answer is durable, so the pasante's
            // private contrast is produced now, aside from the turn, with the
            // conversation's own model and credential. It cannot fail the turn.
            finishTrainingTurn(db, {
                plan: trainingPlan,
                note: trainingNote,
                completed:
                    assistantSaved &&
                    !persistedEvents.some((event) => event.type === "error"),
                answer: fullText ?? "",
                model: selectedChatModel,
                apiKeys: api_keys,
                citations: annotations,
                turn: { userId, chatId, messageId: assistantMessageId, recordEgress: trainingEgress },
            });
        }

        // The answer is saved, but the turn may have been stopped while it
        // was being saved. A stop seen here still ends it as stopped: no
        // title, no memory consolidation, and the stored answer gets the stop
        // label.
        throwIfTurnStopped(sink.signal, { fullText, events });

        // Generate title on first exchange
        if (chatId && isFirstExchange && !chatTitle && lastUserContent) {
            const title = await titleTabularChat(db, {
                chatId,
                titleModel,
                userContent: lastUserContent,
                reviewTitle: clientReviewTitle ?? reviewTitle ?? null,
                projectName: clientProjectName ?? null,
                apiKeys: api_keys,
            });
            if (title) {
                write(
                    `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                );
            }
            // Titling is a model call of its own; a stop during it ends the
            // turn as stopped too, before it is curated.
            throwIfTurnStopped(sink.signal, { fullText, events });
        }

        // Only a durably saved, successful turn is worth consolidating: an
        // `ask_inputs` continuation is not finished, and an `error` frame is
        // not a turn at all.
        if (
            chatId &&
            assistantSaved &&
            !persistedEvents.some(
                (event) =>
                    event.type === "ask_inputs" || event.type === "error",
            )
        ) {
            const scheduled = await scheduleMemoryConsolidation({
                db,
                surface: "tabular",
                conversationId: chatId,
                actorUserId: userId,
                projectId: writableMemoryProjectId,
                turnId: assistantMessageId,
                turn: memoryTurn,
            });
            memoryTurnScheduled = scheduled != null;
        }
        write("data: [DONE]\n\n");
    } catch (err) {
        if (isAbortError(err)) {
            console.log("[tabular/chat] turn stopped", { chatId });
            if (chatId && err instanceof AssistantStreamError) {
                const partial = buildStoppedAssistantMessage({
                    stopReason: sink.stopReason,
                    fullText: err.fullText,
                    events: err.events,
                    buildCitations: (fullText) =>
                        extractTabularAnnotations(fullText, tabularStore),
                });
                // Once the finished answer is stored, only mark that row as
                // stopped; inserting it again would fail on its id.
                const { error: saveError } = assistantSaved
                    ? await markSavedTabularChatTurnStopped(db, {
                          chatId,
                          messageId: assistantMessageId,
                          content: partial.events,
                          annotations: partial.citations,
                      })
                    : await saveTabularChatTurn(db, {
                          chatId,
                          messageId: assistantMessageId,
                          authorUserId: userId,
                          memoryInputMessageId: inputMessageId,
                          content: partial.events,
                          annotations: partial.citations,
                          sourceDocumentIds,
                          touch: "always",
                      });
                if (saveError)
                    console.error(
                        "[tabular/chat] failed to save aborted stream",
                        saveError,
                    );
            }
            // Readers still attached (Stop came from another tab, or this one
            // is only watching) learn the outcome the same way a reload
            // would: persistence uses the same stop reason.
            write(stopOutcomeFrame({ stopReason: sink.stopReason ?? null }));
            write("data: [DONE]\n\n");
            return;
        }
        if (!isReported(err)) reportError(err, { tags: { operation: "tabular.chat", stage: "chat-stream" } });
        console.error("[tabular/chat] error", err);
        const errorPayload = assistantStreamErrorPayload(err);
        const message = errorPayload.message;
        const errorEvents =
            err instanceof AssistantStreamError
                ? stripTransientAssistantEvents(err.events)
                : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        if (chatId) {
            try {
                const { error: saveError } = await saveTabularChatTurn(db, {
                    chatId,
                    messageId: assistantMessageId,
                    authorUserId: userId,
                    memoryInputMessageId: inputMessageId,
                    content: errorEvents,
                    annotations: extractTabularAnnotations(
                        errorFullText,
                        tabularStore,
                    ),
                    sourceDocumentIds,
                    touch: "never",
                });
                if (saveError)
                    console.error(
                        "[tabular/chat] failed to save error",
                        saveError,
                    );
            } catch (saveErr) {
                console.error("[tabular/chat] failed to save error", saveErr);
            }
        }
        try {
            write(
                `data: ${JSON.stringify({ type: "error", ...errorPayload })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        // Ends every response attached to the run — this one, a reload, a
        // second tab — and starts its retention window, so a client
        // reconnecting a moment later still gets the last frames.
        sink.finish();
        // Whatever ended the stream, the fence must not outlive it: released
        // here unless this turn already handed it to the curator, which owns
        // it from that point on.
        if (!memoryTurnScheduled) await releaseMemoryFence();
    }
}
