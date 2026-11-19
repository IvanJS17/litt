// How a LiTT MCP tool is declared, and what every call gets for free.
//
// A tool says the scope it needs, the rate lane it spends, whether it works
// in a workspace and in which mode it runs. `registerMcpTools` wraps it so
// that, in this order and for every call:
//
//   1. the grant must hold the tool's scope (the HTTP gate already answered
//      403 insufficient_scope; this is the second lock);
//   2. the workspace it names must be one the person can open RIGHT NOW (the
//      principal was revalidated for this request), and a tool that runs the
//      client's own AI (mode B) is refused in an apprentice's firm;
//   3. a tool that writes, spends or reads document text writes its
//      audit_events row first and does not run without it;
//   4. the handler runs; whatever it throws reaches the client as a short,
//      authored error, never a stack, a SQL message or a path;
//   5. one mcp_tool_calls row records the outcome and the time.
//
// Tools that read the database do it through the services the web uses; this
// module never queries tables for them.

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createServerSupabase, type Db } from "../../lib/supabase";
import {
    findPersonalWorkspaceDisabled,
    PERSONAL_WORKSPACE_DISABLED,
    PERSONAL_WORKSPACE_DISABLED_DETAIL,
    withRequestPrincipal,
} from "../../lib/managedAccounts";
import { reportError } from "../../lib/observability/report";
import { rateLimitedBody } from "../../lib/httpError";
import type { McpScope } from "./mcp.config";
import {
    recordMcpAuditEvent,
    recordMcpToolCall,
    type McpAuditRefs,
    type McpCallOutcome,
} from "./mcp.calls";
import { takeGrantBudget, type McpLane } from "./mcp.limits";
import { loadConfirmedEmail, modeOf, type McpMode, type McpPrincipal } from "./mcp.principal";

/**
 * The most text one tool result may carry. Claude Code refuses results past
 * ~25 000 tokens (design §9), and a long reply costs the person's context for
 * nothing: tools page and truncate on their own, and this is the net under them.
 */
export const MCP_MAX_RESULT_CHARS = 100_000;

/** An expected failure: its code and text are authored here, so they are safe to show. */
export class McpToolError extends Error {
    constructor(
        readonly code: string,
        message: string,
        readonly suggestedAction?: string,
    ) {
        super(message);
        this.name = "McpToolError";
    }
}

export type McpToolContent = { type: "text"; text: string };
export type McpToolOutput = { content: McpToolContent[]; isError?: boolean };

/** What a handler gets besides its arguments. */
export type McpCall = {
    /** The service-role client: only for passing to the services the web uses. */
    db: Db;
    /**
     * The person's confirmed address ("" when none), the same authorization
     * input `requireAuth` hands the web routes. Read once per call, on demand.
     */
    userEmail: () => Promise<string>;
    principal: McpPrincipal;
    /** The workspace of this call (`usesWorkspace` tools), already checked live; null otherwise. */
    workspace: string | null;
    /** The mode this call runs in: the workspace's own, or the grant's strictest. */
    mode: McpMode;
};

export type McpToolSpec<S extends z.ZodObject = z.ZodObject> = {
    name: string;
    title: string;
    description: string;
    inputSchema: S;
    /** The permission the connection must hold. */
    scope: McpScope;
    /** `read` for lookups; `write` for anything that writes, runs an engine, spends or chats. */
    lane: McpLane;
    readOnly: boolean;
    /**
     * Only a tool that deletes or overwrites says so (design §4: R3). Adding a
     * document or a note is `false`: `readOnlyHint: false, destructiveHint: false`.
     */
    destructive?: boolean;
    /**
     * `strict` for a call that writes, spends or takes document text out: an
     * audit_events row (surface 'mcp') is written first and the call does
     * not run without it. `call` records mcp_tool_calls only.
     */
    audit: "call" | "strict";
    /** The tool takes an optional `workspace` argument (default: the grant's default). */
    usesWorkspace?: boolean;
    /**
     * For a tool that names a resource (a matter, a document) rather than a
     * workspace: finds the resource's workspace through the services the web
     * uses and throws `McpToolError` when the person cannot open it or this
     * connection does not cover its workspace. Runs before the audit row, so
     * the row carries the right firm.
     */
    resolveWorkspace?: (args: z.infer<S>, call: McpCall) => Promise<string>;
    /** `B` = the client's own AI does the work; refused where the person is an apprentice. */
    mode?: McpMode;
    /** Ids a `strict` audit row records about the call (never names, text or secrets). */
    auditRefs?: (args: z.infer<S>) => McpAuditRefs;
    handler: (args: z.infer<S>, call: McpCall) => Promise<McpToolOutput>;
};

