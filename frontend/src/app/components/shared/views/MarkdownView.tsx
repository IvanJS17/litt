"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Pencil } from "lucide-react";
import { PillButtonUI, TextButtonUI } from "@mike/ui";
import type { MarkdownVersionSaved } from "@mike/contracts";
import { exceedsJsonBodyLimit } from "@mike/client";
import { MarkdownContent } from "@/app/components/assistant/message/MarkdownContent";
import {
    MarkdownEditor,
    markdownSurvivesRichEditing,
} from "@/app/components/ui/markdown-editor";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import {
    getDocumentFile,
    listDocumentVersions,
    saveMarkdownVersion,
} from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import type { DocxCloseGuard } from "./DocxRenderer.types";
import { viewRoundingClass, type ViewRounding } from "./viewRounding";

const NO_CITATIONS: never[] = [];

type Loaded = {
    key: string;
    text: string | null;
    /** The version a save builds on; null until the version list answers. */
    currentVersionId: string | null;
    failed: boolean;
};

interface Props {
    documentId: string;
    /** The version shown; null/undefined is the current one. */
    versionId?: string | null;
    /** The viewer may upload versions of this document. */
    canEdit?: boolean;
    rounded?: ViewRounding;
    refetchKey?: number | string;
    onCloseGuardReady?: (guard: DocxCloseGuard | null) => void;
    /** A save made a new version (already the current one). */
    onSaved?: (version: MarkdownVersionSaved) => void;
}

/** Loading stand-in with the page's own shape: a title line, then paragraphs. */
export function MarkdownViewSkeleton({
    label,
    rounded = true,
}: {
    label: string;
    rounded?: ViewRounding;
}) {
    return (
        <div
            role="status"
            aria-label={label}
            className={cn(
                "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden bg-app-surface px-6 py-5",
                viewRoundingClass(rounded),
            )}
        >
            <div className="h-6 w-2/5 animate-pulse rounded bg-gray-200" />
            {[92, 100, 85, 96, 60].map((width, index) => (
                <div
                    key={index}
                    className="h-3 animate-pulse rounded bg-gray-100"
                    style={{ width: `${width}%` }}
                />
            ))}
            <div className="mt-2 h-4 w-1/4 animate-pulse rounded bg-gray-200" />
            {[100, 88, 94].map((width, index) => (
                <div
                    key={index}
                    className="h-3 animate-pulse rounded bg-gray-100"
                    style={{ width: `${width}%` }}
                />
            ))}
        </div>
    );
}

/**
 * A .md document: shown formatted, and editable by whoever may upload
 * versions. Every save is a new version; the file itself is never rewritten.
 */
export function MarkdownView(props: Props) {
    // A different document or version never shows the previous one's edit.
    return (
        <MarkdownViewContent
            key={`${props.documentId}:${props.versionId ?? ""}`}
            {...props}
        />
    );
}

