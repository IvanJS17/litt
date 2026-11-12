import { useEffect, useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/app/lib/authEvents";
import type { DocxRendererProps, DocxSaveState } from "./DocxRenderer.types";
import { DocxView } from "./DocxView";

// LiTT ledger §16.3 "DOCX viewer and editor": editing is on for whoever may
// write (the caller's `canEdit`); every save is a new version.

const saveVersion = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/authEvents", () => ({ authenticatedFetch: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({
    getDocumentFileUrl: (id: string) => "/api/document/" + id,
    saveDocxVersion: saveVersion,
    listDocumentVersions: vi.fn().mockResolvedValue({ current_version_id: "v1", versions: [] }),
    MikeApiError: class extends Error {},
}));
vi.mock("./EigenpalDocxRenderer", () => ({
    default: (props: DocxRendererProps) => <MockRenderer {...props} />,
}));

function MockRenderer({ mode, toolbarVisible = true, onChange, onReady }: DocxRendererProps) {
    const scroll = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (scroll.current && content.current) onReady({ scroll: scroll.current, content: content.current, exportDocx: async () => new Uint8Array([2]).buffer });
    }, [onReady]);
    return (
        <div ref={scroll} data-testid="renderer" data-mode={mode} data-toolbar={String(toolbarVisible)}>
            <div ref={content}>Agreement</div>
            <button type="button" onClick={onChange}>type</button>
        </div>
    );
}

beforeEach(() => {
    saveVersion.mockReset();
    saveVersion.mockResolvedValue({ id: "v2", version_number: 2, source: "user_edit", created_at: "", filename: "a.docx" });
    vi.mocked(authenticatedFetch).mockReset();
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(new Uint8Array([1])));
});
afterEach(cleanup);

it("opens in edit mode with the toolbar for someone who may write", async () => {
    render(<DocxView documentId="doc-1" versionId="v1" canEdit defaultMode="edit" />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.mode).toBe("edit");
    expect(renderer.dataset.toolbar).toBe("true");
});

it("stays read-only, without the toolbar and without saving, when the caller may not write", async () => {
    render(<DocxView documentId="doc-1" versionId="v1" canEdit={false} defaultMode="edit" toolbarVisible />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.toolbar).toBe("false");
    expect(saveVersion).not.toHaveBeenCalled();
});

it("does not save by itself; the exposed save writes one version, once", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
        const states: (DocxSaveState | null)[] = [];
        render(<DocxView documentId="doc-1" versionId="v1" canEdit defaultMode="edit" onSaveStateChange={(_id, state) => states.push(state)} />);
        fireEvent.click(await screen.findByText("type"));
        await act(() => vi.advanceTimersByTimeAsync(60_000));
        expect(saveVersion).not.toHaveBeenCalled();
        expect(states.at(-1)).toMatchObject({ editable: true, dirty: true });
        await act(async () => { await states.at(-1)!.save!(); });
        expect(saveVersion).toHaveBeenCalledOnce();
        expect(states.at(-1)).toMatchObject({ dirty: false, status: "saved" });
    } finally {
        vi.useRealTimers();
    }
});

it("reports a reader, by omission or canEdit={false}, as not editable and ignores edits", async () => {
    const states: (DocxSaveState | null)[] = [];
    const { unmount } = render(<DocxView documentId="doc-1" versionId="v1" onSaveStateChange={(_id, state) => states.push(state)} />);
    fireEvent.click(await screen.findByText("type"));
    expect(states.at(-1)).toMatchObject({ editable: false, dirty: false });
    expect((await screen.findByTestId("renderer")).dataset.toolbar).toBe("false");
    unmount();
    expect(saveVersion).not.toHaveBeenCalled();
});

it("opens in view mode unless the caller asks for edit mode", async () => {
    render(<DocxView documentId="doc-1" versionId="v1" />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.mode).toBe("view");
    expect(saveVersion).not.toHaveBeenCalled();
});
