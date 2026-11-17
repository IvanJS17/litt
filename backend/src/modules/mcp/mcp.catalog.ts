// The tools /mcp offers. Real tools (matters, documents, playbooks, tabular,
// chat) are declared here with defineMcpTool and get scope enforcement, the
// per-grant budget, the live workspace check and the audit from mcp.tools.ts.

import { z } from "zod";
import { defineMcpTool, mcpText, type AnyMcpTool } from "./mcp.tools";

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

export const MCP_TOOLS: readonly AnyMcpTool[] = [whoami];
