import { useEffect, useRef, useState } from "react";
import { LittStatusMarkUI, type LittStatusMarkState } from "@mike/ui";

/** The done stroke draws (210 ms), holds 1.5 s and leaves (160 ms). */
const DONE_MS = 1870;

export type StatusState = "active" | "error" | null;

/**
 * Mirrors the web assistant's response marker: LiTT's square blinks while the
 * response is active, draws a green rule when it finishes, and shows only its
 * outline on an error.
 */
export function ResponseStatus({
  status,
}: {
  status: StatusState;
}): React.ReactElement {
  const [showDone, setShowDone] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const wasActiveRef = useRef(false);

  const isActive = status === "active";
  const isError = status === "error";

  const markState: LittStatusMarkState = isError
    ? "error"
    : isActive
      ? "working"
      : showDone && doneVisible
        ? "done"
        : "idle";

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    let frame = 0;
    let doneTimeout = 0;
    if (wasActive && !isActive) {
      frame = window.requestAnimationFrame(() => {
        setShowDone(true);
        setDoneVisible(true);
        doneTimeout = window.setTimeout(() => setDoneVisible(false), DONE_MS);
      });
    } else if (!wasActive && isActive) {
      frame = window.requestAnimationFrame(() => {
        setShowDone(false);
        setDoneVisible(false);
      });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      if (doneTimeout) window.clearTimeout(doneTimeout);
    };
  }, [isActive]);

  return (
    <div
      data-testid="assistant-response-status"
      className="mb-2 flex h-9 w-full items-center"
    >
      <LittStatusMarkUI state={markState} size={22} />
    </div>
  );
}
