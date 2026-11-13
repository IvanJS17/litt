import { useEffect, useRef, useState } from "react";
import { LittStatusMarkUI, type LittStatusMarkState } from "@mike/ui";

/** The done stroke draws (210 ms), holds 1.5 s and leaves (160 ms). */
const DONE_MS = 1870;

/**
 * `waiting`: the response has paused to ask the user for input or approval.
 * The mark stops blinking and shows dimmed with three dots, but does not show
 * "done", because nothing has been delivered yet.
 */
export type StatusState = "active" | "waiting" | "error" | null;

export function ResponseStatus({ status }: { status: StatusState }) {
    const [showDone, setShowDone] = useState(false);
    const [doneVisible, setDoneVisible] = useState(false);
    const wasActiveRef = useRef(false);

    const isActive = status === "active";
    const isWaiting = status === "waiting";
    const isError = status === "error";

    const markState: LittStatusMarkState = isError
        ? "error"
        : isActive
          ? "working"
          : isWaiting
            ? "waiting"
            : showDone && doneVisible
              ? "done"
              : "idle";

    useEffect(() => {
        const wasActive = wasActiveRef.current;
        wasActiveRef.current = isActive;

        let raf = 0;
        let doneTimeout = 0;
        // "Done" marks a delivered response, so stopping to ask the user is
        // not a finish. Once answered, the reply continues in a later
        // message, which shows its own "done".
        if (wasActive && !isActive && !isWaiting) {
            raf = window.requestAnimationFrame(() => {
                setShowDone(true);
                setDoneVisible(true);
                doneTimeout = window.setTimeout(
                    () => setDoneVisible(false),
                    DONE_MS,
                );
            });
        } else if (!wasActive && isActive) {
            raf = window.requestAnimationFrame(() => {
                setShowDone(false);
                setDoneVisible(false);
            });
        }

        return () => {
            window.cancelAnimationFrame(raf);
            if (doneTimeout) window.clearTimeout(doneTimeout);
        };
    }, [isActive, isWaiting]);

    return (
        <div className="w-full h-9 flex items-center mb-2">
            <LittStatusMarkUI state={markState} size={22} />
        </div>
    );
}
