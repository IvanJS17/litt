"use client";

import { useEffect, useRef } from "react";

// LiTT training: the server refused a turn with training_attempt_required,
// training_confidence_required or a refused mode (training_mode_not_allowed,
// training_hint_limit_reached, training_counterpart_rounds_done), so what a composer showed (an urgency pass
// that just ended, the thermometer) is out of date. The chat hook and the
// composers are different parts of the screen, in the web app and in the Word
// add-in alike, so they talk through one window event.

const STALE_EVENT = "litt:training-stage-stale";

/** The error codes with which the server says the composer's stage is stale. */
export function isTrainingRefusalCode(code: unknown): boolean {
  return (
    code === "training_attempt_required" ||
    code === "training_confidence_required" ||
    // A hint or a round the server will not give (the composer offered a mode
    // that is no longer open): what the composer showed is out of date.
    code === "training_mode_not_allowed" ||
    code === "training_hint_limit_reached" ||
    code === "training_counterpart_rounds_done"
  );
}

/** Tell every mounted composer to read the stage again. */
export function markTrainingStageStale(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(STALE_EVENT));
}

/** Run `onStale` whenever {@link markTrainingStageStale} is called. */
export function useTrainingStageStale(onStale: () => void, enabled = true): void {
  const handler = useRef(onStale);
  useEffect(() => {
    handler.current = onStale;
  });
  useEffect(() => {
    if (!enabled) return;
    const listen = () => handler.current();
    window.addEventListener(STALE_EVENT, listen);
    return () => window.removeEventListener(STALE_EVENT, listen);
  }, [enabled]);
}
