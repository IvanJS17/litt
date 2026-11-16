"use client";

import { useCallback, useState } from "react";
import type { Message } from "@/app/components/shared/types";
import { getChat } from "@/app/lib/mikeApi";
import { useDelayedReviewRefs, type ReviewRefsById } from "./useDelayedReviewRefs";

/**
 * The «Revisar esta cita» refs of a chat's answers. A chat that is opened
 * already carries them on its messages; an answer that has just finished has
 * none yet (the automatic check runs after it is saved), so the chat is read
 * again once or twice a few seconds later and only those refs are taken from
 * it, so nothing on screen is replaced.
 */
export function useChatReviewRefs(
    chatId: string | null | undefined,
    messages: readonly Message[],
    isResponseLoading: boolean,
): (message: Message) => readonly number[] | undefined {
    const [wasLoading, setWasLoading] = useState(isResponseLoading);
    const [finished, setFinished] = useState<string | null>(null);
    if (wasLoading !== isResponseLoading) {
        setWasLoading(isResponseLoading);
        const last = messages[messages.length - 1];
        if (
            wasLoading &&
            chatId &&
            last?.role === "assistant" &&
            last.id &&
            last.citations?.length
        ) {
            setFinished(`${chatId}:${last.id}`);
        }
    }
    const trigger = chatId && finished?.startsWith(`${chatId}:`) ? finished : null;
    const load = useCallback(async (): Promise<ReviewRefsById> => {
        if (!chatId) return {};
        const chat = await getChat(chatId);
        return Object.fromEntries(
            chat.messages.flatMap((message) =>
                message.role === "assistant" && message.id && message.reviewRefs?.length
                    ? [[message.id, message.reviewRefs] as const]
                    : [],
            ),
        );
    }, [chatId]);
    const fresh = useDelayedReviewRefs(trigger, load);
    return useCallback(
        (message: Message) => (message.id ? fresh[message.id] : undefined) ?? message.reviewRefs,
        [fresh],
    );
}
