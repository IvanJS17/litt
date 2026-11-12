"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listDocumentVersions, saveDocxVersion } from "@/app/lib/mikeApi";
import { errorCode, notifyError, userFacingApiError } from "@/app/lib/userFacingError";
import { clientTranslator, UploadBatchError } from "@mike/client";
import { invalidateDocxBytes } from "./useFetchDocxBytes";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface Options {
    documentId: string;
    versionId?: string | null;
    filename?: string;
    bytes: ArrayBuffer | null;
    enabled: boolean;
    exportDocx: () => Promise<ArrayBuffer> | undefined;
}

/**
 * Save on request only (the Save button, Cmd/Ctrl+S, closing the tab): an edit
 * just marks the document dirty. Saves are serialized and edits made during an
 * upload stay dirty for the next explicit save. Every save creates a NEW version on top of the one the edit was
 * made on (saveDocxVersion); the returned version is the base of the next
 * save, so a version an AI run, a review or an approval refers to is never
 * overwritten.
 */
export function useDocxSave(options: Options) {
    const latest = useRef(options);
    useEffect(() => { latest.current = options; });
    const sequence = useRef(0);
    const savedSequence = useRef(0);
    const snapshotRevision = useRef(0);
    const savedBytes = useRef<ArrayBuffer | null>(null);
    const targetVersion = useRef<string | null>(null);
    const pending = useRef<Promise<void> | null>(null);
    const mounted = useRef(true);
    const failed = useRef(false);
    const discarded = useRef(false);
    // The server refused the save because the file changed; retrying cannot succeed.
    const conflicted = useRef(false);
    const detachedSnapshot = useRef<{ bytes: Promise<ArrayBuffer>; sequence: number } | null>(null);
    const [dirty, setDirty] = useState(false);
    const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [error, setError] = useState<string | null>(null);

    const save = useCallback((): Promise<void> => {
        if (pending.current) return pending.current;
        if (discarded.current || !latest.current.enabled || sequence.current === savedSequence.current) return Promise.resolve();
        failed.current = false;
        const warnWhileSaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warnWhileSaving);
        const run = async () => {
            if (mounted.current) { setStatus("saving"); setError(null); }
            try {
                do {
                    const current = latest.current;
                    const detached = detachedSnapshot.current;
                    detachedSnapshot.current = null;
                    const savingSequence = detached?.sequence ?? sequence.current;
                    const exported = detached?.bytes ?? current.exportDocx();
                    if (!exported || !current.bytes) throw new Error("Editor is not ready");
                    // Start serialization before awaiting network work, including on unmount.
                    const bytes = await exported;
                    targetVersion.current ??= current.versionId ?? null;
                    if (!targetVersion.current) {
                        targetVersion.current = (await listDocumentVersions(current.documentId)).current_version_id;
                    }
                    if (!targetVersion.current) throw new Error("Missing document version");
                    const name = current.filename || "document.docx";
                    const file = new File([bytes], /\.docx$/i.test(name) ? name : `${name}.docx`, { type: DOCX_MIME });
                    const saved = await saveDocxVersion(current.documentId, targetVersion.current, file);
                    targetVersion.current = saved.id;
                    savedSequence.current = savingSequence;
                    conflicted.current = false;
                    savedBytes.current = bytes;
                    snapshotRevision.current += 1;
                    invalidateDocxBytes(current.documentId);
                    if (mounted.current) {
                        if (sequence.current === savingSequence) {
                            setDirty(false);
                            setStatus("saved");
                        } else {
                            // Edited during the upload: those edits are unsaved, not "saving".
                            setStatus("idle");
                        }
                    }
                } while (detachedSnapshot.current && sequence.current > savedSequence.current);
            } catch (reason) {
                failed.current = true;
                const conflict = errorCode(reason) === "document_version_conflict"
                    || (reason instanceof UploadBatchError
                        && reason.outcomes.some((outcome) => outcome.errorCode === "document_changed"));
                conflicted.current = conflict;
                if (!mounted.current) {
                    // The viewer is gone (navigation): nothing on screen would show the failure.
                    notifyError(reason, { action: clientTranslator()("shared.markdownView.saveThisDocument") });
                } else {
                    setError(conflict
                        ? "This document changed elsewhere. Download your edits before reopening the latest version."
                        : userFacingApiError(reason, "Changes could not be saved. Your edits are still open. Press Cmd/Ctrl+S to retry, or download a copy."));
                    setStatus("error");
                }
            }
        };
        pending.current = run().finally(() => {
            pending.current = null;
            window.removeEventListener("beforeunload", warnWhileSaving);
        });
        return pending.current;
    }, []);

    // Consider each server snapshot once, at arrival. A response received while
    // dirty/saving must not be replayed after a later save and revert local edits.
    const captureSnapshotRevision = useCallback(() => snapshotRevision.current, []);
    const adoptSnapshot = useCallback((bytes: ArrayBuffer, revision: number): boolean => {
        if (revision !== snapshotRevision.current || pending.current || sequence.current !== savedSequence.current) return false;
        // A pinned version stays as it was; our saves live in newer versions.
        // Its bytes would put the editor back before the edits already saved.
        const pinned = latest.current.versionId;
        if (pinned && targetVersion.current && targetVersion.current !== pinned) return false;
        const baseline = savedBytes.current ?? latest.current.bytes;
        if (baseline) {
            const previous = new Uint8Array(baseline);
            const next = new Uint8Array(bytes);
            // A refresh of our own save must retain the editor and its undo stack.
            if (previous.length === next.length && previous.every((byte, index) => byte === next[index])) return false;
        }
        targetVersion.current = null;
        conflicted.current = false;
        savedBytes.current = bytes;
        snapshotRevision.current += 1;
        latest.current = { ...latest.current, bytes };
        setStatus("idle");
        return true;
    }, []);

    const markChanged = useCallback(() => {
        if (!latest.current.enabled) return;
        sequence.current += 1;
        snapshotRevision.current += 1;
        setDirty(true);
        if (!failed.current && !pending.current) setStatus("idle");
    }, []);

    useLayoutEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            // Closing is the last chance to keep unsaved edits, so retry even
            // after a failed save; only a conflict is left for the user.
            if (conflicted.current || discarded.current) return;
            // Capture pending edits before the child editor's passive teardown.
            if (pending.current && sequence.current > savedSequence.current) {
                const bytes = latest.current.exportDocx();
                if (bytes) {
                    // Observe rejection immediately, even if the current upload fails first.
                    void bytes.catch(() => {});
                    detachedSnapshot.current = { bytes, sequence: sequence.current };
                }
            }
            void save();
        };
    }, [save]);

    useEffect(() => {
        if (!dirty) return;
        const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);

    const hasUnsavedChanges = useCallback(() => sequence.current !== savedSequence.current, []);
    const prepareClose = useCallback(async () => {
        if (!conflicted.current) await save();
        return !hasUnsavedChanges();
    }, [save, hasUnsavedChanges]);
    const discard = useCallback(() => { discarded.current = true; }, []);
    return { dirty, status, error, markChanged, save, adoptSnapshot, captureSnapshotRevision, hasUnsavedChanges, prepareClose, discard };
}
