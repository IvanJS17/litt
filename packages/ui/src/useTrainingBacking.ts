"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingBackingCheck, TrainingBackingMark } from "@mike/contracts";

/** After a response ends, the check is written a moment later: look a few times, then every 5 s while one is pending. */
export const TRAINING_BACKING_FIRST_LOOKS_MS = [0, 3_000, 7_000, 15_000] as const;
export const TRAINING_BACKING_POLL_MS = 5_000;
export const TRAINING_BACKING_POLL_MAX_MS = 120_000;

/**
 * LiTT training, «Modo de rendir cuentas»: the accountability checks of a
 * junior's answers in one chat, by assistant message id, read from the
 * server. A chat without any (or one the caller may not read) yields an empty
 * map. It reads when a response finishes, again for a few seconds because the
 * server writes the check after the answer, and keeps polling while one is
 * pending (two minutes at most). `enabled` is the host's decision (the caller
 * is a junior here); disabled, it asks nothing.
 */
export function useTrainingBacking({
  chatId,
  enabled,
  isResponseLoading,
  load,
  save,
}: {
  chatId: string | null | undefined;
  enabled: boolean;
  isResponseLoading: boolean;
  /** Reads the checks of a chat; the web app and the Word add-in each have their own client. */
  load: (chatId: string) => Promise<TrainingBackingCheck[]>;
  /** Saves a mark on one conclusion and returns the updated check. */
  save: (
    chatId: string,
    checkId: string,
    conclusionId: string,
    mark: TrainingBackingMark,
  ) => Promise<TrainingBackingCheck>;
}): {
  checks: ReadonlyMap<string, TrainingBackingCheck>;
  mark: (
    check: TrainingBackingCheck,
    conclusionId: string,
    mark: TrainingBackingMark,
  ) => Promise<void>;
} {
  const [state, setState] = useState<{
    chatId: string;
    checks: Map<string, TrainingBackingCheck>;
  } | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    if (!enabled || !chatId || isResponseLoading) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    startedAt.current = Date.now();

    const read = async (): Promise<boolean> => {
      let checks: TrainingBackingCheck[];
      try {
        checks = await load(chatId);
      } catch {
        // The panel is secondary: a failed read never takes the chat down.
        return false;
      }
      if (cancelled || !Array.isArray(checks)) return false;
      setState({ chatId, checks: new Map(checks.map((check) => [check.message_id, check])) });
      return checks.some((check) => check.status === "pending");
    };
    // One polling chain at most, however many first looks find a pending check.
    let chaining = false;
    const ensureChain = () => {
      if (chaining) return;
      chaining = true;
      const tick = async () => {
        const waiting = await read();
        if (cancelled) return;
        if (waiting && Date.now() - startedAt.current < TRAINING_BACKING_POLL_MAX_MS) {
          timers.push(setTimeout(tick, TRAINING_BACKING_POLL_MS));
        } else {
          chaining = false;
        }
      };
      timers.push(setTimeout(tick, TRAINING_BACKING_POLL_MS));
    };
    for (const delay of TRAINING_BACKING_FIRST_LOOKS_MS) {
      timers.push(
        setTimeout(() => {
          void read().then((waiting) => {
            if (waiting && !cancelled) ensureChain();
          });
        }, delay),
      );
    }
    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
    };
  }, [chatId, enabled, isResponseLoading, load]);

  const mark = useCallback(
    async (check: TrainingBackingCheck, conclusionId: string, change: TrainingBackingMark) => {
      if (!chatId) return;
      const updated = await save(chatId, check.id, conclusionId, change);
      setState((current) =>
        current && current.chatId === chatId
          ? { chatId, checks: new Map(current.checks).set(updated.message_id, updated) }
          : current,
      );
    },
    [chatId, save],
  );

  const checks = enabled && state && state.chatId === chatId ? state.checks : EMPTY;
  return { checks, mark };
}

const EMPTY: ReadonlyMap<string, TrainingBackingCheck> = new Map();
