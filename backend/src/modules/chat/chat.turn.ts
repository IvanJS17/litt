// The chat turn, without HTTP.
//
// POST /chat used to carry the whole turn in its route handler. It is split
// in three steps so the same turn can run behind any transport:
//
//   parseChatTurnRequest(body)       pure validation of the request body
//   startChatTurn(db, args)          authorise and prepare, register the
//                                    server-owned run, reserve the assistant
//                                    row; answers a typed result, never `res`
//   runChatTurn(db, started, sink)   the generation loop: LLM stream, tools,
//                                    persistence, title, memory, audit
//
// The loop writes SSE frames to a `ChatTurnSink`, never to a response. The
// web route's sink is the turn's run with a response attached
// (`attachAssistantTurnSse`), so the bytes a browser receives are exactly the
// frames written here. Any other transport can call the same functions and
// read the run, or the persisted message, instead of an HTTP stream.
//
// Ordering is deliberate and pinned by the golden recordings in
// `src/__tests__/integration/chatTurn.golden.routes.test.ts`: the user
// message and the assistant reservation are durable before the first frame,
// and the answer is saved before `[DONE]`.

import { randomUUID } from "node:crypto";
import { BACKEND_REPORTING_OWNER } from "../../lib/reportedUpstreamCodes";
import { abortable } from "../../lib/abortable";
import {
    startAssistantTurnRun,
    type AssistantTurnRun,
} from "../../lib/assistantTurnRuns";
import { StreamRunLimitError, stopOutcomeFrame } from "../../lib/streamRuns";
import { createCitationSupportTurn } from "../../lib/citationSupport";
import { enqueueChatTurnAudit, stoppedTurnAuditStatus } from "../../lib/audit";
import {
    appendAssistantEventsToMessage,
    AssistantStreamError,
    assistantStreamErrorPayload,
    buildStoppedAssistantEvent,
    buildStoppedAssistantMessage,
    extractCitations,
    isAbortError,
    isMeaningfulTextlessAssistantOutput,
    runLLMStream,
    stripTransientAssistantEvents,
    type ToolCapability,
    throwIfTurnStopped,
    writeApprovedConnectorFrames,
    parseChatMessages,
    parseOptionalAskInputsResponse,
    parseOptionalChatId,
    parseOptionalModel,
    parseOptionalReasoning,
    parseOptionalProjectId,
    createReservedAssistantMessageUpdater,
    createSubagentRunStore,
    logAssistantMessageFailure,
    reserveAssistantMessage,
} from "./engine/index";
import { devLog } from "./engine/types";
import { isReported, reportError } from "../../lib/observability/report";
import {
    finishTrainingTurn,
    readTrainingBody,
    trainingEnginePlan,
} from "../../lib/trainingTurn";
import { generateAssistantChatTitle, logChatTitleFailure } from "./chat.title";
import { titleModelForChat } from "../../lib/modelSelection";
import { LEGAL_VERSION, parseCredentialRef } from "../user/user.service";
import {
    releaseMemoryConversationTurn,
    scheduleMemoryConsolidation,
} from "../../lib/memory/schedule";
import type { Db } from "../../lib/supabase";
import { discardRejectedChatInput } from "./chat.crud";
import { prepareChatStream, type PreparedChatStream } from "./chat.prepare";
import type { ChatOrigin } from "./chat.origin";
import { updateChatTitle } from "./chat.titles";


/** A validated POST /chat body. */
export type ParsedChatTurnRequest = {
    messages: NonNullable<
        Extract<ReturnType<typeof parseChatMessages>, { ok: true }>["value"]
    >;
    chatId: string | null;
    project: { provided: boolean; projectId: string | null };
    model: string | null | undefined;
    reasoning: Extract<
        ReturnType<typeof parseOptionalReasoning>,
        { ok: true }
    >["value"];
    credentialRef: string | null | undefined;
    askInputsResponse: Extract<
        ReturnType<typeof parseOptionalAskInputsResponse>,
        { ok: true }
    >["value"];
    /** Unvalidated request input; the preparation step validates it. */
    timeZone: unknown;
    orgId: unknown;
    training: ReturnType<typeof readTrainingBody>;
};

export type ChatTurnRequestFailure = { ok: false; status: 400; detail: string };

