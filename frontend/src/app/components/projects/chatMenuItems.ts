/** Ids of the project chat header menu entries. Labels are translated, so visibility is decided by id. */
export type ChatMenuItemId = "openSideChat" | "closeSideChat" | "rename" | "memory" | "delete";

/** Whether the project chat header menu shows the entry `id`. */
export function isChatMenuItemVisible(
    id: ChatMenuItemId,
    state: { activeChatId: string | null | undefined; canRenameChat: boolean; canDeleteChat: boolean },
): boolean {
    const hasChat = !!state.activeChatId;
    if (id === "rename") return hasChat && state.canRenameChat;
    if (id === "delete") return hasChat && state.canDeleteChat;
    return true;
}
