import { useEffect, useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/app/lib/authEvents";
import type { DocxRendererProps } from "./DocxRenderer.types";
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

function MockRenderer({ mode, toolbarVisible = true, onReady }: DocxRendererProps) {
    const scroll = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (scroll.current && content.current) onReady({ scroll: scroll.current, content: content.current });
    }, [onReady]);
    return (
        <div ref={scroll} data-testid="renderer" data-mode={mode} data-toolbar={String(toolbarVisible)}>
            <div ref={content}>Agreement</div>
        </div>
    );
}

beforeEach(() => {
    saveVersion.mockReset();
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

it("opens in view mode unless the caller asks for edit mode", async () => {
    render(<DocxView documentId="doc-1" versionId="v1" />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.mode).toBe("view");
    expect(saveVersion).not.toHaveBeenCalled();
});
