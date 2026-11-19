// MCP resources (design §2.3, layer 2): the context a person attaches from
// their AI app instead of waiting for the model to ask for it.
//
//   litt://workflows/{id}                       a workflow's instructions   (get_workflow)
//   litt://playbooks/{id}                       a playbook's rules          (get_playbook)
//   litt://workspaces/{id}/firm-profile         the firm's profile          (get_firm_profile)
//   litt://matters/{id}/client-profile          a retainer matter's confirmed client profile (get_client_profile)
//
// resources/list shows the connection's firms (their profile) and the default
// workspace's workflows and playbooks, a page at a time; the matter's client
// profile is a template only (a person has many matters: the app names one).
// There are no resource subscriptions (Claude does not support them): the
// capability is declared without `subscribe` or `listChanged`.
//
// A read is the tool's own (mcp.context.ts): the grant's scope, the live
// workspace fence, the person's access, the strict audit row, and for the
// client profile the egress record of the quotes BEFORE they are returned. A
// resource that does not exist, one the person cannot open and one outside the
// connection's workspaces answer the same: not found.

import type { McpServer } from "@modelcontextprotocol/server";
import { ResourceNotFoundError } from "@modelcontextprotocol/server";
import { PERSONAL_WORKSPACE, type McpPrincipal } from "./mcp.principal";
import {
    listContextPage,
    parseResourceUri,
    readThroughTool,
    refusalError,
    resourceUri,
    RESOURCE_TEMPLATES,
    toolFor,
} from "./mcp.context";

const JSON_MIME = "application/json";
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** resources/list, resources/templates/list and resources/read for this connection. */
export function registerMcpResources(server: McpServer, principal: McpPrincipal): void {
    // Declared here, not in the constructor: passing `resources` there makes the
    // SDK install its own handlers and advertise `listChanged` and, with them,
    // the possibility of subscribing; Claude supports neither.
    server.server.registerCapabilities({ resources: {} });
    server.server.setRequestHandler("resources/list", async (request) => {
        const cursor = request.params?.cursor;
        const page = await listContextPage(principal, cursor);
        // The firms come with the first page only: one profile per firm workspace of the connection.
        const firms = cursor
            ? []
            : principal.workspaces
                  .filter((w) => w.id !== PERSONAL_WORKSPACE)
                  .map((w) => ({
                      uri: resourceUri.firmProfile(w.id),
                      name: `firm-profile-${w.id}`,
                      title: "Firm profile",
                      description: "What the law firm says about itself in LiTT.",
                      mimeType: JSON_MIME,
                  }));
        return {
            resources: [
                ...firms,
                ...page.items.map((item) => ({
                    uri: item.kind === "workflow" ? resourceUri.workflow(item.id) : resourceUri.playbook(item.id),
                    name: `${item.kind}-${item.id}`,
                    title: clip(item.title, 200),
                    ...(item.description ? { description: clip(item.description, 200) } : {}),
                    mimeType: JSON_MIME,
                })),
            ],
            ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        };
    });

    server.server.setRequestHandler("resources/templates/list", async () => ({
        resourceTemplates: RESOURCE_TEMPLATES.map((template) => ({ ...template, mimeType: JSON_MIME })),
    }));

    server.server.setRequestHandler("resources/read", async (request) => {
        const uri = request.params.uri;
        const target = parseResourceUri(uri);
        if (!target) throw new ResourceNotFoundError(uri, "That resource was not found.");
        const read =
            target.kind === "workflow"
                ? await readThroughTool(toolFor.workflow, principal, { workflow_id: target.id })
                : target.kind === "playbook"
                  ? await readThroughTool(toolFor.playbook, principal, { playbook_id: target.id })
                  : target.kind === "firm-profile"
                    ? await readThroughTool(toolFor.firm, principal, { workspace: target.workspace })
                    : await readThroughTool(toolFor.client, principal, { matter_id: target.id });
        if (!read.ok) {
            const error = refusalError(read.code, "resource");
            throw error.message.endsWith("was not found.") ? new ResourceNotFoundError(uri, error.message) : error;
        }
        return { contents: [{ uri, mimeType: JSON_MIME, text: read.text }] };
    });
}