/**
 * What the generation loop writes to: the turn's run, which owns the frame
 * buffer and the stop signal. A transport attaches to the run (an HTTP
 * response gets its frames through `attachAssistantTurnSse`) or reads it.
 */
export type ChatTurnSink = Pick<
    AssistantTurnRun,
    "id" | "signal" | "write" | "finish" | "touch" | "stopReason"
>;

/** A turn that is authorised, prepared, registered and reserved. */
export type StartedChatTurn = {
    userId: string;
    userEmail: string | undefined;
    requestId: string | undefined;
    /** The server-owned run; the default sink of `runChatTurn`. */
    run: AssistantTurnRun;
    prepared: PreparedChatStream;
    askInputsResponse: ParsedChatTurnRequest["askInputsResponse"];
    /** Null on an ask_inputs continuation, which reuses an earlier row. */
    assistantMessageId: string | null;
    inputMessageId: string | null;
    /** The assistant row the answer lands in. */
    turnMessageId: string;
    subagentRuns: ReturnType<typeof createSubagentRunStore>;
    /** The tool capabilities of a turn a connected app started; absent: all. */
    allowedCapabilities?: readonly ToolCapability[];
};

export type StartChatTurnFailure =
    | { ok: false; status: number; code?: string; detail: string }
    // The raw error, for the transport to map (the web route hands it to
    // sendInternalError, which keeps the request id and the correlation log).
    | { ok: false; internal: true; error: unknown };

/**
 * Validates a POST /chat body. The checks run in the order the route always
 * ran them, so a body with several problems reports the same one.
 */
export function parseChatTurnRequest(
    body: unknown,
): { ok: true; value: ParsedChatTurnRequest } | ChatTurnRequestFailure {
    const record =
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
    const parsedMessages = parseChatMessages(record.messages);
    if (!parsedMessages.ok) {
        return { ok: false, status: 400, detail: parsedMessages.detail };
    }
    const parsedChatId = parseOptionalChatId(record.chat_id);
    if (!parsedChatId.ok) {
        return { ok: false, status: 400, detail: parsedChatId.detail };
    }
    const parsedProjectId = parseOptionalProjectId(record.project_id);
    if (!parsedProjectId.ok) {
        return { ok: false, status: 400, detail: parsedProjectId.detail };
    }
    const parsedModel = parseOptionalModel(record.model);
    if (!parsedModel.ok) {
        return { ok: false, status: 400, detail: parsedModel.detail };
    }
    const parsedReasoning = parseOptionalReasoning(record.reasoning);
    if (!parsedReasoning.ok) {
        return { ok: false, status: 400, detail: parsedReasoning.detail };
    }
    const parsedCredentialRef = parseCredentialRef(record.credential_ref);
    if (!parsedCredentialRef.ok) {
        return { ok: false, status: 400, detail: parsedCredentialRef.detail };
    }
    const parsedAskInputsResponse = parseOptionalAskInputsResponse(
        record.ask_inputs_response,
    );
    if (!parsedAskInputsResponse.ok) {
        return { ok: false, status: 400, detail: parsedAskInputsResponse.detail };
    }
    return {
        ok: true,
        value: {
            messages: parsedMessages.value,
            chatId: parsedChatId.value,
            project: parsedProjectId.value,
            model: parsedModel.value,
            reasoning: parsedReasoning.value,
            credentialRef: parsedCredentialRef.value,
            askInputsResponse: parsedAskInputsResponse.value,
            timeZone: record.time_zone,
            orgId: record.org_id,
            training: readTrainingBody(record),
        },
    };
}

/** Lets the memory layer know the turn's activity lease is no longer needed. */
async function releaseChatTurnMemory(
    db: Db,
    chatId: string,
    memoryTurn: PreparedChatStream["memoryTurn"],
) {
    if (!memoryTurn) return;
    try {
        await releaseMemoryConversationTurn({
            db,
            surface: "chat",
            conversationId: chatId,
            turn: memoryTurn,
        });
    } catch {
        console.warn("[memory] chat activity release failed", { chatId });
    }
}

/**
 * Everything a turn needs before its first frame: authorisation and
 * preparation, the run (one per chat; a second answers `turn_in_progress`
 * 409), and the durable assistant row. A turn that does not start releases
 * its memory lease here; one that starts hands it to `runChatTurn`.
 */
