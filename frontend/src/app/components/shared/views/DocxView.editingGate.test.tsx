import { useEffect, useRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authenticatedFetch } from "@/app/lib/authEvents";
import type { DocxRendererProps } from "./DocxRenderer.types";
import { DocxView } from "./DocxView";

// LiTT ledger §16.3 "DOCX viewer and editor": the viewer is adopted, editing
// and autosave stay off by default.

const replaceVersion = vi.hoisted(() => vi.fn());

vi.mock("@/app/lib/authEvents", () => ({ authenticatedFetch: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({
    getDocumentFileUrl: (id: string) => "/api/document/" + id,
    replaceDocumentVersionFile: replaceVersion,
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
    replaceVersion.mockReset();
    vi.mocked(authenticatedFetch).mockReset();
    vi.mocked(authenticatedFetch).mockResolvedValue(new Response(new Uint8Array([1])));
});
afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
});

it("opens a document read-only by default even for an editor", async () => {
    render(<DocxView documentId="doc-1" versionId="v1" canEdit defaultMode="edit" />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.mode).toBe("view");
    expect(renderer.dataset.toolbar).toBe("false");
    expect(replaceVersion).not.toHaveBeenCalled();
});

it("offers editing only when the operator turned the gate on", async () => {
    vi.stubEnv("NEXT_PUBLIC_LITT_DOCX_EDITING", "enabled");
    render(<DocxView documentId="doc-1" versionId="v1" canEdit defaultMode="edit" />);
    const renderer = await screen.findByTestId("renderer");
    expect(renderer.dataset.mode).toBe("edit");
    expect(renderer.dataset.toolbar).toBe("true");
});
