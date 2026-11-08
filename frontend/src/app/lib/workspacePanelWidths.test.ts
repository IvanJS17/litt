import { describe, expect, it } from "vitest";
import {
    fitPanelWidths,
    fitsAtMinimum,
    resizeChatSplit,
    resizePanel,
    workspaceRoom,
    workspaceView,
} from "./workspacePanelWidths";

const widths = { explorer: 280, chat: 420, sideChat: 420 };
const oneChat = { explorerCollapsed: false, sideChatOpen: false };
const twoChats = { explorerCollapsed: false, sideChatOpen: true };

/** What is left for the document view. */
function documentWidth(
    fitted: typeof widths,
    workspaceWidth: number,
    layout: typeof oneChat,
) {
    return (
        workspaceWidth -
        (layout.explorerCollapsed ? 42 : fitted.explorer + 12) -
        fitted.chat -
        (layout.sideChatOpen ? fitted.sideChat + 6 : 0)
    );
}

describe("fitPanelWidths", () => {
    it("leaves panels that fit alone", () => {
        expect(fitPanelWidths(widths, 1400, oneChat)).toBe(widths);
        expect(fitPanelWidths(widths, 1600, twoChats)).toBe(widths);
    });

    it("ignores a closed side chat", () => {
        // 280 + 420 + 12 leaves the document 388 of 1100.
        expect(fitPanelWidths(widths, 1100, oneChat)).toBe(widths);
    });

    it("narrows the panels when a second chat opens, keeping the document's minimum", () => {
        const fitted = fitPanelWidths(widths, 1300, twoChats);
        expect(fitted.explorer).toBeLessThan(widths.explorer);
        expect(fitted.chat).toBeLessThan(widths.chat);
        expect(fitted.sideChat).toBeLessThan(widths.sideChat);
        expect(documentWidth(fitted, 1300, twoChats)).toBeCloseTo(320);
    });

    it("stops at each panel's minimum", () => {
        expect(fitPanelWidths(widths, 900, twoChats)).toEqual({
            explorer: 160,
            chat: 320,
            sideChat: 320,
        });
    });

    it("leaves a collapsed explorer's width untouched", () => {
        const collapsed = { explorerCollapsed: true, sideChatOpen: true };
        const fitted = fitPanelWidths(widths, 1100, collapsed);
        expect(fitted.explorer).toBe(280);
        expect(documentWidth(fitted, 1100, collapsed)).toBeCloseTo(320);
    });
});

describe("resizePanel", () => {
    it("holds a panel to what the others and the document leave", () => {
        // 1400 - 320 (document) - 18 (dividers) - 280 - 420 = 362.
        expect(resizePanel(widths, "chat", 900, 1400, twoChats).chat).toBe(362);
        expect(resizePanel(widths, "chat", 900, 1400, oneChat).chat).toBe(788);
    });

    it("never goes below the panel's minimum", () => {
        expect(resizePanel(widths, "chat", 10, 1400, oneChat).chat).toBe(320);
        expect(
            resizePanel(widths, "explorer", 10, undefined, oneChat).explorer,
        ).toBe(160);
    });
});

describe("resizeChatSplit", () => {
    it("trades width between the chats, leaving the document alone", () => {
        expect(resizeChatSplit(widths, 50)).toEqual({
            explorer: 280,
            chat: 470,
            sideChat: 370,
        });
    });

    it("keeps both chats at their minimum", () => {
        expect(resizeChatSplit(widths, 500).sideChat).toBe(320);
        expect(resizeChatSplit(widths, -500).chat).toBe(320);
    });
});

