import { afterEach, describe, expect, it, vi } from "vitest";

const { runUserExportMock } = vi.hoisted(() => ({ runUserExportMock: vi.fn() }));
vi.mock("@/app/lib/asyncExport", () => ({ runUserExport: runUserExportMock }));

import { saveUserExport } from "./userExportDownload";

function captureDownloads() {
    const names: string[] = [];
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:litt"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        names.push(this.download);
    });
    return names;
}

afterEach(() => {
    vi.restoreAllMocks();
    runUserExportMock.mockReset();
});

describe("saveUserExport", () => {
    it("builds the export with the given scope and saves it under the server's name", async () => {
        const names = captureDownloads();
        runUserExportMock.mockResolvedValue({ blob: new Blob(["{}"]), filename: "server.json" });

        await saveUserExport("account", { workspace: "personal" }, "fallback.json");

        expect(runUserExportMock).toHaveBeenCalledWith("account", { workspace: "personal" });
        expect(names).toEqual(["server.json"]);
    });

    it("uses the fallback name when the server sends none", async () => {
        const names = captureDownloads();
        runUserExportMock.mockResolvedValue({ blob: new Blob(["{}"]), filename: null });

        await saveUserExport("account", {}, "fallback.json");

        expect(names).toEqual(["fallback.json"]);
    });

    it("saves nothing when the export fails", async () => {
        const names = captureDownloads();
        runUserExportMock.mockRejectedValue(new Error("failed"));

        await expect(saveUserExport("account", {}, "fallback.json")).rejects.toThrow("failed");
        expect(names).toEqual([]);
    });
});
