import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MikeApiError } from "@/app/lib/mikeApi";
import { MarkdownView } from "./MarkdownView";

const mocks = vi.hoisted(() => ({
    getDocumentFile: vi.fn(),
    listDocumentVersions: vi.fn(),
    saveMarkdownVersion: vi.fn(),
    survives: vi.fn(),
    notifyError: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getDocumentFile: mocks.getDocumentFile,
    listDocumentVersions: mocks.listDocumentVersions,
    saveMarkdownVersion: mocks.saveMarkdownVersion,
}));
vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
    notifyError: mocks.notifyError,
}));
// The rich editor is TipTap; here it only needs to hand its text back.
vi.mock("@/app/components/ui/markdown-editor", () => ({
    markdownSurvivesRichEditing: mocks.survives,
    MarkdownEditor: ({
        value,
        onChange,
        ariaLabel,
    }: {
        value: string;
        onChange: (value: string) => void;
        ariaLabel: string;
    }) => (
        <textarea
            aria-label={ariaLabel}
            value={value}
            onChange={(event) => onChange(event.target.value)}
        />
    ),
}));

const SOURCE = "# Contrato\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[sitio](https://example.com)\n\n<script>alert(1)</script>";

function serve(text = SOURCE, current: string | null = "v2") {
    mocks.getDocumentFile.mockResolvedValue({
        blob: new Blob([text], { type: "text/markdown" }),
        filename: "contrato.md",
    });
    mocks.listDocumentVersions.mockResolvedValue({
        current_version_id: current,
        versions: [],
    });
}

const saved = {
    id: "v3",
    version_number: 3,
    source: "user_edit",
    created_at: "2026-11-11T00:00:00Z",
    filename: "contrato.md",
    file_type: "md" as const,
    size_bytes: 10,
};

beforeEach(() => {
    vi.clearAllMocks();
    mocks.survives.mockReturnValue(true);
    serve();
});
afterEach(() => vi.restoreAllMocks());

async function open(props: Partial<React.ComponentProps<typeof MarkdownView>> = {}) {
    const result = render(<MarkdownView documentId="doc" canEdit {...props} />);
    await screen.findByRole("heading", { name: "Contrato" });
    return result;
}

describe("MarkdownView reading", () => {
    it("shows the file with its formatting and never raw HTML", async () => {
        await open({ canEdit: false });
        expect(screen.getByRole("table")).toBeVisible();
        const link = screen.getByRole("link", { name: "sitio" });
        expect(link).toHaveAttribute("href", "https://example.com");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(document.querySelector("script")).toBeNull();
        expect(mocks.getDocumentFile).toHaveBeenCalledWith("doc", null);
        expect(mocks.listDocumentVersions).not.toHaveBeenCalled();
    });

    it("offers no Edit to someone who cannot upload versions", async () => {
        await open({ canEdit: false });
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });

    it("offers no Edit on an older version, which a save could not build on", async () => {
        await open({ versionId: "v1" });
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
        expect(mocks.getDocumentFile).toHaveBeenCalledWith("doc", "v1");
    });

    it("offers Edit on the current version, named or not", async () => {
        const { unmount } = await open({ versionId: "v2" });
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
        unmount();
        await open();
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    });

    it("waits on a skeleton and reports a file that cannot be read", async () => {
        mocks.getDocumentFile.mockRejectedValue(new Error("boom"));
        render(<MarkdownView documentId="doc" />);
        expect(screen.getByRole("status", { name: "Loading document" })).toBeVisible();
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "This Markdown file could not be loaded.",
        );
    });

    it("cannot edit when the current version is unknown", async () => {
        serve(SOURCE, null);
        await open();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    });
});

