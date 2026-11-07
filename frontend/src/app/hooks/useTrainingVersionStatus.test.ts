import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listDocumentVersions = vi.fn();
vi.mock("@/app/lib/mikeApi", () => ({
    listDocumentVersions: (...args: unknown[]) => listDocumentVersions(...args),
}));

import { useTrainingVersionStatus } from "./useTrainingVersionStatus";

const versions = (held: boolean, canApprove = false) => ({
    current_version_id: "v2",
    versions: [
        { id: "v1", training_held: false },
        { id: "v2", training_held: held, training_can_approve: canApprove },
    ],
});

beforeEach(() => listDocumentVersions.mockReset());

describe("useTrainingVersionStatus", () => {
    it("is unknown until the versions load, then speaks for the current version", async () => {
        listDocumentVersions.mockResolvedValue(versions(true, true));
        const { result } = renderHook(() => useTrainingVersionStatus("doc", null));
        expect(result.current.release).toBe("unknown");
        await waitFor(() => expect(result.current.release).toBe("held"));
        expect(result.current).toMatchObject({ versionId: "v2", canApprove: true });
        expect(listDocumentVersions).toHaveBeenCalledWith("doc");
    });

    it("reads the version asked for and reloads on refresh", async () => {
        listDocumentVersions.mockResolvedValue(versions(true));
        const { result } = renderHook(() => useTrainingVersionStatus("doc", "v1"));
        await waitFor(() => expect(result.current.release).toBe("released"));
        expect(result.current.versionId).toBe("v1");
        act(() => result.current.refresh());
        await waitFor(() => expect(listDocumentVersions).toHaveBeenCalledTimes(2));
    });

    it("stays unknown for a version it cannot find or when the read fails", async () => {
        listDocumentVersions.mockResolvedValueOnce(versions(false));
        const missing = renderHook(() => useTrainingVersionStatus("doc", "gone"));
        await waitFor(() => expect(listDocumentVersions).toHaveBeenCalledTimes(1));
        await act(async () => {});
        expect(missing.result.current).toMatchObject({ release: "unknown", versionId: "gone", canApprove: false });

        listDocumentVersions.mockRejectedValueOnce(new Error("offline"));
        const failed = renderHook(() => useTrainingVersionStatus("doc", null));
        await waitFor(() => expect(listDocumentVersions).toHaveBeenCalledTimes(2));
        await act(async () => {});
        expect(failed.result.current.release).toBe("unknown");
    });

    it("does nothing when disabled and ignores an answer that arrives after unmount", async () => {
        const disabled = renderHook(() => useTrainingVersionStatus("doc", null, false));
        expect(disabled.result.current.release).toBe("released");
        expect(listDocumentVersions).not.toHaveBeenCalled();

        let resolve!: (value: unknown) => void;
        let reject!: (reason: unknown) => void;
        listDocumentVersions
            .mockReturnValueOnce(new Promise((ok) => { resolve = ok; }))
            .mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
        const first = renderHook(() => useTrainingVersionStatus("doc", null));
        first.unmount();
        const second = renderHook(() => useTrainingVersionStatus("doc", "v1"));
        second.unmount();
        await act(async () => {
            resolve(versions(true));
            reject(new Error("late"));
        });
        expect(first.result.current.release).toBe("unknown");
        expect(second.result.current.release).toBe("unknown");
    });
});
