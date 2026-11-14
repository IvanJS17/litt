"use client";

import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { WarningPopup } from "../popups/WarningPopup";

interface Props {
    open: boolean;
    label?: string;
    warning?: string | null;
    onWarningClose?: () => void;
}

export function UploadOverlay({
    open,
    label,
    warning,
    onWarningClose,
}: Props) {
    const t = useTranslations();
    return (
        <>
            {open &&
                createPortal(
                    <div className="pointer-events-none fixed inset-0 z-[260] flex items-center justify-center bg-surface-desk/35 p-6 backdrop-blur-md">
                        <p className="font-serif text-xl text-gray-900">
                            {label ?? t("assistant.uploadOverlay.dropFilesHereToAdd")}
                        </p>
                    </div>,
                    document.body,
                )}
            <WarningPopup
                open={!!warning}
                onClose={onWarningClose ?? (() => {})}
                message={warning}
            />
        </>
    );
}