describe("MarkdownView editing", () => {
    it("saves the text as a new version built on the current one", async () => {
        const user = userEvent.setup();
        const onSaved = vi.fn();
        mocks.saveMarkdownVersion.mockResolvedValue(saved);
        await open({ onSaved });
        await user.click(screen.getByRole("button", { name: "Edit" }));
        const editor = screen.getByRole("textbox", { name: "Markdown editor" });
        expect(editor).toHaveValue(SOURCE);
        expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
        fireEvent.change(editor, { target: { value: "# Nuevo" } });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(mocks.saveMarkdownVersion).toHaveBeenCalledWith("doc", "# Nuevo", "v2"),
        );
        expect(onSaved).toHaveBeenCalledWith(saved);
        expect(await screen.findByRole("heading", { name: "Nuevo" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
    });

    it("builds the next save on the version it just made", async () => {
        const user = userEvent.setup();
        mocks.saveMarkdownVersion.mockResolvedValue(saved);
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Uno" },
        });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await screen.findByRole("heading", { name: "Uno" });
        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Dos" },
        });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
            expect(mocks.saveMarkdownVersion).toHaveBeenLastCalledWith("doc", "# Dos", "v3"),
        );
    });

    it("switches to the plain-text source and back", async () => {
        const user = userEvent.setup();
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        const modes = screen.getByRole("group", { name: "Editing mode" });
        expect(modes.querySelector('[aria-pressed="true"]')).toHaveTextContent("Formatted");
        await user.click(screen.getByRole("button", { name: "Text" }));
        const source = screen.getByRole("textbox", { name: "Markdown source" });
        fireEvent.change(source, { target: { value: "# Fuente" } });
        await user.click(screen.getByRole("button", { name: "Formatted" }));
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Fuente");
        await user.click(screen.getByRole("button", { name: "Formatted" }));
    });

    it("keeps the person in Text mode when formatting would change the Markdown", async () => {
        const user = userEvent.setup();
        mocks.survives.mockReturnValue(false);
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        expect(screen.getByRole("textbox", { name: "Markdown source" })).toBeVisible();
        expect(screen.getByRole("status")).toHaveTextContent(/would change this Markdown/);
        await user.click(screen.getByRole("button", { name: "Formatted" }));
        expect(screen.getByRole("textbox", { name: "Markdown source" })).toBeVisible();
        // Once the text is safe for the formatted editor, the switch works and the notice goes.
        mocks.survives.mockReturnValue(true);
        await user.click(screen.getByRole("button", { name: "Formatted" }));
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toBeVisible();
        expect(screen.queryByText(/would change this Markdown/)).toBeNull();
    });

    it("keeps the typed text on a conflict, offers to copy it, and reloads on request", async () => {
        const user = userEvent.setup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        mocks.saveMarkdownVersion.mockRejectedValue(
            new MikeApiError({ message: "x", status: 409, code: "document_version_conflict" }),
        );
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        const editor = screen.getByRole("textbox", { name: "Markdown editor" });
        fireEvent.change(editor, { target: { value: "# Mi trabajo" } });
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Someone saved another version; reload to see the changes.",
        );
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Mi trabajo");
        expect(mocks.notifyError).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Copy my text" }));
        expect(writeText).toHaveBeenCalledWith("# Mi trabajo");
        expect(await screen.findByText("Text copied")).toBeVisible();

        serve("# Del servidor", "v9");
        await user.click(screen.getByRole("button", { name: "Reload" }));
        expect(await screen.findByRole("heading", { name: "Del servidor" })).toBeVisible();
    });

    it("says so when the browser refuses to copy", async () => {
        const user = userEvent.setup();
        Object.defineProperty(navigator, "clipboard", {
            value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
            configurable: true,
        });
        mocks.saveMarkdownVersion.mockRejectedValue(
            new MikeApiError({ message: "x", status: 409, code: "document_version_conflict" }),
        );
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Otro" },
        });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await user.click(await screen.findByRole("button", { name: "Copy my text" }));
        expect(await screen.findByText(/did not allow copying/)).toBeVisible();
    });

    it("reports any other failure and keeps editing", async () => {
        const user = userEvent.setup();
        mocks.saveMarkdownVersion.mockRejectedValueOnce(new Error("down"));
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Otro" },
        });
        await user.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Otro");
        // Retry runs the same save again.
        mocks.saveMarkdownVersion.mockResolvedValueOnce(saved);
        await act(async () => mocks.notifyError.mock.calls[0][1].onRetry());
        await waitFor(() => expect(mocks.saveMarkdownVersion).toHaveBeenCalledTimes(2));
    });

    it("asks before throwing away unsaved text, and leaves quietly when nothing changed", async () => {
        const user = userEvent.setup();
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();

        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Cambiado" },
        });
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(await screen.findByText("Discard unsaved changes?")).toBeVisible();
        await user.click(screen.getByRole("button", { name: "Keep editing" }));
        expect(screen.getByRole("textbox", { name: "Markdown editor" })).toHaveValue("# Cambiado");
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        await user.click(screen.getByRole("button", { name: "Discard changes" }));
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Contrato" })).toBeVisible();
    });

    it("warns the browser before leaving with unsaved text", async () => {
        const user = userEvent.setup();
        await open();
        await user.click(screen.getByRole("button", { name: "Edit" }));
        const clean = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(clean);
        expect(clean.defaultPrevented).toBe(false);
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Cambiado" },
        });
        const dirty = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(dirty);
        expect(dirty.defaultPrevented).toBe(true);
    });

    it("lets the host see unsaved text and refuses to close over it", async () => {
        const user = userEvent.setup();
        const onCloseGuardReady = vi.fn();
        const { unmount } = await open({ onCloseGuardReady });
        const guard = () => onCloseGuardReady.mock.calls.filter(([g]) => g).at(-1)![0];
        expect(guard().hasUnsavedChanges()).toBe(false);
        await expect(guard().prepareClose()).resolves.toBe(true);
        await user.click(screen.getByRole("button", { name: "Edit" }));
        fireEvent.change(screen.getByRole("textbox", { name: "Markdown editor" }), {
            target: { value: "# Cambiado" },
        });
        expect(guard().hasUnsavedChanges()).toBe(true);
        await expect(guard().prepareClose()).resolves.toBe(false);
        act(() => guard().discard());
        expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();
        unmount();
        expect(onCloseGuardReady).toHaveBeenLastCalledWith(null);
    });
});
