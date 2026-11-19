// A conversation inside a matter, as the web has it (design §4.4, layer 2).
//
// The web's matter page talks to POST /projects/:id/chat, not to POST /chat:
// that engine reads the whole matter (its documents, its folders, its
// workflows), offers the matter's own tools and judges write access by the
// person's standing on the MATTER. These tools start and continue the SAME
// turn (`startProjectChatTurn` / `runProjectChatTurn`, the functions the route
// itself calls), so the access rules, the pinned BYOK route (no fallback), the
// firm profile, the citation checks, the memory and the training rules
// ("Tu turno primero": an apprentice brings their own approach first, mode A
// only) are the web's.
//
// A conversation started here is an ordinary `chats` row marked as coming from
// the connected app, so the dashboard lists it as a session from Claude. Its
// turn is followed and stopped with the assistant-chat tools (get_chat_turn,
// stop_chat_turn, get_chat): the run registry and the stored messages are the
// same. There is no streaming to the client: the call starts the turn, waits a
// little and otherwise answers `generating`.

import { z } from "zod";
import {
    activeChatTurn,
    loadChatHistory,
} from "../chat/chat.service";
import {
    runProjectChatTurn,
    startProjectChatTurn,
    parseProjectChatRequest,
} from "../project-chat/projectChat.service";
import { reportError } from "../../lib/observability/report";
import { createMcpChatSink } from "./mcp.chatSink";
import { clientNameOf } from "./mcp.grants";
import {
    attemptSchema,
    chatAccess,
    chatWorkspace,
    confidenceSchema,
    followTurn,
    messageSchema,
    startRefusal,
} from "./mcp.tools.chat";
import { defineMcpTool, mcpText, McpToolError, type McpCall } from "./mcp.tools";
import { idSchema, loadDocument, matterWorkspace } from "./mcp.toolkit";

const MAX_CHAT_DOCUMENTS = 10;

const documentIdsSchema = z
    .array(idSchema("document_ids"))
    .max(MAX_CHAT_DOCUMENTS)
    .optional()
    .describe(`Documents of this matter to put in front of the assistant for this message (up to ${MAX_CHAT_DOCUMENTS}). It can read the rest of the matter's documents by itself.`);

/** The documents the call names, once the person can open each one and this connection covers it. */
async function attachedDocuments(call: McpCall, documentIds: string[] | undefined) {
    const files: { filename: string; document_id: string }[] = [];
    for (const id of [...new Set(documentIds ?? [])]) {
        const { doc } = await loadDocument(call, id);
        files.push({ filename: String(doc.filename ?? ""), document_id: id });
    }
    return files;
}

/** One turn of the matter's assistant: start it exactly as the web route does, wait a little, report. */
async function runProjectTurn(
    call: McpCall,
    args: {
        chatId: string | null;
        matterId: string;
        workspace: string;
        message: string;
        documentIds?: string[];
        model?: string;
        credentialRef?: string;
        attempt?: string;
        confidence?: number;
    },
) {
    const files = await attachedDocuments(call, args.documentIds);
    const history = args.chatId ? await loadChatHistory(call.db, args.chatId) : [];
    const parsed = parseProjectChatRequest({
        messages: [
            ...history,
            { role: "user", content: args.message, ...(files.length ? { files } : {}) },
        ],
        ...(args.chatId ? { chat_id: args.chatId } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.credentialRef ? { credential_ref: args.credentialRef } : {}),
        ...(files.length ? { attached_documents: files } : {}),
        // "Tu turno primero": an apprentice brings their own approach first.
        ...(args.attempt ? { attempt: args.attempt } : {}),
        ...(args.confidence ? { confidence: args.confidence } : {}),
    });
    if (!parsed.ok) throw new McpToolError("invalid_request", parsed.detail);
    // The web writes the person's message before it finds the thread busy; a
    // tool answers first, so a refused call leaves nothing behind.
    if (args.chatId && activeChatTurn(args.chatId))
        throw new McpToolError(
            "turn_in_progress",
            "A response is already being generated for this chat.",
            "Wait for the current response (get_chat_turn) or stop it with stop_chat_turn.",
        );

    const started = await startProjectChatTurn(call.db, {
        userId: call.principal.userId,
        userEmail: (await call.userEmail()) || undefined,
        requestId: undefined,
        projectId: args.matterId,
        parsed: parsed.value,
        origin: args.chatId
            ? undefined
            : { grantId: call.principal.grantId, label: await clientNameOf(call.db, call.principal.clientId) },
    });
    if (!started.ok) startRefusal(started);
    const turn = started.started;
    // Nobody holds a socket: the turn runs on its own run, writes to this
    // sink and saves the answer to the conversation. It ends the run itself.
    void runProjectChatTurn(call.db, turn, createMcpChatSink(turn.run)).catch((error: unknown) => {
        reportError(error, { tags: { component: "mcp", operation: "mcp.project_chat_turn" } });
        turn.run.finish();
    });
    return followTurn(call, { run: turn.run, chatId: turn.prepared.chatId, turnId: turn.turnMessageId }, args.workspace);
}

