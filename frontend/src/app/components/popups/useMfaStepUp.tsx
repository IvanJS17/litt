"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import { MfaVerificationPopup } from "./MfaVerificationPopup";

type Waiting = { verified: () => void; declined: () => void };

/**
 * The second-factor prompt for an action the server may ask it for.
 * `run(action)` performs the action; when the server answers that the second
 * factor is needed, it shows the popup and, once the person has verified,
 * performs the action once more and returns that result. Declining the prompt
 * rejects with the server's error, so the caller reports that the action
 * still needs the second factor, as for any other failure. Render `popup`
 * once beside the component that calls `run`.
 */
export function useMfaStepUp(): {
    run: <T>(action: () => Promise<T>) => Promise<T>;
    popup: ReactNode;
} {
    const [waiting, setWaiting] = useState<Waiting | null>(null);
    // Requests that fail together (an invitation per address) share one prompt.
    const prompt = useRef<Promise<void> | null>(null);

    const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
        try {
            return await action();
        } catch (error) {
            if (!isMfaRequiredError(error)) throw error;
            prompt.current ??= new Promise<void>((resolve, reject) =>
                setWaiting({ verified: resolve, declined: () => reject(error) }),
            ).finally(() => {
                prompt.current = null;
            });
            // Actions that share the prompt each reject with their own error.
            await prompt.current.catch(() => {
                throw error;
            });
            return action();
        }
    }, []);

    const popup = (
        <MfaVerificationPopup
            open={waiting !== null}
            onCancel={() => {
                waiting?.declined();
                setWaiting(null);
            }}
            onVerified={() => {
                waiting?.verified();
                setWaiting(null);
            }}
        />
    );

    return { run, popup };
}
