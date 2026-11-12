import { useTranslations } from "use-intl";
import { X } from "lucide-react";
import { PillButtonUI } from "./PillButtonUI";

export type CloseButtonSize = "sm" | "md";

const sizeClasses: Record<CloseButtonSize, { button: string; icon: string }> = {
    /** Side panels. */
    sm: { button: "h-4 w-4", icon: "h-2.5 w-2.5" },
    /** Modals. */
    md: { button: "h-5 w-5", icon: "h-3 w-3" },
};

/** The small white ✕ that dismisses a side panel, modal or other surface. */
export function CloseButton({
    onClick,
    label,
    size = "sm",
    className,
}: {
    onClick: () => void;
    label?: string;
    size?: CloseButtonSize;
    className?: string;
}) {
    const t = useTranslations();
    const classes = sizeClasses[size];
    return (
        <PillButtonUI
            tone="white"
            size="icon-xs"
            onClick={onClick}
            aria-label={label ?? t("ui.closeButton.close")}
            title={label ?? t("ui.closeButton.close")}
            className={`${classes.button} shrink-0 ${className ?? ""}`}
        >
            <X aria-hidden="true" className={classes.icon} />
        </PillButtonUI>
    );
}