export const startProjectChat = defineMcpTool({
    name: "start_project_chat",
    title: "Start a conversation in a matter with LiTT's assistant",
    description:
        "Starts a new conversation with the assistant of a matter, the one LiTT's web app opens inside a matter, and sends its first message. It sees the matter's documents, can list and read them and answers with citations. It uses LiTT's model for that workspace with the person's own key; the model is fixed for the conversation and LiTT never switches to another one. The conversation appears in the person's LiTT history marked as coming from this app. Waits a short while; if the answer is not ready the status is 'generating': follow it with get_chat_turn (use send_project_chat_message for the next message).",
    inputSchema: z.object({
        matter_id: idSchema("matter_id").describe("A matter from find_matters."),
        message: messageSchema,
        document_ids: documentIdsSchema,
        model: z.string().trim().min(1).max(200).optional().describe("A model id the person has a key for. Default: the person's usual model."),
        credential_ref: z.string().trim().min(1).max(200).optional().describe("Which saved key to use, when the person has several for the provider."),
        attempt: attemptSchema,
        confidence: confidenceSchema,
    }),
    scope: "litt.chat",
    lane: "write",
    readOnly: false,
    destructive: false,
    // It spends the person's model budget and writes a conversation.
    audit: "strict",
    auditRefs: (args) => ({ projectId: args.matter_id }),
    resolveWorkspace: (args, call) => matterWorkspace(call, args.matter_id),
    handler: async (args, call) =>
        mcpText(
            await runProjectTurn(call, {
                chatId: null,
                matterId: args.matter_id,
                workspace: call.workspace!,
                message: args.message,
                documentIds: args.document_ids,
                model: args.model,
                credentialRef: args.credential_ref,
                attempt: args.attempt,
                confidence: args.confidence,
            }),
        ),
});

export const sendProjectChatMessage = defineMcpTool({
    name: "send_project_chat_message",
    title: "Send a message in a matter's conversation",
    description:
        "Sends a message in an existing conversation of a matter (one from start_project_chat or list_chats with a matter_id) and gets the matter assistant's answer. The conversation keeps its model and key. Only one answer is written at a time: while one is being generated the call is refused with turn_in_progress. Waits a short while; if the answer is not ready the status is 'generating': follow it with get_chat_turn. A conversation that belongs to no matter takes send_chat_message instead.",
    inputSchema: z.object({
        chat_id: idSchema("chat_id"),
        message: messageSchema,
        document_ids: documentIdsSchema,
        attempt: attemptSchema,
        confidence: confidenceSchema,
    }),
    scope: "litt.chat",
    lane: "write",
    readOnly: false,
    destructive: false,
    audit: "strict",
    auditRefs: (args) => ({ chatId: args.chat_id }),
    resolveWorkspace: (args, call) => chatWorkspace(call, args.chat_id),
    handler: async (args, call) => {
        const { chat } = await chatAccess(call, args.chat_id);
        if (!chat.project_id)
            throw new McpToolError(
                "not_a_matter_chat",
                "That conversation does not belong to a matter.",
                "Use send_chat_message for it.",
            );
        return mcpText(
            await runProjectTurn(call, {
                chatId: args.chat_id,
                matterId: chat.project_id,
                workspace: call.workspace!,
                message: args.message,
                documentIds: args.document_ids,
                attempt: args.attempt,
                confidence: args.confidence,
            }),
        );
    },
});
