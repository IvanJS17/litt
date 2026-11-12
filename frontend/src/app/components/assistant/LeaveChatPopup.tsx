"use client";

import { useState } from "react";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { useTranslations } from "next-intl";

export function LeaveChatPopup({
    chatId,
    onClose,
    onLeft,
}: {
    chatId: string;
    onClose: () => void;
    onLeft: () => void;
}) {
    const t = useTranslations();
    const { leaveChat } = useChatHistoryContext();
    const [leaving, setLeaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function confirmLeave() {
        if (leaving) return;
        setLeaving(true);
        try {
            await leaveChat(chatId);
            onClose();
            onLeft();
        } catch (cause) {
            setError(userFacingApiError(
                cause,
                t("assistant.leaveChatPopup.theChatCouldNotBe"),
            ));
        } finally {
            setLeaving(false);
        }
    }

    return (
        <>
            <ConfirmPopup
                open={!error}
                title={t("assistant.leaveChatPopup.leaveChat")}
                message={t("assistant.leaveChatPopup.yourSharedAccessWillBeRemoved")}
                confirmLabel={t("assistant.leaveChatPopup.leave")}
                confirmStatus={leaving ? "loading" : "idle"}
                onConfirm={() => void confirmLeave()}
                onCancel={() => { if (!leaving) onClose(); }}
            />
            <WarningPopup
                open={!!error}
                title={t("assistant.leaveChatPopup.chatNotLeft")}
                message={error}
                onClose={() => { setError(null); onClose(); }}
            />
        </>
    );
}
