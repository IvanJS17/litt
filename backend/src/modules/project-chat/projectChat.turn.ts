// The project chat turn, without HTTP.
//
// POST /projects/:projectId/chat used to carry the whole turn in its route
// handler. It is split in three steps, as the assistant chat's turn is
// (chat/chat.turn.ts), so the same turn can run behind any transport:
//
//   parseProjectChatRequest(body)   pure validation of the request body
//   startProjectChatTurn(db, args)  authorise and prepare, register the
//                                   server-owned run; answers a typed result,
//                                   never `res`
//   runProjectChatTurn(db, turn)    the generation loop: LLM stream, tools,
//                                   persistence, title, memory, audit
//
// The loop writes SSE frames to a sink, never to a response. The web route's
// sink is the turn's run with a response attached (`attachAssistantTurnSse`);
// any other transport can read the run, or the persisted message, instead.
// Ordering is the route's own and is pinned by the golden recording in
// `src/__tests__/integration/projectChatTurn.golden.routes.test.ts`.

import { randomUUID } from "node:crypto";
import { BACKEND_REPORTING_OWNER } from "../../lib/reportedUpstreamCodes";
import { abortable } from "../../lib/abortable";
import {
    finishTrainingTurn,
    readTrainingBody,
    trainingEnginePlan,
} from "../../lib/trainingTurn";
import {
    startAssistantTurnRun,
    type AssistantTurnRun,
} from "../../lib/assistantTurnRuns";
import { StreamRunLimitError, stopOutcomeFrame } from "../../lib/streamRuns";
import { createCitationSupportTurn } from "../../lib/citationSupport";
import { enqueueChatTurnAudit, stoppedTurnAuditStatus } from "../../lib/audit";
import { isReported, reportError } from "../../lib/observability/report";
import {
    appendAssistantEventsToMessage,
    AssistantStreamError,
    assistantStreamErrorPayload,
    buildStoppedAssistantEvent,
    buildStoppedAssistantMessage,
    createSubagentRunStore,
    extractCitations,
    isAbortError,
    logAssistantMessageFailure,
    runLLMStream,
    stripTransientAssistantEvents,
    throwIfTurnStopped,
    writeApprovedConnectorFrames,
    type ToolCapability,
    PROJECT_EXTRA_TOOLS,
    parseChatMessages,
    parseOptionalAskInputsResponse,
    parseOptionalAttachedDocuments,
    parseOptionalChatId,
    parseOptionalDisplayedDoc,
    parseOptionalModel,
    parseOptionalReasoning,
    generateAssistantChatTitle,
    logChatTitleFailure,
} from "../chat/chat.service";
import type { ChatOrigin } from "../chat/chat.service";
import { titleModelForChat } from "../../lib/modelSelection";
import { LEGAL_VERSION, parseCredentialRef } from "../user/user.service";
import {
    releaseMemoryConversationTurn,
    scheduleMemoryConsolidation,
} from "../../lib/memory/schedule";
import type { Db } from "../../lib/supabase";
import {
    insertAssistantMessage,
    prepareProjectChatStream,
    updateChatTitle,
    type PreparedProjectChatStream,
} from "./projectChat.prepare";

/** A validated POST /projects/:projectId/chat body. */
export type ParsedProjectChatRequest = {
    messages: NonNullable<Extract<ReturnType<typeof parseChatMessages>, { ok: true }>["value"]>;
    chatId: string | null | undefined;
    model: string | null | undefined;
    reasoning: Extract<ReturnType<typeof parseOptionalReasoning>, { ok: true }>["value"];
    displayedDoc: Extract<ReturnType<typeof parseOptionalDisplayedDoc>, { ok: true }>["value"];
    attachedDocuments: Extract<ReturnType<typeof parseOptionalAttachedDocuments>, { ok: true }>["value"];
    askInputsResponse: Extract<ReturnType<typeof parseOptionalAskInputsResponse>, { ok: true }>["value"];
    credentialRef: string | null | undefined;
    /** Unvalidated request input; the preparation step validates it. */
    timeZone: unknown;
    training: ReturnType<typeof readTrainingBody>;
};

