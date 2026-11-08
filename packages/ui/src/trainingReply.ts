"use client";

import { useEffect, useRef } from "react";

// LiTT training (docs/training.md, layer 3): «Responder» on a basis question
// carries the question, quoted, to the composer's approach field. The note
// (beside a message) and the composer are different parts of the screen, in
// the web app and in the Word add-in alike, so they talk through one window
// event instead of a prop chain through every chat view.

const REPLY_EVENT = "litt:training-reply";

/** The question a pasante answers next, as the lines of a quotation. */
export function quoteTrainingQuestion(question: string): string {
  return question
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
}

/**
 * The approach field after «Responder»: the quoted question first, a blank
 * line, then what the person had already written.
 */
export function withTrainingReply(current: string, question: string): string {
  return `${quoteTrainingQuestion(question)}\n\n${current.trimStart()}`;
}

/** Tell the composer of that chat (or the only one) to take the question. */
export function requestTrainingReply(
  question: string,
  chatId?: string | null,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(REPLY_EVENT, { detail: { question, chatId: chatId ?? null } }),
  );
}

/** Put the cursor at the end of the approach field once the text is in it. */
export function focusTrainingAttempt(id: string): void {
  if (typeof document === "undefined") return;
  const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (run: () => void) => setTimeout(run, 0);
  frame(() => {
    const field = document.getElementById(id);
    if (!(field instanceof HTMLTextAreaElement)) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  });
}

/**
 * Listen, in a composer that owes an approach, for «Responder». A request for
 * another chat is ignored; one without a chat matches any composer, except
 * a chat-scoped composer that has no chat yet.
 */
export function useTrainingReply({
  enabled,
  chatId,
  chatScoped = false,
  onReply,
}: {
  enabled: boolean;
  chatId?: string | null;
  /** A composer that belongs to chats (the web app's): with no chat yet it ignores a request aimed at one. */
  chatScoped?: boolean;
  onReply: (question: string) => void;
}): void {
  const handler = useRef(onReply);
  useEffect(() => {
    handler.current = onReply;
  });
  useEffect(() => {
    if (!enabled) return;
    const listen = (event: Event) => {
      const detail = (event as CustomEvent<{ question?: unknown; chatId?: unknown }>).detail;
      if (typeof detail?.question !== "string" || !detail.question.trim()) return;
      if (typeof detail.chatId === "string") {
        if (chatId ? detail.chatId !== chatId : chatScoped) return;
      }
      handler.current(detail.question);
    };
    window.addEventListener(REPLY_EVENT, listen);
    return () => window.removeEventListener(REPLY_EVENT, listen);
  }, [enabled, chatId, chatScoped]);
}
