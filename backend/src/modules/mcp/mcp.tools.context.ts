// Context: which workspaces this connection reaches and what the person is
// there (design §4.1). Names and roles come from the same listing the web's
// workspace switcher uses.

import { z } from "zod";
import { listMyOrgs } from "../../lib/orgs";
import { defineMcpTool, mcpText } from "./mcp.tools";
import { serviceFailure } from "./mcp.toolkit";

export const listWorkspaces = defineMcpTool({
    name: "list_workspaces",
    title: "List workspaces",
    description:
        "Lists the LiTT workspaces (Personal and each firm) this connection can use, with the person's role in each, and which one is the default.",
    inputSchema: z.object({}),
    scope: "litt.read",
    lane: "read",
    readOnly: true,
    audit: "call",
    handler: async (_args, { db, principal }) => {
        const mine = await listMyOrgs(db, principal.userId);
        if (!mine.ok) throw serviceFailure("list workspaces", mine);
        const byId = new Map(
            (mine.orgs as { id: string; name?: string; role?: string | null }[]).map((org) => [org.id, org]),
        );
        return mcpText({
            default_workspace: principal.defaultWorkspace,
            workspaces: principal.workspaces.map((workspace) => ({
                id: workspace.id,
                kind: workspace.kind,
                name: workspace.kind === "personal" ? "Personal" : (byId.get(workspace.id)?.name ?? null),
                role: workspace.kind === "personal" ? "owner" : (byId.get(workspace.id)?.role ?? null),
                // `A`: LiTT's own assistant does the work here (training stage); `B`: your AI may.
                mode: workspace.mode,
            })),
        });
    },
});