export async function startChatTurn(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        requestId: string | undefined;
        parsed: ParsedChatTurnRequest;
        /** The connected app a NEW chat is started from; the web passes none. */
        origin?: ChatOrigin;
        /** The tools this turn may use when a connected app starts it; the web passes none. */
        allowedCapabilities?: readonly ToolCapability[];
    },
): Promise<{ ok: true; started: StartedChatTurn } | StartChatTurnFailure> {
    const { userId, userEmail, requestId, parsed } = args;
    const { messages, askInputsResponse } = parsed;
    const chat_id = parsed.chatId;
    // Reserve a stable assistant identity before streaming. This lets clients
    // associate streamed UI with the same durable message after a reload.
    const assistantMessageId = askInputsResponse ? null : randomUUID();
    const turnMessageId =
        assistantMessageId ?? askInputsResponse?.assistant_message_id ?? "";
    const inputMessageId = askInputsResponse ? null : randomUUID();

    devLog("[chat/stream] incoming request", {
        userId,
        chat_id,
        project_id: parsed.project.projectId,
        model: parsed.model,
        messageCount: messages?.length,
    });

    const prep = await prepareChatStream(db, {
        userId,
        userEmail,
        messages,
        chatId: chat_id ?? null,
        inputMessageId,
        projectIdProvided: parsed.project.provided,
        projectId: parsed.project.projectId,
        askInputsResponse,
        requestedModel: parsed.model,
        requestedCredentialRef: parsed.credentialRef,
        requestedReasoning: parsed.reasoning,
        requestedTimeZone: parsed.timeZone,
        requestedOrgId: parsed.orgId,
        attempt: parsed.training.attempt,
        confidence: parsed.training.confidence,
        trainingMode: parsed.training.mode,
        trainingCriteria: {
            routes: parsed.training.criteriaRoutes,
            explanation: parsed.training.criteriaExplanation,
        },
        ...(args.origin ? { origin: args.origin } : {}),
    });
    if (!prep.ok) {
        if ("internal" in prep) {
            return { ok: false, internal: true, error: prep.error };
        }
        return {
            ok: false,
            status: prep.status,
            ...(prep.code ? { code: prep.code } : {}),
            detail: prep.detail,
        };
    }

    const { prepared } = prep;
    const { chatId, memoryTurn } = prepared;
    const subagentRuns = createSubagentRunStore({
        db,
        userId,
        userEmail,
        chatId,
        messageId: turnMessageId,
    });

    devLog("[chat/stream] starting LLM stream", {
        apiMessageCount: prepared.apiMessages.length,
        docCount: Object.keys(prepared.docIndex).length,
        workflowCount: Object.keys(prepared.workflowStore).length,
    });

    let started = false;
    try {
        // The generation is a server-owned run from here on: it survives the
        // caller's socket (a refresh, a closed tab) and only the Stop
        // endpoint aborts it. One run per chat at a time.
        let run: ReturnType<typeof startAssistantTurnRun> = null;
        let refusal: StreamRunLimitError | null = null;
        try {
            run = startAssistantTurnRun({
                id: assistantMessageId ?? randomUUID(),
                chatId,
                userId,
                assistantMessageId: turnMessageId,
            });
        } catch (error) {
            if (!(error instanceof StreamRunLimitError)) throw error;
            refusal = error;
        }
        if (!run) {
            if (inputMessageId) {
                const discarded = await discardRejectedChatInput(db, {
                    chatId,
                    inputMessageId,
                    userId,
                });
                if (!discarded.ok) {
                    return { ok: false, internal: true, error: discarded.error };
                }
            }
            if (refusal) {
                return { ok: false, status: refusal.status, code: refusal.code, detail: refusal.message };
            }
            return {
                ok: false,
                status: 409,
                code: "turn_in_progress",
                detail: "A response is already being generated for this chat.",
            };
        }
        // Make the advertised identity durable before anything is streamed.
        // If this reservation fails, the caller can still answer a normal
        // error; clients must never receive an ID that cannot subsequently
        // be loaded from chat history.
        if (assistantMessageId) {
            const reserveError = await reserveAssistantMessage({
                db,
                table: "chat_messages",
                id: assistantMessageId,
                chatId,
                inputMessageId: inputMessageId as string,
                authorUserId: userId,
            });
            if (reserveError) {
                logAssistantMessageFailure({
                    kind: "chat.message_reserve_failed",
                    label: "[chat/stream] failed to reserve assistant message",
                    cause: reserveError,
                    component: "chat-stream",
                });
                run.finish();
                return {
                    ok: false,
                    status: 500,
                    detail: "Failed to start assistant response",
                };
            }
        }
        started = true;
        return {
            ok: true,
            started: {
                userId,
                userEmail,
                requestId,
                run,
                prepared,
                askInputsResponse,
                assistantMessageId,
                inputMessageId,
                turnMessageId,
                subagentRuns,
                ...(args.allowedCapabilities ? { allowedCapabilities: args.allowedCapabilities } : {}),
            },
        };
    } finally {
        // Every way out of here that is not a started turn releases the
        // lease the preparation took; a started turn releases it in
        // runChatTurn (or abandonChatTurn).
        if (!started) await releaseChatTurnMemory(db, chatId, memoryTurn);
    }
}

