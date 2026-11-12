import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DOCX_AUTOSAVE_DELAY, useDocxAutosave } from "./useDocxAutosave";
import { listDocumentVersions, saveDocxVersion } from "@/app/lib/mikeApi";
import { UploadBatchError } from "@mike/client";
import { invalidateDocxBytes } from "./useFetchDocxBytes";

vi.mock("@/app/lib/mikeApi", () => ({
    listDocumentVersions: vi.fn(), saveDocxVersion: vi.fn(),
    MikeApiError: class extends Error {},
}));
vi.mock("./useFetchDocxBytes", () => ({ invalidateDocxBytes: vi.fn() }));
const original = new Uint8Array([1]).buffer;
const edited = new Uint8Array([2]).buffer;
let saves = 0;
const exportDocx = vi.fn<() => Promise<ArrayBuffer>>();
const options = () => ({ documentId: "doc", versionId: "v1", filename: "Agreement.docx", bytes: original, enabled: true, exportDocx });
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    saves = 0;
    exportDocx.mockResolvedValue(edited);
    vi.mocked(saveDocxVersion).mockImplementation(async () => ({ id: `v${++saves + 1}`, version_number: saves + 1, source: "user_edit", created_at: "", filename: "Agreement.docx" }));
    vi.mocked(listDocumentVersions).mockResolvedValue({ current_version_id: "v1", versions: [] });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("debounces edits, saves a NEW version on top of the open one, and evicts cached bytes", async () => {
    const { result } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    act(() => result.current.markChanged());
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(saveDocxVersion).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(DOCX_AUTOSAVE_DELAY); await result.current.save(); });
    expect(saveDocxVersion).toHaveBeenCalledExactlyOnceWith("doc", "v1", expect.objectContaining({ name: "Agreement.docx", size: 1 }));
    expect(result.current).toMatchObject({ dirty: false, status: "saved", error: null });
    expect(invalidateDocxBytes).toHaveBeenCalledWith("doc");
});

it("serializes saves and builds the next save on the version the previous one created", async () => {
    let finish!: () => void;
    vi.mocked(saveDocxVersion).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ id: "v2", version_number: 2, source: "user_edit", created_at: "", filename: "Agreement.docx" }); }));
    const { result } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    let pending!: Promise<void>;
    await act(async () => { pending = result.current.save(); await vi.waitFor(() => expect(saveDocxVersion).toHaveBeenCalledOnce()); });
    exportDocx.mockResolvedValue(new Uint8Array([3]).buffer);
    act(() => result.current.markChanged());
    expect(result.current.dirty).toBe(true);
    expect(result.current.save()).toBe(pending);
    await act(async () => { finish(); await pending; });
    expect(saveDocxVersion).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveDocxVersion).mock.calls[0][1]).toBe("v1");
    expect(vi.mocked(saveDocxVersion).mock.calls[1][1]).toBe("v2");
    expect(result.current.dirty).toBe(false);
});

it("retains dirty state on conflict and does not retry automatically", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(new UploadBatchError("internal details", [{ clientId: "a", filename: "a.docx", status: "error", result: null, errorCode: "document_changed" }]));
    const { result } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    expect(result.current.error).toMatch(/changed elsewhere/);
    expect(result.current.dirty).toBe(true);
    act(() => result.current.markChanged());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(saveDocxVersion).toHaveBeenCalledOnce();
    await act(() => result.current.save());
    expect(result.current).toMatchObject({ dirty: false, status: "saved" });
});

it("keeps a failed save retryable and resolves an unpinned version before writing", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(new Error("private storage detail"));
    const { result } = renderHook(() => useDocxAutosave({ ...options(), versionId: null }));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    expect(result.current.error).toMatch(/could not be saved/);
    expect(result.current.error).not.toMatch(/private/);
    expect(result.current.dirty).toBe(true);
    await act(() => result.current.save());
    expect(listDocumentVersions).toHaveBeenCalledOnce();
    expect(result.current.dirty).toBe(false);
});

it("does not upload local previews or unchanged documents", async () => {
    const { result } = renderHook(() => useDocxAutosave({ ...options(), enabled: false }));
    await act(() => result.current.save());
    act(() => result.current.markChanged());
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    await act(() => result.current.save());
    expect(saveDocxVersion).not.toHaveBeenCalled();
});

it("flushes a pending edit when its viewer unmounts", async () => {
    const { result, unmount } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    unmount();
    await vi.waitFor(() => expect(saveDocxVersion).toHaveBeenCalledOnce());
});

it("retries a failed save when its viewer closes, so the edits are not dropped", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(new Error("network"));
    const { result, unmount } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    expect(result.current.status).toBe("error");
    unmount();
    await vi.waitFor(() => expect(saveDocxVersion).toHaveBeenCalledTimes(2));
});

it("does not retry a conflicting save when its viewer closes", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(new UploadBatchError("internal details", [{ clientId: "a", filename: "a.docx", status: "error", result: null, errorCode: "document_changed" }]));
    const { result, unmount } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(saveDocxVersion).toHaveBeenCalledOnce();
});

it("keeps failed and conflicting drafts open until saved or explicitly discarded", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(new Error("network"));
    const { result, unmount } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(async () => { expect(await result.current.prepareClose()).toBe(false); });
    expect(result.current.hasUnsavedChanges()).toBe(true);
    await act(async () => { expect(await result.current.prepareClose()).toBe(true); });
    expect(result.current.hasUnsavedChanges()).toBe(false);
    act(() => result.current.markChanged());
    act(() => result.current.discard());
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(saveDocxVersion).toHaveBeenCalledTimes(2);
});

it("treats the server's version-conflict code as a conflict and does not retry it", async () => {
    vi.mocked(saveDocxVersion).mockRejectedValueOnce(Object.assign(new Error("409"), { code: "document_version_conflict" }));
    const { result, unmount } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    expect(result.current.error).toMatch(/changed elsewhere/);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(saveDocxVersion).toHaveBeenCalledOnce();
});

it("never rolls the editor back to a pinned version after saving a newer one", async () => {
    const { result } = renderHook(() => useDocxAutosave(options()));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    // The pinned version v1 is refetched later: its bytes predate the saved edits.
    expect(result.current.adoptSnapshot(new Uint8Array([9]).buffer, result.current.captureSnapshotRevision())).toBe(false);
});

it("adopts a different snapshot of an unpinned document and saves on top of the latest version", async () => {
    const { result } = renderHook(() => useDocxAutosave({ ...options(), versionId: null }));
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    expect(listDocumentVersions).toHaveBeenCalledOnce();
    expect(result.current.adoptSnapshot(new Uint8Array([9]).buffer, result.current.captureSnapshotRevision())).toBe(true);
    exportDocx.mockResolvedValue(new Uint8Array([4]).buffer);
    act(() => result.current.markChanged());
    await act(() => result.current.save());
    // The base was re-resolved, not carried over from the save before the new snapshot.
    expect(listDocumentVersions).toHaveBeenCalledTimes(2);
});
