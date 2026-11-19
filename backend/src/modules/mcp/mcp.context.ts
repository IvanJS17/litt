// What both MCP prompts and MCP resources are made of (design §2.3: the inputs
// of a piece of work go ALSO as prompts and resources): the workflow's
// instructions, the playbook's rules, the firm's profile, a matter's client
// profile.
//
// There is no second authorization path. A prompt or a resource is read by
// running the tool that already returns the same thing (`get_workflow`,
// `get_playbook`, `get_firm_profile`, `get_client_profile`, and for the
// listings `list_workflows` / `find_playbooks`) through `runMcpTool`, which is
// what `tools/call` runs: the grant's scope, the live workspace fence, the
// person's own access, the apprentice rules, the strict audit row (and the
// egress record of the client profile's quotes, written before the text is
// returned) are the tool's. A thing the person cannot open and a thing that
// does not exist answer the same.
//
// Claude supports tools, prompts and resources, not resource subscriptions:
// the capabilities are declared without `subscribe` or `listChanged`.

import { ProtocolError, INVALID_PARAMS, INTERNAL_ERROR } from "@modelcontextprotocol/server";
import { z } from "zod";
import { findPlaybooks, getPlaybookTool } from "./mcp.tools.playbooks";
import { getClientProfileTool } from "./mcp.tools.donna";
import { getFirmProfileTool } from "./mcp.tools.firmProfile";
import { getWorkflowTool, listWorkflowsTool } from "./mcp.tools.workflows";
import { PERSONAL_WORKSPACE, type McpPrincipal } from "./mcp.principal";
import { runMcpTool, type AnyMcpTool } from "./mcp.tools";
import { UUID_PATTERN } from "../../lib/uuid";

/** Items per page of prompts/list and resources/list. */
export const CONTEXT_PAGE = 25;

export type ContextKind = "workflow" | "playbook";
export type ContextItem = { kind: ContextKind; id: string; title: string; description: string | null };

// ---------------------------------------------------------------------------
// Running the tool
// ---------------------------------------------------------------------------

export type ContextRead = { ok: true; data: Record<string, unknown>; text: string } | { ok: false; code: string };

/** Runs `tool` for this grant and returns its JSON, or the code it refused with. */
export async function readThroughTool(
    tool: AnyMcpTool,
    principal: McpPrincipal,
    args: Record<string, unknown>,
): Promise<ContextRead> {
    const output = await runMcpTool(tool, principal, args);
    const text = output.content[0]?.text ?? "";
    let data: Record<string, unknown> = {};
    try {
        data = JSON.parse(text) as Record<string, unknown>;
    } catch {
        // A tool answers JSON; anything else is treated as a failure below.
    }
    if (output.isError) return { ok: false, code: typeof data.code === "string" ? data.code : "internal_error" };
    return { ok: true, data, text };
}

/**
 * The protocol error for a refused read. Every reason the person cannot have
 * the thing (it is not theirs, not in a workspace of this connection, gone, or
 * never existed) is the SAME answer; the rest are authored, generic ones.
 */
export function refusalError(code: string, what: "prompt" | "resource"): ProtocolError {
    switch (code) {
        case "not_found":
        case "workspace_not_found":
        case "forbidden":
        case "matter_not_retainer":
        case "personal_workspace_disabled":
        case "invalid_arguments":
        case "unavailable_here":
            return new ProtocolError(INVALID_PARAMS, `That ${what} was not found.`);
        case "insufficient_scope":
            return new ProtocolError(INVALID_PARAMS, `This connection does not have the permission this ${what} needs.`);
        case "rate_limited":
            return new ProtocolError(INTERNAL_ERROR, "Too many requests on this connection. Please try again shortly.");
        default:
            return new ProtocolError(INTERNAL_ERROR, `LiTT could not read that ${what}. Try again in a moment.`);
    }
}

// ---------------------------------------------------------------------------
// Names and uris
// ---------------------------------------------------------------------------

const idOf = (value: string): string | null => (UUID_PATTERN.test(value) ? value.toLowerCase() : null);

/** `workflow:<id>` / `playbook:<id>`: the prompt names. */
export const promptName = (kind: ContextKind, id: string) => `${kind}:${id}`;
export function parsePromptName(name: string): { kind: ContextKind; id: string } | null {
    const match = /^(workflow|playbook):(.+)$/.exec(name);
    const id = match ? idOf(match[2]) : null;
    return match && id ? { kind: match[1] as ContextKind, id } : null;
}

