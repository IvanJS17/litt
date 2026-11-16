import { useCallback, useEffect, useRef, useState } from "react";
import { getCloudWordChat } from "../api/mikeApi";
import type { WordChatMessage } from "../lib/wordChatTypes";

/** Milliseconds after an answer finishes at which its citation results are read again. */
export const REVIEW_REFRESH_DELAYS_MS = [10_000, 40_000] as const;

type RefsById = Readonly<Record<string, readonly number[]>>;
const NONE: RefsById = Object.freeze({});

/**
 * «Revisar esta cita» in the Word chat. A chat that is opened already carries
 * the refs on its messages; an answer that has just finished has none yet (the
 * automatic check runs after it is saved), so the stored chat is read again at
 * 10 s and 40 s and only the refs are taken from it. Cloud chats only: a
 * device-only chat has no server-side check. Mirrors the web app's
 * useDelayedReviewRefs; a failed read is ignored (the hint is an extra).
 */
export function useWordReviewRefs({
  chatId,
  documentId,
  storage,
  messages,
  isResponseLoading,
}: {
  chatId: string | null | undefined;
  documentId: string;
  storage: "cloud" | "local";
  messages: readonly WordChatMessage[];
  isResponseLoading: boolean;
}): (message: WordChatMessage) => readonly number[] | undefined {
  const [wasLoading, setWasLoading] = useState(isResponseLoading);
  const [finished, setFinished] = useState<string | null>(null);
  const [found, setFound] = useState<{ trigger: string; refs: RefsById } | null>(null);
  if (wasLoading !== isResponseLoading) {
    setWasLoading(isResponseLoading);
    const last = messages[messages.length - 1];
    if (
      wasLoading &&
      storage === "cloud" &&
      chatId &&
      last?.role === "assistant" &&
      last.citations?.length
    ) {
      setFinished(`${chatId}:${last.id}`);
    }
  }
  const trigger = chatId && finished?.startsWith(`${chatId}:`) ? finished : null;
  const loadRef = useRef<() => Promise<RefsById>>(async () => NONE);
  useEffect(() => {
    loadRef.current = async () => {
      if (!chatId) return NONE;
      const chat = await getCloudWordChat(documentId, chatId);
      return Object.fromEntries(
        chat.messages.flatMap((message) =>
          message.role === "assistant" && message.id && message.reviewRefs?.length
            ? [[message.id, message.reviewRefs] as const]
            : [],
        ),
      );
    };
  });

  useEffect(() => {
    if (!trigger) return;
    let current = true;
    const timers = REVIEW_REFRESH_DELAYS_MS.map((delay) =>
      setTimeout(() => {
        void loadRef
          .current()
          .then((refs) => {
            if (current) setFound({ trigger, refs });
          })
          .catch(() => undefined);
      }, delay),
    );
    return () => {
      current = false;
      timers.forEach(clearTimeout);
    };
  }, [trigger]);

  const fresh = found && found.trigger === trigger ? found.refs : NONE;
  return useCallback(
    (message: WordChatMessage) =>
      (message.role === "assistant" ? fresh[message.id] ?? message.reviewRefs : undefined),
    [fresh],
  );
}