function MarkdownViewContent({
    documentId,
    versionId = null,
    canEdit = false,
    rounded = true,
    refetchKey,
    onCloseGuardReady,
    onSaved,
}: Props) {
    const t = useTranslations();
    const key = `${documentId}:${versionId ?? ""}:${refetchKey ?? ""}:${canEdit}`;
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [reloads, setReloads] = useState(0);
    const [text, setText] = useState("");
    const [baseVersionId, setBaseVersionId] = useState<string | null>(null);
    const [editing, setEditing] = useState(false);
    const [mode, setMode] = useState<"rich" | "text">("rich");
    const [draft, setDraft] = useState("");
    const [richBlocked, setRichBlocked] = useState(false);
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    // The draft a save was refused for being over the request limit.
    const [tooLargeDraft, setTooLargeDraft] = useState<string | null>(null);
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [copied, setCopied] = useState<"done" | "failed" | null>(null);
    const dirty = editing && draft !== text;
    const dirtyRef = useRef(false);
    useEffect(() => {
        dirtyRef.current = dirty;
    }, [dirty]);

    // Read the version's text, and which version is current when this viewer
    // may edit (a save needs it as its base).
    const loadKey = `${key}:${reloads}`;
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const [file, versions] = await Promise.all([
                    getDocumentFile(documentId, versionId),
                    canEdit ? listDocumentVersions(documentId) : null,
                ]);
                const body = await file.blob.text();
                if (cancelled) return;
                setText(body);
                setBaseVersionId(versions?.current_version_id ?? null);
                setLoaded({
                    key: loadKey,
                    text: body,
                    currentVersionId: versions?.current_version_id ?? null,
                    failed: false,
                });
            } catch {
                if (!cancelled)
                    setLoaded({
                        key: loadKey,
                        text: null,
                        currentVersionId: null,
                        failed: true,
                    });
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [documentId, versionId, canEdit, loadKey]);

    // Leaving the page with unsaved text asks first.
    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => {
            event.preventDefault();
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    // The host asks before closing a tab: unsaved text is never saved behind
    // the person's back (each save is a version), so closing waits for them.
    useEffect(() => {
        onCloseGuardReady?.({
            hasUnsavedChanges: () => dirtyRef.current,
            prepareClose: async () => !dirtyRef.current,
            discard: () => setEditing(false),
        });
        return () => onCloseGuardReady?.(null);
    }, [onCloseGuardReady]);

    const current = loaded?.key === loadKey ? loaded : null;
    const editable =
        canEdit &&
        !!current &&
        !current.failed &&
        !!current.currentVersionId &&
        (versionId == null || versionId === current.currentVersionId);

    const startEditing = () => {
        const rich = markdownSurvivesRichEditing(text);
        setDraft(text);
        setMode(rich ? "rich" : "text");
        setRichBlocked(!rich);
        setConflict(false);
        setCopied(null);
        setEditing(true);
    };

    const chooseMode = (next: "rich" | "text") => {
        if (next === mode) return;
        if (next === "rich" && !markdownSurvivesRichEditing(draft)) {
            setRichBlocked(true);
            return;
        }
        setRichBlocked(false);
        setMode(next);
    };

    const closeEditor = () => {
        setConfirmDiscard(false);
        setEditing(false);
        setConflict(false);
    };
    const stopEditing = () => (dirty ? setConfirmDiscard(true) : closeEditor());

    const save = useCallback(async () => {
        if (!baseVersionId || saving) return;
        // Say so here rather than let the server answer with a bare 413.
        if (
            exceedsJsonBodyLimit(
                JSON.stringify({ text: draft, base_version_id: baseVersionId }),
            )
        ) {
            setTooLargeDraft(draft);
            return;
        }
        setSaving(true);
        try {
            const saved = await saveMarkdownVersion(
                documentId,
                draft,
                baseVersionId,
            );
            setText(draft);
            setBaseVersionId(saved.id);
            setEditing(false);
            setConflict(false);
            onSaved?.(saved);
        } catch (error) {
            if (errorCode(error) === "document_version_conflict") {
                // The text stays in the editor; nothing is lost.
                setConflict(true);
            } else {
                notifyError(error, {
                    action: t("shared.markdownView.saveThisDocument"),
                    operation: "documents.edit",
                    onRetry: () => void save(),
                });
            }
        } finally {
            setSaving(false);
        }
    }, [baseVersionId, saving, documentId, draft, onSaved]);

    const copyDraft = async () => {
        try {
            await navigator.clipboard.writeText(draft);
            setCopied("done");
        } catch {
            setCopied("failed");
        }
    };

    const reload = () => {
        setEditing(false);
        setConflict(false);
        setReloads((count) => count + 1);
    };

    if (!current) {
        return (
            <MarkdownViewSkeleton
                label={t("markdownDocument.loadingLabel")}
                rounded={rounded}
            />
        );
    }
    if (current.failed) {
        return (
            <div
                role="alert"
                className="flex h-full items-center justify-center p-5 text-sm text-destructive"
            >
                {t("markdownDocument.loadError")}
            </div>
        );
    }

    return (
        <div
            className={cn(
                "document-canvas flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-app-surface",
                viewRoundingClass(rounded),
            )}
            data-document-id={documentId}
            data-version-id={versionId ?? ""}
        >
            {editable && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
                    {editing ? (
                        <>
                            <div
                                role="group"
                                aria-label={t("markdownDocument.modeLabel")}
                                className="flex items-center gap-1"
                            >
                                {(["rich", "text"] as const).map((option) => (
                                    <TextButtonUI
                                        key={option}
                                        size="sm"
                                        aria-pressed={mode === option}
                                        className={
                                            mode === option
                                                ? "text-foreground"
                                                : undefined
                                        }
                                        onClick={() => chooseMode(option)}
                                    >
                                        {option === "rich"
                                            ? t("markdownDocument.modeRich")
                                            : t("markdownDocument.modeText")}
                                    </TextButtonUI>
                                ))}
                            </div>
                            <div className="ml-auto flex items-center gap-2">
                                <PillButtonUI
                                    tone="white"
                                    size="sm"
                                    onClick={stopEditing}
                                    disabled={saving}
                                >
                                    {t("markdownDocument.cancel")}
                                </PillButtonUI>
                                <PillButtonUI
                                    tone="black"
                                    size="sm"
                                    onClick={() => void save()}
                                    disabled={!dirty}
                                    loading={saving}
                                >
                                    {saving
                                        ? t("markdownDocument.saving")
                                        : t("markdownDocument.save")}
                                </PillButtonUI>
                            </div>
                        </>
                    ) : (
                        <TextButtonUI size="sm" onClick={startEditing}>
                            <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                            {t("markdownDocument.edit")}
                        </TextButtonUI>
                    )}
                </div>
            )}
            {editing && richBlocked && (
                <p
                    role="status"
                    className="mx-3 mb-2 shrink-0 rounded-md bg-warning-surface px-2 py-1.5 text-xs text-warning"
                >
                    {t("markdownDocument.richUnavailable")}
                </p>
            )}
            {editing && tooLargeDraft === draft && (
                <p
                    role="alert"
                    className="mx-3 mb-2 shrink-0 rounded-md bg-warning-surface px-2 py-1.5 text-xs text-warning"
                >
                    {t("markdownDocument.tooLarge")}
                </p>
            )}
            {editing && conflict && (
                <div
                    role="alert"
                    className="mx-3 mb-2 flex shrink-0 flex-wrap items-center gap-2 rounded-md bg-warning-surface px-2 py-1.5 text-xs text-warning"
                >
                    <span className="min-w-0 flex-1">
                        {t("markdownDocument.conflict")}
                    </span>
                    <TextButtonUI size="sm" onClick={() => void copyDraft()}>
                        <Copy aria-hidden="true" className="h-3.5 w-3.5" />
                        {t("markdownDocument.copyText")}
                    </TextButtonUI>
                    <TextButtonUI size="sm" onClick={reload}>
                        {t("markdownDocument.reload")}
                    </TextButtonUI>
                    {copied && (
                        <span role="status">
                            {copied === "done"
                                ? t("markdownDocument.textCopied")
                                : t("markdownDocument.copyFailed")}
                        </span>
                    )}
                </div>
            )}
            <ConfirmPopup
                open={confirmDiscard}
                title={t("markdownDocument.discardTitle")}
                message={t("markdownDocument.unsaved")}
                confirmLabel={t("markdownDocument.discard")}
                confirmVariant="danger"
                cancelLabel={t("markdownDocument.keepEditing")}
                onConfirm={closeEditor}
                onCancel={() => setConfirmDiscard(false)}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                {editing ? (
                    mode === "rich" ? (
                        <MarkdownEditor
                            value={draft}
                            onChange={setDraft}
                            rawToggle={false}
                            ariaLabel={t("markdownDocument.editorLabel")}
                        />
                    ) : (
                        <textarea
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            spellCheck={false}
                            aria-label={t("markdownDocument.sourceLabel")}
                            className="h-full min-h-full w-full resize-none bg-transparent px-5 py-4 font-mono text-xs leading-6 text-gray-800 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                        />
                    )
                ) : (
                    <div className="px-6 py-4">
                        <MarkdownContent
                            text={text}
                            inlineCitationTargets={NO_CITATIONS}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
