import { beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.hoisted(() => ({ notifyInfo: vi.fn() }));
vi.mock("@mike/client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@mike/client")>()),
    ...notify,
}));

import { noticeStorageAlmostFull } from "./storageSpaceNotice";

describe("noticeStorageAlmostFull", () => {
    beforeEach(() => notify.notifyInfo.mockClear());

    it("says the person's own space and a firm's space in their own words, in words only", () => {
        noticeStorageAlmostFull({ kind: "personal", id: "user-1" });
        noticeStorageAlmostFull({ kind: "firm", id: "firm-1" });
        const [own, firm] = notify.notifyInfo.mock.calls.map(([text]) => String(text));
        expect(own).toMatch(/almost full/i);
        expect(own).toMatch(/refused/i);
        expect(own).toMatch(/already stored stays/i);
        expect(own).not.toMatch(/firm/i);
        expect(firm).toMatch(/firm's space is almost full/i);
        expect(firm).toMatch(/owner or administrator/i);
    });

    it("does not say it again for the same space until the page is reloaded", () => {
        noticeStorageAlmostFull({ kind: "firm", id: "firm-2" });
        noticeStorageAlmostFull({ kind: "firm", id: "firm-2" });
        noticeStorageAlmostFull({ kind: "firm", id: "firm-3" });
        expect(notify.notifyInfo).toHaveBeenCalledTimes(2);
    });
});
