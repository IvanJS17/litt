// The tools /mcp offers. Each one is declared with defineMcpTool in a
// mcp.tools.<topic>.ts file (context, matters, documents, uploads, playbooks,
// tabular, chat) and listed here. They get scope enforcement, the
// per-grant budget, the live workspace check and the audit from mcp.tools.ts.

import { z } from "zod";
import { defineMcpTool, mcpText, type AnyMcpTool } from "./mcp.tools";
import { listWorkspaces } from "./mcp.tools.context";
import { createMatter, findMatters, getMatter } from "./mcp.tools.matters";
import {
    createNoteDocumentTool,
    listDocumentVersions,
    listMatterDocuments,
    readDocument,
    searchDocuments,
} from "./mcp.tools.documents";
import {
    findPlaybooks,
    getPlaybookRunTool,
    getPlaybookTool,
    listPlaybookRuns,
    preparePlaybookReview,
    runPlaybookReview,
    submitPlaybookReview,
} from "./mcp.tools.playbooks";
import {
    createTabularReviewTool,
    getTabularReviewTool,
    getTabularRunStatus,
    listTabularReviewsTool,
    readTabularCells,
    runTabularReview,
    stopTabularRun,
} from "./mcp.tools.tabular";
import {
    getChatTool,
    getChatTurn,
    listChatsTool,
    sendChatMessage,
    startChat,
    stopChatTurnTool,
} from "./mcp.tools.chat";
import { completeDocumentUpload, getUploadStatus, requestDocumentUpload } from "./mcp.tools.uploads";

export const whoami = defineMcpTool({
    name: "whoami",
    title: "Who am I",
    description: "Shows which LiTT account, workspaces and permissions this connection is using.",
    inputSchema: z.object({}),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    handler: async (_args, { principal }) =>
        mcpText({
            user_id: principal.userId,
            client_id: principal.clientId,
            scopes: principal.scopes,
            // Only the workspaces the person can open right now.
            workspaces: principal.workspaces.map((w) => w.id),
            default_workspace: principal.defaultWorkspace,
            mode: principal.mode,
            workspace_modes: Object.fromEntries(principal.workspaces.map((w) => [w.id, w.mode])),
        }),
});

export const MCP_TOOLS: readonly AnyMcpTool[] = [
    whoami,
    listWorkspaces,
    findMatters,
    getMatter,
    createMatter,
    listMatterDocuments,
    searchDocuments,
    readDocument,
    listDocumentVersions,
    createNoteDocumentTool,
    requestDocumentUpload,
    completeDocumentUpload,
    getUploadStatus,
    findPlaybooks,
    getPlaybookTool,
    runPlaybookReview,
    getPlaybookRunTool,
    listPlaybookRuns,
    preparePlaybookReview,
    submitPlaybookReview,
    listTabularReviewsTool,
    createTabularReviewTool,
    getTabularReviewTool,
    readTabularCells,
    runTabularReview,
    getTabularRunStatus,
    stopTabularRun,
    startChat,
    sendChatMessage,
    getChatTurn,
    stopChatTurnTool,
    listChatsTool,
    getChatTool,
];
