"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, ScanText } from "lucide-react";
import { useTranslations } from "next-intl";
import { TextButtonUI } from "@mike/ui";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { getScanReading, startScanReading, type ScanReadingState } from "@/app/lib/mikeApi";
import { describeError, notifyError } from "@/app/lib/userFacingError";

const POLL_MS = 4000;

/** An ocr_* code from the server, as something describeError can classify. */
function codeError(code: string | null): Error {
  return Object.assign(new Error(code ?? "ocr_unavailable"), { code: code ?? "ocr_unavailable" });
}

/**
 * Where a PDF stands with scan reading, for its current version: being read,
 * read, failed, or readable on request. Reading by hand is an explicit action
 * that shows the estimated cost first. Decisions use the server's `status` and
 * `error_code`, never the translated text. Nothing renders for a document the
 * feature does not apply to, so without a key the existing "no text layer"
 * warning stays as it was.
 */
export function ScanReadingStatus({
  documentId,
  onRead,
}: {
  documentId: string;
  /** Called when a reading that was running has finished, so the page can refresh the document. */
  onRead?: (state: ScanReadingState) => void;
}) {
  const t = useTranslations();
  const [state, setState] = useState<ScanReadingState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const previous = useRef<ScanReadingState["status"] | null>(null);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });

  const apply = useCallback(
    (next: ScanReadingState) => {
      const before = previous.current;
      previous.current = next.status;
      setState(next);
      if (before === "processing" && next.status === "ready") onReadRef.current?.(next);
      if (before === "processing" && next.status === "failed") {
        notifyError(codeError(next.error_code), { action: t("shared.scanReading.readAction") });
        onReadRef.current?.(next);
      }
    },
    [t],
  );

  useEffect(() => {
    const controller = new AbortController();
    previous.current = null;
    setState(null);
    getScanReading(documentId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) apply(next);
      })
      .catch(() => {
        // The status is a convenience: a failed lookup leaves the page as it was.
      });
    return () => controller.abort();
  }, [documentId, apply]);

  const processing = state?.status === "processing";
  useEffect(() => {
    if (!processing) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      getScanReading(documentId, controller.signal)
        .then((next) => {
          if (!controller.signal.aborted) apply(next);
        })
        .catch(() => undefined);
    }, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [processing, documentId, apply]);

  const start = async () => {
    setStarting(true);
    try {
      apply(await startScanReading(documentId));
      setConfirming(false);
    } catch (error) {
      setConfirming(false);
      notifyError(error, {
        action: t("shared.scanReading.readAction"),
        onRetry: () => setConfirming(true),
      });
    } finally {
      setStarting(false);
    }
  };

  if (!state?.applicable) return null;
  const canRead = state.needs_reading && state.key_available && state.can_edit;
  const cost = state.estimated_cost_usd ?? 0;

  return (
    <div className="space-y-1.5">
      {state.status === "processing" ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-gray-600">
          <Loader2 aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin" />
          {t("shared.scanReading.reading")}
        </p>
      ) : state.status === "ready" ? (
        <p role="status" className="flex items-center gap-1.5 text-xs text-gray-600">
          <CheckCircle2 aria-hidden="true" className="h-3 w-3 shrink-0" />
          {t("shared.scanReading.done")}
        </p>
      ) : state.status === "failed" ? (
        <p role="alert" className="text-xs text-warning">
          {t("shared.scanReading.failed")} {describeError(codeError(state.error_code)).message}
        </p>
      ) : null}
      {canRead ? (
        <TextButtonUI size="sm" onClick={() => setConfirming(true)} aria-haspopup="dialog">
          <ScanText aria-hidden="true" className="h-3.5 w-3.5" />
          {t("shared.scanReading.readButton")}
        </TextButtonUI>
      ) : null}
      <ConfirmPopup
        open={confirming}
        title={t("shared.scanReading.confirmTitle")}
        message={t("shared.scanReading.confirmBody", {
          pages: state.page_count ?? state.textless_page_count ?? 0,
          cost: cost.toFixed(2),
        })}
        confirmLabel={t("shared.scanReading.confirmAction")}
        confirmStatus={starting ? "loading" : "idle"}
        onConfirm={() => void start()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
