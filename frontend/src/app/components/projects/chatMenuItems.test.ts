import { describe, expect, it } from "vitest";
import { isChatMenuItemVisible, type ChatMenuItemId } from "./chatMenuItems";

const all: ChatMenuItemId[] = ["openSideChat", "closeSideChat", "rename", "memory", "delete"];
const visible = (state: Parameters<typeof isChatMenuItemVisible>[1]) => all.filter((id) => isChatMenuItemVisible(id, state));

describe("isChatMenuItemVisible", () => {
    it("keeps memory and the side chat entries without an active chat", () => {
        expect(visible({ activeChatId: null, canRenameChat: true, canDeleteChat: true })).toEqual(["openSideChat", "closeSideChat", "memory"]);
    });

    it("shows rename and delete only with an active chat and the right role", () => {
        expect(visible({ activeChatId: "c1", canRenameChat: true, canDeleteChat: false })).toEqual(["openSideChat", "closeSideChat", "rename", "memory"]);
        expect(visible({ activeChatId: "c1", canRenameChat: false, canDeleteChat: true })).toEqual(["openSideChat", "closeSideChat", "memory", "delete"]);
    });
});
