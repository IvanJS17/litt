// The key that work a connected app starts runs on when the app names none.
//
// Every tool that has LiTT run model work and hands a key reference to the
// service (`credential_ref`) gets it here, so a new tool has one place to ask.
// The usable keys are the ones the web's key selector lists
// (`listChatCredentialOptions`: membership, the firm's personal-keys policy,
// managed accounts, key versions); this only chooses among them:
//
//   in a firm's workspace the firm's key runs the work a connected app starts,
//   then the person's own key (listed only where the firm allows it), then the
//   deployment's or operator's; in the personal workspace the person's own
//   key, then the deployment's or operator's.
//
// Without a usable key it returns nothing and the service refuses as before.
// The reference is passed where an explicit one would be, so every check the
// service makes on a named key still runs on it.

import { listChatCredentialOptions, resolveUserChatSelection, type ChatCredentialOption } from "../user/user.service";
import { PERSONAL_WORKSPACE } from "./mcp.principal";
import type { McpCall } from "./mcp.tools";

/** The organization a workspace id stands for; the personal workspace has none. */
export const workspaceOrgId = (workspace: string): string | null => (workspace === PERSONAL_WORKSPACE ? null : workspace);

type Source = ChatCredentialOption["source"];

/** Which sources to take, in order, for work in a firm or in the personal workspace. */
const ORDER: Record<"firm" | "personal", readonly Source[]> = {
    firm: ["organization", "personal", "deployment", "operator"],
    personal: ["personal", "deployment", "operator"],
};

/**
 * The credential reference for work this call starts for `orgId` (the
 * organization the work will belong to; null for the personal workspace) on
 * `model`, or the person's usual model when none is named.
 */
export async function defaultKeyFor(
    call: McpCall,
    args: { model?: string | null; orgId: string | null },
): Promise<string | undefined> {
    const { db } = call;
    const userId = call.principal.userId;
    let model = args.model?.trim() || null;
    if (!model) {
        const selection = await resolveUserChatSelection(db, { userId, orgId: args.orgId });
        if (!selection.ok) return undefined;
        model = selection.selectedModel;
    }
    const listed = await listChatCredentialOptions(db, { userId, orgId: args.orgId, model });
    if (!listed) return undefined;
    for (const source of ORDER[args.orgId ? "firm" : "personal"]) {
        const option = listed.options.find((candidate) => candidate.source === source);
        if (option) return option.credential_ref;
    }
    return undefined;
}