export type ProjectChatRequestFailure = { ok: false; status: 400; detail: string };

/** What the generation loop writes to: the turn's run (frames and the stop signal). */
export type ProjectChatTurnSink = Pick<
    AssistantTurnRun,
    "id" | "signal" | "write" | "finish" | "touch" | "stopReason"
>;

/** A turn that is authorised, prepared and registered. */
export type StartedProjectChatTurn = {
    userId: string;
    userEmail: string | undefined;
    requestId: string | undefined;
    projectId: string;
    /** The server-owned run; the default sink of `runProjectChatTurn`. */
    run: AssistantTurnRun;
    prepared: PreparedProjectChatStream;
    askInputsResponse: ParsedProjectChatRequest["askInputsResponse"];
    /** Null on an ask_inputs continuation, which reuses an earlier row. */
    assistantMessageId: string | null;
    inputMessageId: string | null;
    /** The assistant row the answer lands in. */
    turnMessageId: string;
    subagentRuns: ReturnType<typeof createSubagentRunStore>;
    /** The tool capabilities of a turn a connected app started; absent: all. */
    allowedCapabilities?: readonly ToolCapability[];
};

export type StartProjectChatTurnFailure =
    | { ok: false; status: number; code?: string; detail: string }
    // The raw error, for the transport to map (the web route hands it to
    // sendInternalError, which keeps the request id and the correlation log).
    | { ok: false; internal: true; error: unknown };

/**
 * Validates a POST /projects/:projectId/chat body. The checks run in the order
 * the route always ran them, so a body with several problems reports the same one.
 */
export function parseProjectChatRequest(
    body: unknown,
): { ok: true; value: ParsedProjectChatRequest } | ProjectChatRequestFailure {
    const record =
        body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
    const parsedMessages = parseChatMessages(record.messages);
    if (!parsedMessages.ok) return { ok: false, status: 400, detail: parsedMessages.detail };
    const parsedChatId = parseOptionalChatId(record.chat_id);
    if (!parsedChatId.ok) return { ok: false, status: 400, detail: parsedChatId.detail };
    const parsedModel = parseOptionalModel(record.model);
    if (!parsedModel.ok) return { ok: false, status: 400, detail: parsedModel.detail };
    const parsedReasoning = parseOptionalReasoning(record.reasoning);
    if (!parsedReasoning.ok) return { ok: false, status: 400, detail: parsedReasoning.detail };
    const parsedDisplayedDoc = parseOptionalDisplayedDoc(record.displayed_doc);
    if (!parsedDisplayedDoc.ok) return { ok: false, status: 400, detail: parsedDisplayedDoc.detail };
    const parsedAttachedDocuments = parseOptionalAttachedDocuments(record.attached_documents);
    if (!parsedAttachedDocuments.ok) return { ok: false, status: 400, detail: parsedAttachedDocuments.detail };
    const parsedAskInputsResponse = parseOptionalAskInputsResponse(record.ask_inputs_response);
    if (!parsedAskInputsResponse.ok) return { ok: false, status: 400, detail: parsedAskInputsResponse.detail };
    const parsedCredentialRef = parseCredentialRef(record.credential_ref);
    if (!parsedCredentialRef.ok) return { ok: false, status: 400, detail: parsedCredentialRef.detail };
    return {
        ok: true,
        value: {
            messages: parsedMessages.value,
            chatId: parsedChatId.value,
            model: parsedModel.value,
            reasoning: parsedReasoning.value,
            displayedDoc: parsedDisplayedDoc.value,
            attachedDocuments: parsedAttachedDocuments.value,
            askInputsResponse: parsedAskInputsResponse.value,
            credentialRef: parsedCredentialRef.value,
            timeZone: record.time_zone,
            training: readTrainingBody(record),
        },
    };
}