export const RESOURCE_TEMPLATES = [
    { name: "workflow", uriTemplate: "litt://workflows/{workflow_id}", title: "Workflow instructions", description: "A workflow's instructions (and its columns, if it is tabular), as get_workflow returns them." },
    { name: "playbook", uriTemplate: "litt://playbooks/{playbook_id}", title: "Playbook rules", description: "A playbook's rules and criteria, as get_playbook returns them." },
    { name: "firm-profile", uriTemplate: "litt://workspaces/{workspace_id}/firm-profile", title: "Firm profile", description: "What the law firm says about itself, as get_firm_profile returns it." },
    { name: "client-profile", uriTemplate: "litt://matters/{matter_id}/client-profile", title: "Client profile of a matter", description: "The confirmed facts of a retainer matter's client profile, as get_client_profile returns them." },
] as const;

export type ResourceTarget =
    | { kind: "workflow" | "playbook"; id: string }
    | { kind: "firm-profile"; workspace: string }
    | { kind: "client-profile"; id: string };

export function parseResourceUri(uri: string): ResourceTarget | null {
    const match = /^litt:\/\/(workflows|playbooks|matters|workspaces)\/([^/]+)(?:\/(client-profile|firm-profile))?$/.exec(uri);
    if (!match) return null;
    const [, collection, raw, tail] = match;
    if (collection === "workspaces") {
        // An organization id or `personal` (which has no firm: the tool answers not found).
        return tail === "firm-profile" && (raw === PERSONAL_WORKSPACE || idOf(raw)) ? { kind: "firm-profile", workspace: raw === PERSONAL_WORKSPACE ? raw : raw.toLowerCase() } : null;
    }
    const id = idOf(raw);
    if (!id) return null;
    if (collection === "matters") return tail === "client-profile" ? { kind: "client-profile", id } : null;
    if (tail) return null;
    return { kind: collection === "workflows" ? "workflow" : "playbook", id };
}

export const resourceUri = {
    workflow: (id: string) => `litt://workflows/${id}`,
    playbook: (id: string) => `litt://playbooks/${id}`,
    firmProfile: (workspace: string) => `litt://workspaces/${workspace}/firm-profile`,
    clientProfile: (id: string) => `litt://matters/${id}/client-profile`,
};

export const toolFor = {
    workflow: getWorkflowTool,
    playbook: getPlaybookTool,
    firm: getFirmProfileTool,
    client: getClientProfileTool,
};

// ---------------------------------------------------------------------------
// Listing: bounded, paged, only what the grant can see
// ---------------------------------------------------------------------------

type PageCursor = { s: ContextKind; c: string | null };
const cursorShape = z.object({ s: z.enum(["workflow", "playbook"]), c: z.string().max(200).nullable() });

export function encodePageCursor(cursor: PageCursor): string {
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
export function decodePageCursor(raw: string | undefined | null): PageCursor {
    if (!raw) return { s: "workflow", c: null };
    try {
        return cursorShape.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    } catch {
        throw new ProtocolError(INVALID_PARAMS, "That page cursor is not valid.");
    }
}

/**
 * One page of the connection's default workspace: workflows first, then
 * playbooks, `CONTEXT_PAGE` at a time. The lists are the tools' own
 * (`list_workflows`, `find_playbooks`), so a thing appears only to the people
 * who can open it. A failed read lists nothing rather than failing the client's menu.
 */
export async function listContextPage(
    principal: McpPrincipal,
    rawCursor: string | undefined | null,
): Promise<{ items: ContextItem[]; nextCursor: string | null }> {
    const cursor = decodePageCursor(rawCursor);
    const args = { limit: CONTEXT_PAGE, ...(cursor.c ? { cursor: cursor.c } : {}) };
    if (cursor.s === "workflow") {
        const read = await readThroughTool(listWorkflowsTool, principal, args);
        const rows = read.ok && Array.isArray(read.data.workflows) ? (read.data.workflows as Record<string, unknown>[]) : [];
        const items = rows.map((row) => ({
            kind: "workflow" as const,
            id: String(row.workflow_id),
            title: typeof row.title === "string" && row.title ? row.title : "Workflow",
            description: typeof row.description === "string" ? row.description : null,
        }));
        const next = read.ok && typeof read.data.next_cursor === "string" ? read.data.next_cursor : null;
        return { items, nextCursor: encodePageCursor(next ? { s: "workflow", c: next } : { s: "playbook", c: null }) };
    }
    const read = await readThroughTool(findPlaybooks, principal, args);
    const rows = read.ok && Array.isArray(read.data.playbooks) ? (read.data.playbooks as Record<string, unknown>[]) : [];
    const items = rows.map((row) => ({
        kind: "playbook" as const,
        id: String(row.id),
        title: typeof row.name === "string" && row.name ? row.name : "Playbook",
        description: typeof row.description === "string" && row.description ? row.description : null,
    }));
    const next = read.ok && typeof read.data.next_cursor === "string" ? read.data.next_cursor : null;
    return { items, nextCursor: next ? encodePageCursor({ s: "playbook", c: next }) : null };
}