// The registry holds specs of any input shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMcpTool = McpToolSpec<any>;

export function defineMcpTool<S extends z.ZodObject>(spec: McpToolSpec<S>): McpToolSpec<S> {
    return spec;
}

export const mcpText = (value: unknown): McpToolOutput => ({
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }],
});

function failureOutput(code: string, detail: string, suggestedAction?: string): McpToolOutput {
    return {
        isError: true,
        content: [
            {
                type: "text",
                text: JSON.stringify({
                    code,
                    detail,
                    ...(suggestedAction ? { suggested_action: suggestedAction } : {}),
                }),
            },
        ],
    };
}

// The services the web uses read "who is asking" from the request's principal
// (managed accounts); a tool call is one request, so it runs inside one.
function runTool(tool: AnyMcpTool, principal: McpPrincipal, args: unknown): Promise<McpToolOutput> {
    return withRequestPrincipal(
        { userId: principal.userId, personalWorkspaceDisabled: principal.personalWorkspaceDisabled },
        () => runToolInPrincipal(tool, principal, args),
    );
}

async function runToolInPrincipal(tool: AnyMcpTool, principal: McpPrincipal, args: unknown): Promise<McpToolOutput> {
    const db = createServerSupabase();
    let email: Promise<string> | null = null;
    const callOf = (): McpCall => ({
        db,
        userEmail: () => (email ??= loadConfirmedEmail(db, principal.userId)),
        principal,
        workspace,
        mode,
    });
    const started = performance.now();
    let workspace: string | null = null;
    let mode: McpMode = principal.mode;
    const finish = async (outcome: McpCallOutcome, errorCode?: string) =>
        recordMcpToolCall(db, {
            tool: tool.name,
            grantId: principal.grantId,
            userId: principal.userId,
            clientId: principal.clientId,
            workspace,
            mode,
            outcome,
            errorCode,
            latencyMs: performance.now() - started,
        });

    try {
        if (!principal.scopes.includes(tool.scope)) {
            await finish("denied", "insufficient_scope");
            return failureOutput("insufficient_scope", "This connection does not have the permission this tool needs.");
        }
        if (tool.resolveWorkspace) {
            // The resource the call names decides the workspace (and the fence).
            const resolved = await tool.resolveWorkspace(args, callOf());
            if (!principal.workspaces.some((w) => w.id === resolved))
                throw new McpToolError("not_found", "That item was not found.");
            workspace = resolved;
            mode = modeOf(principal, workspace);
        } else if (tool.usesWorkspace) {
            const requested = (args as { workspace?: unknown } | null)?.workspace;
            workspace = typeof requested === "string" && requested ? requested : principal.defaultWorkspace;
            if (!principal.workspaces.some((w) => w.id === workspace)) {
                // The id is caller input: it is not recorded.
                workspace = null;
                await finish("denied", "workspace_not_found");
                return failureOutput(
                    "workspace_not_found",
                    "That workspace is not part of this connection or you can no longer open it.",
                    "Pick one of the workspaces listed by whoami.",
                );
            }
            mode = modeOf(principal, workspace);
        }
        if (tool.mode === "B" && mode === "A") {
            await finish("denied", "mode_not_available");
            return failureOutput(
                "mode_not_available",
                "In this workspace your training stage allows LiTT to run the work, not your own AI.",
                "Use the tool that lets LiTT run it.",
            );
        }
        if (tool.audit === "strict") {
            try {
                await recordMcpAuditEvent(db, {
                    principal,
                    tool: tool.name,
                    workspace,
                    refs: tool.auditRefs?.(args),
                });
            } catch (error) {
                reportError(error, { tags: { component: "mcp", operation: "mcp.audit_event" } });
                await finish("error", "audit_unavailable");
                return failureOutput(
                    "audit_unavailable",
                    "The action could not be recorded, so it was not run. Try again in a moment.",
                );
            }
        }
        const output = await tool.handler(args, callOf());
        if (output.content.some((part) => part.text.length > MCP_MAX_RESULT_CHARS)) {
            await finish("error", "result_too_large");
            return failureOutput(
                "result_too_large",
                "The result is larger than one reply can carry.",
                "Ask for a smaller page or a narrower range.",
            );
        }
        await finish(output.isError ? "error" : "ok", output.isError ? "tool_error" : undefined);
        return output;
    } catch (error) {
        // A service refused personal content to a firm-managed account.
        if (findPersonalWorkspaceDisabled(error)) {
            await finish("denied", PERSONAL_WORKSPACE_DISABLED);
            return failureOutput(PERSONAL_WORKSPACE_DISABLED, PERSONAL_WORKSPACE_DISABLED_DETAIL);
        }
        if (error instanceof McpToolError) {
            await finish("error", error.code);
            return failureOutput(error.code, error.message, error.suggestedAction);
        }
        reportError(error, { tags: { component: "mcp", operation: "mcp.tool" }, extra: { tool: tool.name } });
        await finish("error", "internal_error");
        return failureOutput("internal_error", "LiTT could not complete this request.");
    }
}

