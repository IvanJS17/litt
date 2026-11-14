import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// runUserExport drives the three durable-export wrappers, so swap the API
// module for hoisted spies the tests can re-use across a vi.resetModules()
// (the poll-interval case re-imports the module under test).
const { startUserExportMock, getUserExportStatusMock, downloadUserExportMock } =
    vi.hoisted(() => ({
        startUserExportMock: vi.fn(),
        getUserExportStatusMock: vi.fn(),
        downloadUserExportMock: vi.fn(),
    }));
vi.mock("@/app/lib/mikeApi", () => ({
    startUserExport: startUserExportMock,
    getUserExportStatus: getUserExportStatusMock,
    downloadUserExport: downloadUserExportMock,
}));

import { runUserExport } from "./asyncExport";

beforeEach(() => {
    startUserExportMock.mockResolvedValue({ export_id: "exp-1" });
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe("runUserExport", () => {
    it("schedules the job, polls past pending, then downloads the artifact", async () => {
        const downloaded = new Blob(["csv-bytes"]);
        getUserExportStatusMock
            .mockResolvedValueOnce({ status: "pending" })
            .mockResolvedValueOnce({ status: "done", filename: "status.csv" });
        downloadUserExportMock.mockResolvedValue({
            blob: downloaded,
            filename: "download.csv",
        });

        const { blob, filename } = await runUserExport("audit-csv", {
            q: "agreement",
        });

        expect(startUserExportMock).toHaveBeenCalledWith("audit-csv", {
            q: "agreement",
        });
        expect(getUserExportStatusMock).toHaveBeenCalledTimes(2);
        expect(getUserExportStatusMock).toHaveBeenLastCalledWith("exp-1");
        expect(downloadUserExportMock).toHaveBeenCalledWith("exp-1");
        // The download's own content-disposition wins over the status record.
        expect(filename).toBe("download.csv");
        expect(blob).toBe(downloaded);
    });

    it("falls back to the status filename when the download omits one", async () => {
        getUserExportStatusMock.mockResolvedValue({
            status: "done",
            filename: "status.csv",
        });
        downloadUserExportMock.mockResolvedValue({
            blob: new Blob(["z"]),
            filename: null,
        });

        // No params: whole-account exports pass nothing through.
        await expect(runUserExport("account")).resolves.toMatchObject({
            filename: "status.csv",
        });
        expect(startUserExportMock).toHaveBeenCalledWith("account", undefined);
    });

    it("keeps a null filename when neither half of the flow supplies one", async () => {
        getUserExportStatusMock.mockResolvedValue({
            status: "done",
            filename: null,
        });
        downloadUserExportMock.mockResolvedValue({
            blob: new Blob(["z"]),
            filename: null,
        });

        await expect(runUserExport("chats")).resolves.toMatchObject({
            filename: null,
        });
    });

    it("throws without downloading when the backend build fails", async () => {
        getUserExportStatusMock.mockResolvedValue({ status: "failed" });

        // The wording is shown as is: say what failed and that retrying helps.
        await expect(runUserExport("documents-zip")).rejects.toMatchObject({
            name: "UserVisibleError",
            message:
                "LiTT couldn't build the export. Try again, and contact support if it keeps happening.",
            retryable: true,
        });
        expect(downloadUserExportMock).not.toHaveBeenCalled();
    });

    it("gives up after the poll limit instead of polling forever", async () => {
        getUserExportStatusMock.mockResolvedValue({ status: "pending" });

        await expect(runUserExport("tabular-reviews")).rejects.toMatchObject({
            name: "UserVisibleError",
            message:
                "The export is taking longer than expected. It may still be building, so try again in a few minutes.",
            retryable: true,
        });
        expect(getUserExportStatusMock).toHaveBeenCalledTimes(150);
        expect(downloadUserExportMock).not.toHaveBeenCalled();
    });

    it("stops polling and downloads nothing once its caller aborts", async () => {
        getUserExportStatusMock.mockResolvedValue({ status: "pending" });
        vi.useFakeTimers();
        const controller = new AbortController();

        const pending = runUserExport("audit-csv", undefined, controller.signal);
        const settled = pending.catch((error: unknown) => error);
        await vi.advanceTimersByTimeAsync(10);
        expect(getUserExportStatusMock).toHaveBeenCalledTimes(1);

        controller.abort();
        expect(await settled).toMatchObject({ name: "AbortError" });
        // A hundred more poll intervals pass and nothing else is asked for.
        await vi.advanceTimersByTimeAsync(1000);
        expect(getUserExportStatusMock).toHaveBeenCalledTimes(1);
        expect(downloadUserExportMock).not.toHaveBeenCalled();
    });

    it("does not download a finished export its caller abandoned meanwhile", async () => {
        const controller = new AbortController();
        getUserExportStatusMock.mockImplementation(async () => {
            controller.abort();
            return { status: "done", filename: "late.csv" };
        });

        await expect(
            runUserExport("audit-csv", undefined, controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(downloadUserExportMock).not.toHaveBeenCalled();
    });

    it("asks for no status when its caller aborts while the job is scheduled", async () => {
        const controller = new AbortController();
        startUserExportMock.mockImplementation(async () => {
            controller.abort();
            return { export_id: "exp-1" };
        });

        await expect(
            runUserExport("audit-csv", undefined, controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(getUserExportStatusMock).not.toHaveBeenCalled();
    });

    it("hands back no file when its caller aborts during the download", async () => {
        const controller = new AbortController();
        getUserExportStatusMock.mockResolvedValue({ status: "done", filename: "late.csv" });
        downloadUserExportMock.mockImplementation(async () => {
            controller.abort();
            return { blob: new Blob(["z"]), filename: "late.csv" };
        });

        await expect(
            runUserExport("audit-csv", undefined, controller.signal),
        ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("polls at the interactive 2s rate outside the test environment", async () => {
        getUserExportStatusMock.mockResolvedValue({
            status: "done",
            filename: "slow.csv",
        });
        downloadUserExportMock.mockResolvedValue({
            blob: new Blob(["z"]),
            filename: null,
        });

        // POLL_MS is picked at module load, so re-evaluate the module with a
        // non-test NODE_ENV to exercise the interactive interval.
        vi.resetModules();
        vi.stubEnv("NODE_ENV", "production");
        const { runUserExport: runProdExport } = await import("./asyncExport");
        vi.useFakeTimers();

        const pending = runProdExport("account");
        await vi.advanceTimersByTimeAsync(1999);
        expect(getUserExportStatusMock).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toMatchObject({ filename: "slow.csv" });
    });
});
