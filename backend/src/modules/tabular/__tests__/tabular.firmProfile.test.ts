import { describe, expect, it } from "vitest";
import { buildFirmProfilePrompt } from "../../chat/chat.service";
import { buildTabularMessages } from "../tabular.chats";

const store = { columns: [], documents: [], cells: new Map() } as never;
const user = [{ role: "user", content: "hola" }] as never;

describe("tabular chat context", () => {
    it("carries the firm profile block when the review belongs to a firm", () => {
        const block = buildFirmProfilePrompt({ size: "6-20" }, "n1");
        const [system] = buildTabularMessages(user, store, "Revisión", undefined, block) as { content: string }[];
        expect(system.content).toContain("FIRM PROFILE");
        expect(system.content).toContain('"lawyers": "6-20"');
    });

    it("carries none for a personal review", () => {
        const [system] = buildTabularMessages(user, store, "Revisión", undefined, "") as { content: string }[];
        expect(system.content).not.toContain("FIRM PROFILE");
        const [plain] = buildTabularMessages(user, store, "Revisión") as { content: string }[];
        expect(plain.content).not.toContain("FIRM PROFILE");
    });
});