/**
 * One tool, run for this grant as `tools/call` runs it: arguments checked
 * against the tool's schema, then the scope, the live workspace fence, the
 * strict audit row, the handler and the call record, in that order. The prompts
 * and resources of mcp.context.ts read through here, so they have no
 * authorization path of their own.
 */
export async function runMcpTool(tool: AnyMcpTool, principal: McpPrincipal, args: unknown): Promise<McpToolOutput> {
    const parsed = (tool.inputSchema as z.ZodObject).safeParse(args);
    if (!parsed.success) return failureOutput("invalid_arguments", "The request is not valid.");
    return runTool(tool, principal, parsed.data);
}

/** Register the tools the grant may use; the rest do not appear in tools/list. */
export function registerMcpTools(
    server: McpServer,
    tools: readonly AnyMcpTool[],
    principal: McpPrincipal,
): void {
    for (const tool of tools) {
        if (!principal.scopes.includes(tool.scope)) continue;
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: {
                    readOnlyHint: tool.readOnly,
                    destructiveHint: tool.destructive ?? false,
                    // LiTT only talks to the person's own data.
                    openWorldHint: false,
                },
            },
            async (args: unknown) => runTool(tool, principal, args),
        );
    }
}

export type McpRefusal = {
    status: 403 | 429;
    headers: Record<string, string>;
    body: Record<string, unknown>;
    /** What to record in mcp_tool_calls. */
    tool: string;
    outcome: "denied" | "rate_limited";
    errorCode: string;
};

function messagesOf(body: unknown): { method?: unknown; params?: unknown }[] {
    const list = Array.isArray(body) ? body : [body];
    return list.filter((m): m is { method?: unknown; params?: unknown } => !!m && typeof m === "object");
}

/**
 * Before the SDK sees the request: the scope of every tool it calls, and the
 * grant's budget for each message. A tool the registry does not know is left
 * to the SDK to answer (it counts as a read).
 */
export function preflightMcpRequest(
    tools: readonly AnyMcpTool[],
    principal: McpPrincipal,
    body: unknown,
    resourceMetadataUrl: string,
): McpRefusal | null {
    const messages = messagesOf(body).filter((m) => typeof m.method === "string");
    // Scopes first, so a refused call does not spend budget.
    for (const message of messages) {
        if (message.method !== "tools/call") continue;
        const name = (message.params as { name?: unknown } | undefined)?.name;
        const tool = typeof name === "string" ? tools.find((t) => t.name === name) : undefined;
        if (tool && !principal.scopes.includes(tool.scope))
            return {
                status: 403,
                headers: {
                    "WWW-Authenticate": `Bearer error="insufficient_scope", error_description="This connection does not have the permission this tool needs.", scope="${tool.scope}", resource_metadata="${resourceMetadataUrl}"`,
                },
                body: {
                    error: "insufficient_scope",
                    error_description: "This connection does not have the permission this tool needs.",
                },
                tool: tool.name,
                outcome: "denied",
                errorCode: "insufficient_scope",
            };
    }
    for (const message of messages) {
        const name = (message.params as { name?: unknown } | undefined)?.name;
        const tool =
            message.method === "tools/call" && typeof name === "string"
                ? tools.find((t) => t.name === name)
                : undefined;
        const decision = takeGrantBudget(principal.grantId, tool?.lane ?? "read");
        if (!decision.allowed)
            return {
                status: 429,
                headers: { "Retry-After": String(decision.retryAfterSeconds) },
                body: rateLimitedBody("Too many requests on this connection. Please try again shortly."),
                tool: tool?.name ?? "(protocol)",
                outcome: "rate_limited",
                errorCode: "rate_limited",
            };
    }
    return null;
}