describe("panels with nothing left to give or take", () => {
    const atMinimum = { explorer: 160, chat: 320, sideChat: 320 };

    it("leaves panels already at their minimum alone, however little room there is", () => {
        expect(fitPanelWidths(atMinimum, 900, twoChats)).toBe(atMinimum);
    });

    it("fits a single chat beside a collapsed explorer", () => {
        const collapsed = { explorerCollapsed: true, sideChatOpen: false };
        // 800 - 320 (document) - 42 (collapsed explorer) = 438 for the chat.
        expect(
            fitPanelWidths({ ...widths, chat: 600 }, 800, collapsed).chat,
        ).toBeCloseTo(438);
        expect(resizePanel(widths, "chat", 900, 800, collapsed).chat).toBe(438);
    });

    it("returns the same widths when a resize changes nothing", () => {
        expect(resizePanel(widths, "chat", 420, 1400, oneChat)).toBe(widths);
        expect(resizeChatSplit(widths, 0)).toBe(widths);
        // Already at its minimum: it cannot give any more to the other.
        const sideAtMinimum = { ...widths, sideChat: 320 };
        expect(resizeChatSplit(sideAtMinimum, 40)).toBe(sideAtMinimum);
    });

    it("does not split two chats that are both below their minimum", () => {
        const cramped = { explorer: 160, chat: 300, sideChat: 300 };
        expect(resizeChatSplit(cramped, 20)).toBe(cramped);
    });
});

describe("fitsAtMinimum", () => {
    it("says when a second chat needs the explorer's room", () => {
        expect(fitsAtMinimum(1100, oneChat)).toBe(true);
        expect(fitsAtMinimum(1100, twoChats)).toBe(false);
        expect(fitsAtMinimum(1200, twoChats)).toBe(true);
    });

    it("needs less room when the explorer is folded", () => {
        const folded = { explorerCollapsed: true, sideChatOpen: true };
        // Document 320 + two chats 640 + folded explorer 42 + divider 6.
        expect(fitsAtMinimum(1007, folded)).toBe(false);
        expect(fitsAtMinimum(1008, folded)).toBe(true);
    });
});

describe("workspaceRoom", () => {
    // Explorer 160 + document 320 + chat 320 + two 6 px dividers = 812; a
    // second chat adds 320 + 6 = 1138.
    it("splits the workspace only where every panel fits at its minimum", () => {
        // A 768 px tablet with the sidebar folded leaves about 690 px.
        expect(workspaceRoom(690)).toBe("single");
        expect(workspaceRoom(811)).toBe("single");
        expect(workspaceRoom(812)).toBe("split");
        expect(workspaceRoom(1137)).toBe("split");
        expect(workspaceRoom(1138)).toBe("splitWithSideChat");
    });
});

describe("workspaceRoom with a folded explorer", () => {
    // Folded explorer 42 + document 320 + chat 320 = 682; a second chat adds
    // 320 + 6 = 1008.
    it("offers the side chat where the open explorer would not fit it", () => {
        expect(workspaceRoom(1007, true)).toBe("split");
        expect(workspaceRoom(1008, true)).toBe("splitWithSideChat");
        expect(workspaceRoom(1008, false)).toBe("split");
        expect(workspaceRoom(681, true)).toBe("single");
        expect(workspaceRoom(682, true)).toBe("split");
    });
});

describe("workspaceView", () => {
    it("leaves the layout to the CSS until the room is measured", () => {
        expect(workspaceView(null, false)).toEqual({
            singleView: false,
            sideChatShown: true,
            closeSideChat: false,
        });
        // A side chat in the address is kept until we know it cannot fit.
        expect(workspaceView(null, true).closeSideChat).toBe(false);
    });

    it("shows the panels side by side where they fit", () => {
        expect(workspaceView("split", false)).toEqual({
            singleView: false,
            sideChatShown: false,
            closeSideChat: false,
        });
        expect(workspaceView("splitWithSideChat", true)).toEqual({
            singleView: false,
            sideChatShown: true,
            closeSideChat: false,
        });
    });

    it("closes an open side chat that stops fitting", () => {
        expect(workspaceView("split", true)).toEqual({
            singleView: true,
            sideChatShown: false,
            closeSideChat: true,
        });
        expect(workspaceView("single", true).closeSideChat).toBe(true);
        expect(workspaceView("single", false).closeSideChat).toBe(false);
    });
});
