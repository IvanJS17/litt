// What the audit entry of a tool call may name. The writer of that entry
// (`recordMcpAuditEvent`) takes only refs that went through here: a matter, a
// document or a conversation is recorded when this person can open it, this
// connection covers its workspace, and it lies in the workspace the call runs
// in. Anything else is left out and only its kind is noted, never its id, so an
// entry cannot refer to (or be filed under) what the call was not authorised
// to act on, whatever a tool's `auditRefs` returns.
//
// The verdicts are the ones the tools' own resolvers give (`matterWorkspace`,
// `documentWorkspace`, `chatWorkspace` in mcp.toolkit.ts / mcp.tools.chat.ts),
// asked of the same services. They are not imported from there because those
// files import the tool runner, which imports this one.

import { checkProjectAccess, resolveContentOrgId } from "../../lib/access";
import type { Db } from "../../lib/supabase";
import { getAccessibleChat } from "../chat/chat.service";
import { getDocument } from "../documents/documents.service";
import { ensureReviewChatWriteAccess } from "../tabular/tabular.service";
import type { AuthorisedAuditRefs, McpAuditRefs } from "./mcp.calls";
import { PERSONAL_WORKSPACE, type McpPrincipal } from "./mcp.principal";

/** The part of a tool call the checks need (an `McpCall` has it). */
type AuditCall = { db: Db; principal: McpPrincipal; userEmail: () => Promise<string> };

/** The workspace of content that belongs to `orgId`, when this connection covers it. */
const covered = (call: AuditCall, orgId: string | null | undefined): string | null => {
    const workspace = orgId ?? PERSONAL_WORKSPACE;
    return call.principal.workspaces.some((w) => w.id === workspace) ? workspace : null;
};

async function matterPlace(call: AuditCall, matterId: string): Promise<string | null> {
    const access = await checkProjectAccess(matterId, call.principal.userId, await call.userEmail(), call.db);
    return access.ok ? covered(call, access.project.org_id) : null;
}

async function documentPlace(call: AuditCall, documentId: string): Promise<string | null> {
    const found = await getDocument(documentId, call.principal.userId, await call.userEmail(), call.db);
    if (!found.ok) {
        // Not being able to open it is a verdict; any other failure stops the call (fail closed).
        if (found.kind === "error") throw found.error;
        return null;
    }
    const doc = found.doc as { org_id?: string | null; project_id?: string | null };
    let orgId = doc.org_id ?? null;
    // A document in a matter lives where the matter does.
    if (doc.project_id) {
        const resolved = await resolveContentOrgId(call.db, { projectId: doc.project_id });
        if (!resolved.ok) throw new Error("could not resolve the document's workspace");
        orgId = resolved.orgId;
    }
    return covered(call, orgId);
}

async function chatPlace(call: AuditCall, chatId: string, reviewId: string | null | undefined, workspace: string): Promise<string | null> {
    // A thread of a tabular review (the call names its review): the person must be able to write in it, as the tools require.
    if (reviewId) {
        const thread = await ensureReviewChatWriteAccess(call.db, reviewId, chatId, call.principal.userId, (await call.userEmail()) || undefined);
        if (thread.ok) return workspace;
        if (thread.kind === "error") throw thread.error;
    }
    const access = await getAccessibleChat(call.db, {
        chatId,
        userId: call.principal.userId,
        userEmail: (await call.userEmail()) || null,
    });
    return access.ok ? covered(call, access.chat.org_id) : null;
}

/**
 * The refs of a call, cut down to what it was authorised to act on in
 * `workspace`. The ids of playbooks, workflows, reviews and versions only go to
 * the entry's detail: nothing derives an organization from them.
 */
export async function authoriseAuditRefs(
    call: AuditCall,
    workspace: string | null,
    refs: McpAuditRefs | undefined,
): Promise<AuthorisedAuditRefs> {
    const dropped: string[] = [];
    const check = async (kind: string, id: string | null | undefined, place: () => Promise<string | null>) => {
        if (!id) return null;
        if (workspace !== null && (await place()) === workspace) return id;
        dropped.push(kind);
        return null;
    };
    const projectId = await check("matter", refs?.projectId, () => matterPlace(call, refs!.projectId!));
    const documentId = await check("document", refs?.documentId, () => documentPlace(call, refs!.documentId!));
    const chatId = await check("conversation", refs?.chatId, () => chatPlace(call, refs!.chatId!, refs?.reviewId, workspace!));
    // The one place that marks refs as checked.
    return { ...refs, projectId, documentId, chatId, dropped: dropped.sort() } as unknown as AuthorisedAuditRefs;
}