/**
 * For a transport that started a turn and then could not attach to it: gives
 * back the memory lease the turn holds. A turn that reaches `runChatTurn`
 * never needs this.
 */
export async function abandonChatTurn(db: Db, started: StartedChatTurn) {
    await releaseChatTurnMemory(
        db,
        started.prepared.chatId,
        started.prepared.memoryTurn,
    );
}

/**
 * The generation loop of a started turn. It always ends the sink (`finish`)
 * exactly once and always settles the memory lease: scheduled for
 * consolidation on a completed answer, released otherwise.
 */
export async function runChatTurn(
    db: Db,
    started: StartedChatTurn,
    sink: ChatTurnSink = started.run,
): Promise<void> {
    const {
        userId,
        userEmail,
        requestId,
        askInputsResponse,
        assistantMessageId,
        turnMessageId,
        subagentRuns,
    } = started;
    const {
        chatId,
        lastUser,
        resolvedProjectId,
        allowDocumentMutation,
        canReadProjectMemory,
        canCurateProjectMemory,
        memorySharedAudience,
        memoryTurn,
        docIndex,
        docStore,
        apiMessages,
        workflowStore,
        webSearch,
        webSearchAccount,
        apiKeys,
        orgId,
        titleModel,
        subagentRoutes,
        selectedModel,
        selectedReasoningLevel,
        nonce,
        approvalEvents,
        trainingNote,
        trainingPlan,
        trainingEgress,
    } = started.prepared;
    let chatTitle = started.prepared.chatTitle;
    let completedTurnPersisted = started.prepared.completedTurnPersisted;
    let memoryTurnScheduled = false;

    try {
        const write = sink.write;
        const updateReservedAssistantMessage =
            createReservedAssistantMessageUpdater({
                db,
                table: "chat_messages",
                id: assistantMessageId ?? "",
                chatId,
                enabled: !!assistantMessageId,
            });

        let titlePromise: Promise<void> = Promise.resolve();
        // A holder, not a `let`: it is assigned inside the title promise's
        // catch, which TypeScript's flow analysis cannot see.
        const titleOutcome: { failure: { error: unknown } | null } = { failure: null };
        // Where the finished answer was saved, once it was. A stop that is seen
        // only after the save marks that answer as stopped instead of saving it
        // a second time.
        let savedAnswerMessageId: string | null = null;
        try {
            write(
                `data: ${JSON.stringify({
                    type: "chat_id",
                    chatId,
                    turnId: sink.id,
                    ...(assistantMessageId ? { assistantMessageId } : {}),
                })}\n\n`,
            );
            writeApprovedConnectorFrames(write, approvalEvents);

            const shouldGenerateTitle =
                !chatTitle && !!lastUser?.content && !askInputsResponse;
            const titleMessage = lastUser
                ? [
                      lastUser.content,
                      lastUser.workflow
                          ? `Workflow: ${lastUser.workflow.title}`
                          : "",
                      lastUser.playbook
                          ? `Playbook: ${lastUser.playbook.title}`
                          : "",
                      lastUser.files?.length
                          ? `Files: ${lastUser.files.map((file) => file.filename).join(", ")}`
                          : "",
                  ]
                      .filter(Boolean)
                      .join("\n")
                : "";
            titlePromise = shouldGenerateTitle
                ? generateAssistantChatTitle({
                      abortSignal: sink.signal,
                      model: titleModelForChat(selectedModel, titleModel),
                      message: titleMessage,
                      apiKeys,
                      conversationId: chatId,
                  })
                      .then(async (title) => {
                          if (sink.signal.aborted) return;
                          const saved = await updateChatTitle(db, {
                              chatId,
                              title,
                          });
                          if (!saved.ok) throw saved.error;
                          chatTitle = title;
                          if (!sink.signal.aborted) {
                              write(
                                  `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                              );
                          }
                      })
                      .catch((error) => {
                          // Decided once the reply has settled: see the
                          // logChatTitleFailure calls below.
                          if (!sink.signal.aborted) titleOutcome.failure = { error };
                      })
                : Promise.resolve();

            // Silent citation support check: null unless the server switch and
            // the platform key are on and the person has not opted out. It reads the verified citations and runs after
            // the answer is saved; it never touches what the lawyer sees.
            const citationSupport = await createCitationSupportTurn({
                db,
                userId,
                orgId,
                surface: "chat",
                legalVersion: LEGAL_VERSION,
            });
            const { fullText, events, citations } = await runLLMStream({
                onCitationSupportInputs: citationSupport?.collect,
                onActivity: sink.touch,
                apiMessages,
                docStore,
                docIndex,
                userId,
                userEmail,
                db,
                write,
                allowDocumentMutation,
                allowedCapabilities: started.allowedCapabilities,
                trainingPlan: trainingEnginePlan(trainingPlan),
                workflowStore,
                webSearch,
                webSearchAccount,
                subagentRuns,
                subagentRoutes,
                model: selectedModel,
                reasoning: selectedReasoningLevel,
                apiKeys,
                orgId,
                signal: sink.signal,
                projectId: resolvedProjectId,
                conversationId: chatId,
                includeMemory: true,
                connectorApprovals: true,
                memoryProjectId: canReadProjectMemory
                    ? resolvedProjectId
                    : null,
                memorySharedAudience,
                nonce,
                // This route first makes the advertised assistant ID durable.
                // It emits [DONE] only after the reserved row has been
                // populated.
                emitDone: false,
            });
            throwIfTurnStopped(sink.signal, { fullText, events });

            devLog("[chat/stream] LLM stream finished", {
                fullTextLen: fullText?.length ?? 0,
                eventCount: events?.length ?? 0,
            });

            // Upstream providers occasionally end the stream cleanly but empty
            // (observed via OpenRouter). Silence reads as a hung composer, so
            // surface it — unless tools produced visible artifacts, which carry
            // their own completion signal.
            const hasToolOutput =
                approvalEvents.length > 0 ||
                events?.some(isMeaningfulTextlessAssistantOutput);
            if (!fullText?.trim() && !hasToolOutput) {
                write(
                    `data: ${JSON.stringify({
                        type: "error",
                        message:
                            "The model returned an empty response. Try again, or pick a different model.",
                        safe_to_display: true,
                        ...(requestId ? { request_id: requestId } : {}),
                    })}\n\n`,
                );
                write("data: [DONE]\n\n");
                return;
            }

            const persistedEvents = stripTransientAssistantEvents(events);
            if (askInputsResponse) {
                const appended = await appendAssistantEventsToMessage(
                    db,
                    chatId,
                    askInputsResponse.assistant_message_id,
                    userId,
                    persistedEvents,
                    citations,
                );
                completedTurnPersisted = appended;
                if (appended) {
                    savedAnswerMessageId = askInputsResponse.assistant_message_id;
                }
            } else {
                const saveError = await updateReservedAssistantMessage(
                    persistedEvents.length ? persistedEvents : null,
                    citations.length ? citations : null,
                );
                if (saveError) {
                    logAssistantMessageFailure({
                        kind: "chat.message_save_failed",
                        label: "[chat/stream] failed to save assistant response",
                        cause: saveError,
                        component: "chat-stream",
                    });
                    // A turn stopped while the save was pending ends as stopped,
                    // not as a save failure (the stop path saves it again).
                    throwIfTurnStopped(sink.signal, { fullText, events });
                    write(
                        `data: ${JSON.stringify({
                            type: "error",
                            message:
                                "The response was generated but could not be saved.",
                            reporting_owner: BACKEND_REPORTING_OWNER,
                            ...(requestId ? { request_id: requestId } : {}),
                        })}\n\n`,
                    );
                    write("data: [DONE]\n\n");
                    return;
                }
                savedAnswerMessageId = assistantMessageId;
            }
            await subagentRuns.flush();

            await abortable(titlePromise, sink.signal).catch(() => {});
            if (titleOutcome.failure) {
                logChatTitleFailure(
                    "[chat/stream] failed to generate chat title",
                    titleOutcome.failure.error,
                    null,
                );
            }

            // The answer is saved, but the turn may have been stopped while it was
            // being saved (or while the title was awaited). A stop seen here
            // still ends it as stopped: no fallback title, no memory
            // consolidation, and the stored answer gets the stop label.
            throwIfTurnStopped(sink.signal, { fullText, events });

            if (!chatTitle && lastUser?.content) {
                const title = lastUser.content.slice(0, 120);
                // The SSE response is already streaming, so a failure here
                // cannot become an HTTP error — but it must not be announced
                // either: an ignored error pushed a chat_title frame the
                // client rendered and the next reload undid. Log it and leave
                // the chat untitled.
                const saved = await updateChatTitle(db, { chatId, title });
                if (!saved.ok) {
                    logAssistantMessageFailure({
                        kind: "chat.title_failed",
                        label: "[chat/stream] failed to save chat title",
                        cause: saved.error,
                        component: "chat-stream",
                    });
                } else {
                    chatTitle = title;
                    if (shouldGenerateTitle && !sink.signal.aborted) {
                        write(
                            `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                        );
                    }
                }
            }

            // ask_inputs is an intentional pause, not a completed conversation.
            // A continuation reuses the preceding assistant row, so resolve that
            // durable identity only when there is no newly reserved message id.
            if (
                completedTurnPersisted &&
                !persistedEvents.some(
                    (event) =>
                        event.type === "ask_inputs" || event.type === "error",
                )
            ) {
                const completedTurnId =
                    assistantMessageId ??
                    askInputsResponse?.assistant_message_id ??
                    null;
                if (completedTurnId) {
                    const scheduled = await scheduleMemoryConsolidation({
                        db,
                        surface: "chat",
                        conversationId: chatId,
                        actorUserId: userId,
                        projectId: canCurateProjectMemory
                            ? resolvedProjectId
                            : null,
                        turnId: completedTurnId,
                        turn: memoryTurn,
                    });
                    memoryTurnScheduled = scheduled != null;
                }
            }
            // LiTT training: the final answer is durable, so the pasante's
            // private contrast is produced now, aside from the turn, with the
            // conversation's own model and credential. It cannot fail the turn.
            finishTrainingTurn(db, {
                plan: trainingPlan,
                note: trainingNote,
                completed: !persistedEvents.some((event) => event.type === "error"),
                answer: fullText ?? "",
                model: selectedModel,
                apiKeys,
                citations,
                turn: { userId, chatId, messageId: turnMessageId || null, recordEgress: trainingEgress },
            });

            void citationSupport?.finish(
                turnMessageId || null,
                !!completedTurnPersisted &&
                    !persistedEvents.some(
                        (event) =>
                            event.type === "ask_inputs" || event.type === "error",
                    ),
            );

            void enqueueChatTurnAudit(
                db,
                {
                    userId,
                    orgId,
                    userEmail,
                    chatId,
                    projectId: resolvedProjectId,
                    title:
                        chatTitle ?? lastUser?.content?.slice(0, 120) ?? null,
                    model: selectedModel,
                },
                persistedEvents,
            );
            write("data: [DONE]\n\n");
        } catch (err) {
            // The title ran in parallel with the reply; only now is it known
            // whether its failure is the reply's failure seen twice.
            await abortable(titlePromise, sink.signal).catch(() => {});
            if (titleOutcome.failure) {
                logChatTitleFailure(
                    "[chat/stream] failed to generate chat title",
                    titleOutcome.failure.error,
                    isAbortError(err) ? null : err,
                );
            }
            if (isAbortError(err)) {
                devLog("[chat/stream] turn stopped", { chatId });
                // The events the turn finished before it stopped: a document
                // it edited or created has a new version even though the turn
                // did not complete, so its audit row is written all the same.
                void enqueueChatTurnAudit(
                    db,
                    {
                        userId,
                        orgId,
                        userEmail,
                        chatId,
                        projectId: resolvedProjectId,
                        title: chatTitle,
                        model: selectedModel,
                        status: stoppedTurnAuditStatus(sink.stopReason),
                    },
                    err instanceof AssistantStreamError ? err.events : null,
                );
                if (err instanceof AssistantStreamError) {
                    const partial = savedAnswerMessageId
                        ? {
                              events: [buildStoppedAssistantEvent(sink.stopReason)],
                              citations: [],
                          }
                        : buildStoppedAssistantMessage({
                              stopReason: sink.stopReason,
                              fullText: err.fullText,
                              events: err.events,
                              buildCitations: (fullText) =>
                                  extractCitations(fullText, docIndex),
                          });
                    let saveError: unknown | null = null;
                    if (savedAnswerMessageId) {
                        // The finished answer is already stored: add only what
                        // marks it as stopped (the label after its events).
                        await appendAssistantEventsToMessage(
                            db,
                            chatId,
                            savedAnswerMessageId,
                            userId,
                            partial.events,
                            [],
                        );
                    } else if (askInputsResponse) {
                        await appendAssistantEventsToMessage(
                            db,
                            chatId,
                            askInputsResponse.assistant_message_id,
                            userId,
                            partial.events,
                            partial.citations,
                        );
                    } else {
                        saveError = await updateReservedAssistantMessage(
                            partial.events.length ? partial.events : null,
                            partial.citations.length ? partial.citations : null,
                        );
                    }
                    if (saveError) {
                        logAssistantMessageFailure({
                            kind: "chat.message_save_failed",
                            label: "[chat/stream] failed to save aborted stream",
                            cause: saveError,
                            component: "chat-stream",
                        });
                    } else {
                        await subagentRuns.flush();
                    }
                }
                // Readers still attached (Stop came from another tab, or
                // this one is watching) learn the outcome the same way a
                // reload would: persistence uses the same stop reason.
                write(stopOutcomeFrame(sink));
                write("data: [DONE]\n\n");
                return;
            }
            if (!isReported(err)) {
                reportError(err, { tags: { operation: "chat.turn", stage: "chat-stream" } });
            }
            console.error("[chat/stream] error:", err);
            const errorPayload = assistantStreamErrorPayload(err, requestId);
            const message = errorPayload.message;
            const errorEvents =
                err instanceof AssistantStreamError
                    ? stripTransientAssistantEvents(err.events)
                    : [{ type: "error" as const, message }];
            const errorFullText =
                err instanceof AssistantStreamError ? err.fullText : "";
            try {
                const citations = extractCitations(errorFullText, docIndex);
                const saveError = askInputsResponse
                    ? null
                    : await updateReservedAssistantMessage(
                          errorEvents.length ? errorEvents : null,
                          citations.length ? citations : null,
                      );
                if (askInputsResponse) {
                    await appendAssistantEventsToMessage(
                        db,
                        chatId,
                        askInputsResponse.assistant_message_id,
                        userId,
                        errorEvents,
                        citations,
                    );
                }
                if (saveError)
                    logAssistantMessageFailure({
                        kind: "chat.message_save_failed",
                        label: "[chat/stream] failed to save error",
                        cause: saveError,
                        component: "chat-stream",
                    });
                else await subagentRuns.flush();
            } catch (saveErr) {
                logAssistantMessageFailure({
                    kind: "chat.message_save_failed",
                    label: "[chat/stream] failed to save error",
                    cause: saveErr,
                    component: "chat-stream",
                });
            }
            try {
                write(
                    `data: ${JSON.stringify({
                        type: "error",
                        ...errorPayload,
                    })}\n\n`,
                );
                write("data: [DONE]\n\n");
            } catch {
                /* ignore */
            }
        } finally {
            sink.finish();
        }
    } finally {
        if (!memoryTurnScheduled) {
            await releaseChatTurnMemory(db, chatId, memoryTurn);
        }
    }
}