/** Lets the memory layer know the turn's activity lease is no longer needed. */
async function releaseProjectChatMemory(
    db: Db,
    chatId: string,
    memoryTurn: PreparedProjectChatStream["memoryTurn"],
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
        console.warn("[memory] project chat activity release failed", { chatId });
    }
}

/**
 * Everything a turn needs before its first frame: authorisation and
 * preparation, and the run (one per chat; a second answers `turn_in_progress`
 * 409). A turn that does not start releases its memory lease here; one that
 * starts hands it to `runProjectChatTurn`.
 */
export async function startProjectChatTurn(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        requestId: string | undefined;
        projectId: string;
        parsed: ParsedProjectChatRequest;
        /** The connected app a NEW chat is started from; the web passes none. */
        origin?: ChatOrigin;
        /** The tools this turn may use when a connected app starts it; the web passes none. */
        allowedCapabilities?: readonly ToolCapability[];
    },
): Promise<{ ok: true; started: StartedProjectChatTurn } | StartProjectChatTurnFailure> {
    const { userId, userEmail, requestId, projectId, parsed } = args;
    const { askInputsResponse } = parsed;
    const assistantMessageId = askInputsResponse ? null : randomUUID();
    const turnMessageId =
        assistantMessageId ?? askInputsResponse?.assistant_message_id ?? "";
    const inputMessageId = askInputsResponse ? null : randomUUID();

    const prep = await prepareProjectChatStream(db, {
        userId,
        userEmail,
        projectId,
        messages: parsed.messages,
        chatId: parsed.chatId ?? null,
        inputMessageId,
        displayed_doc: parsed.displayedDoc,
        attached_documents: parsed.attachedDocuments,
        askInputsResponse,
        requestedModel: parsed.model,
        requestedCredentialRef: parsed.credentialRef,
        requestedReasoning: parsed.reasoning,
        requestedTimeZone: parsed.timeZone,
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
        if ("internal" in prep) return { ok: false, internal: true, error: prep.error };
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

    let started = false;
    try {
        // The generation is a server-owned run: it survives the caller's
        // socket and only the Stop endpoint (POST /chat/:chatId/turn/:turnId/
        // stop) aborts it.
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
        started = true;
        return {
            ok: true,
            started: {
                userId,
                userEmail,
                requestId,
                projectId,
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
        // Every way out that is not a started turn releases the lease the
        // preparation took; a started turn releases it in runProjectChatTurn
        // (or abandonProjectChatTurn).
        if (!started) await releaseProjectChatMemory(db, chatId, memoryTurn);
    }
}

/**
 * For a transport that started a turn and then could not attach to it: gives
 * back the memory lease the turn holds. A turn that reaches
 * `runProjectChatTurn` never needs this.
 */
export async function abandonProjectChatTurn(db: Db, started: StartedProjectChatTurn) {
    await releaseProjectChatMemory(db, started.prepared.chatId, started.prepared.memoryTurn);
}

/**
 * The generation loop of a started turn. It always ends the sink (`finish`)
 * exactly once and always settles the memory lease: scheduled for
 * consolidation on a completed answer, released otherwise.
 */
export async function runProjectChatTurn(
    db: Db,
    started: StartedProjectChatTurn,
    sink: ProjectChatTurnSink = started.run,
): Promise<void> {
    const {
        userId,
        userEmail,
        requestId,
        projectId,
        askInputsResponse,
        assistantMessageId,
        inputMessageId,
        turnMessageId,
        subagentRuns,
    } = started;
    const {
        chatId,
        lastUser,
        allowDocumentMutation,
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
    // Mutable: the title-generation flow below reassigns it once a title
    // has been persisted.
    let chatTitle = started.prepared.chatTitle;
    let completedTurnPersisted = started.prepared.completedTurnPersisted;
    let memoryTurnScheduled = false;

    try {
        const write = sink.write;

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
                extraTools: PROJECT_EXTRA_TOOLS,
                // Read-only collaborators keep the conversational surface
                // (read_document, find_in_document, list/fetch_documents and the
                // workflow tools) and lose only the writers.
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
                projectId,
                conversationId: chatId,
                includeMemory: true,
                connectorApprovals: true,
                memoryProjectId: projectId,
                memorySharedAudience,
                nonce,
                emitDone: false,
            });
            throwIfTurnStopped(sink.signal, { fullText, events });

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
                const saved = await insertAssistantMessage(db, {
                    chatId,
                    assistantMessageId,
                    events: persistedEvents,
                    citations,
                    authorUserId: userId,
                    inputMessageId,
                });
                if (!saved.ok) {
                    logAssistantMessageFailure({
                        kind: "chat.message_save_failed",
                        label: "[project-chat/stream] failed to save assistant response",
                        cause: saved.error,
                        component: "assistant-chat",
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
                    "[project-chat/stream] failed to generate chat title",
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
                await updateChatTitle(db, { chatId, title });
                chatTitle = title;
                if (shouldGenerateTitle && !sink.signal.aborted) {
                    write(
                        `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                    );
                }
            }

            // A completed, durable assistant turn is the debounce trigger for the
            // asynchronous memory curator. ask_inputs is a pause, so continuations
            // resolve the existing assistant row and only schedule once it closes.
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
                        projectId: allowDocumentMutation ? projectId : null,
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
                    projectId,
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
                    "[project-chat/stream] failed to generate chat title",
                    titleOutcome.failure.error,
                    isAbortError(err) ? null : err,
                );
            }
            if (isAbortError(err)) {
                console.log("[project-chat/stream] turn stopped", {
                    chatId,
                });
                // Same record as the assistant chat's stop path: the turn,
                // marked stopped, with the documents it changed before it did.
                void enqueueChatTurnAudit(
                    db,
                    {
                        userId,
                        orgId,
                        userEmail,
                        chatId,
                        projectId,
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
                        const saved = await insertAssistantMessage(db, {
                            chatId,
                            assistantMessageId,
                            events: partial.events,
                            citations: partial.citations,
                            authorUserId: userId,
                            inputMessageId,
                        });
                        if (!saved.ok) saveError = saved.error;
                    }
                    if (saveError) {
                        logAssistantMessageFailure({
                            kind: "chat.message_save_failed",
                            label: "[project-chat/stream] failed to save aborted stream",
                            cause: saveError,
                            component: "assistant-chat",
                        });
                    } else {
                        await subagentRuns.flush();
                    }
                }
                write(stopOutcomeFrame(sink));
                write("data: [DONE]\n\n");
                return;
            }
            if (!isReported(err)) {
                reportError(err, { tags: { operation: "project_chat.turn", stage: "chat-stream" } });
            }
            console.error("[project-chat/stream] error:", err);
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
                const saved = askInputsResponse
                    ? null
                    : await insertAssistantMessage(db, {
                          chatId,
                          assistantMessageId,
                          events: errorEvents,
                          citations,
                          authorUserId: userId,
                          inputMessageId,
                      });
                const saveError = saved && !saved.ok ? saved.error : null;
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
                        label: "[project-chat/stream] failed to save error",
                        cause: saveError,
                        component: "assistant-chat",
                    });
                else await subagentRuns.flush();
            } catch (saveErr) {
                logAssistantMessageFailure({
                    kind: "chat.message_save_failed",
                    label: "[project-chat/stream] failed to save error",
                    cause: saveErr,
                    component: "assistant-chat",
                });
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
            sink.finish();
        }
    } finally {
        if (!memoryTurnScheduled) await releaseProjectChatMemory(db, chatId, memoryTurn);
    }
}
