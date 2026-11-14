"use client";

import * as React from "react";

import {
    COMPOSER_SEND_BUTTON_CLASS,
    COMPOSER_SURFACE_CLASS,
    COMPOSER_SURFACE_WORD_RADIUS_CLASS,
    SendArrowUI,
} from "@mike/ui";

import { cn } from "../lib/utils";
import { useTranslations } from "use-intl";

/** Lines the composer grows to before its text scrolls. */
const COMPOSER_MAX_LINES = 6;

interface ChatInputProps {
    value: string;
    onValueChange: (value: string) => void;
    onSubmit: () => void;
    isLoading?: boolean;
    onCancel?: () => void;
    placeholder?: string;
    disabled?: boolean;
    /** Accessory controls rendered on the left of the action row (e.g. a toggle). */
    leftSlot?: React.ReactNode;
    /** Accessory controls rendered immediately before the send/stop button. */
    rightSlot?: React.ReactNode;
    /** The labels row (`ComposerChipsUI`) rendered inside the composer sheet. */
    attachments?: React.ReactNode;
    /**
     * Lets the composer send with no typed text, when what is attached
     * already says what is being asked (an annotated excerpt).
     */
    canSubmitEmpty?: boolean;
    className?: string;
    onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>;
    combobox?: {
        controls?: string;
        expanded: boolean;
        activeDescendant?: string;
    };
}

/**
 * Presentational chat composer shell shared across surfaces, duplicated from
 * the web app's composer (frontend/src/app/components/assistant/ChatInput.tsx):
 * the same opaque sheet and send button,
 * laid out to fit a narrow task-pane column. Enter submits; Shift+Enter
 * inserts a newline. The action button flips between send (arrow) and stop
 * (square) exactly like the web's single action button.
 */
export function ChatInput({
    value,
    onValueChange,
    onSubmit,
    isLoading = false,
    onCancel,
    placeholder,
    disabled = false,
    leftSlot,
    rightSlot,
    attachments,
    canSubmitEmpty = false,
    className,
    onKeyDown,
    combobox,
}: ChatInputProps) {
    const t = useTranslations();
    const textareaRef = React.useRef<HTMLTextAreaElement>(null);
    const inputAreaRef = React.useRef<HTMLDivElement>(null);

    // The cap is a whole number of lines (6 × 24px = 144px), a narrow-pane
    // adaptation tighter than the web composer's max-h-48 (192px), which the
    // textarea also carries so a growing value can never swallow the pane
    // before this effect runs. Past the cap the text scrolls inside the
    // field; with whole lines, the scrolled-to-the-end view starts on a line
    // boundary instead of cutting the top line in half.
    const resizeTextarea = React.useCallback((): void => {
        const el = textareaRef.current;
        if (!el) return;
        const lineHeight =
            Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
        const cap = lineHeight * COMPOSER_MAX_LINES;
        el.style.height = "0px";
        el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
        el.style.overflowY = el.scrollHeight > cap ? "auto" : "hidden";
    }, []);

    // Auto-grow when content changes.
    React.useEffect(() => {
        resizeTextarea();
    }, [resizeTextarea, value]);

    // A width-only pane resize can wrap existing text onto more lines without
    // changing its value. Re-measure that stable input-area width so the
    // bottom-anchored composer grows upward instead of clipping those lines.
    React.useEffect(() => {
        const inputArea = inputAreaRef.current;
        if (!inputArea || typeof ResizeObserver === "undefined") return;
        let previousWidth = inputArea.getBoundingClientRect().width;
        let resizeFrame: number | null = null;
        const observer = new ResizeObserver((entries) => {
            const width =
                entries[0]?.contentRect.width ?? inputArea.offsetWidth;
            if (Math.abs(width - previousWidth) < 0.5) return;
            previousWidth = width;
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            // Changing the textarea height inside the observer callback can
            // resize the observed input area again in the same delivery cycle.
            // Defer the write to the next frame to avoid ResizeObserver loops
            // while Word's task pane is being dragged narrower or wider.
            resizeFrame = requestAnimationFrame(() => {
                resizeFrame = null;
                resizeTextarea();
            });
        });
        observer.observe(inputArea);
        return () => {
            observer.disconnect();
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        };
    }, [resizeTextarea]);

    const canSend =
        (!!value.trim() || canSubmitEmpty) && !isLoading && !disabled;

    const handleKeyDown = (
        e: React.KeyboardEvent<HTMLTextAreaElement>,
    ): void => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (canSend) onSubmit();
        }
    };

    return (
        <div
            data-testid="chat-input"
            className={cn(
                // The web composer's sheet, so the pane follows the dark theme.
                COMPOSER_SURFACE_WORD_RADIUS_CLASS,
                COMPOSER_SURFACE_CLASS,
                className,
            )}
        >
            {attachments}
            <div ref={inputAreaRef} className="px-3 pt-3">
                <textarea
                    ref={textareaRef}
                    rows={1}
                    value={value}
                    onChange={(e) => onValueChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    role={combobox ? "combobox" : undefined}
                    aria-autocomplete={combobox ? "list" : undefined}
                    aria-controls={combobox?.controls}
                    aria-expanded={combobox?.expanded}
                    aria-activedescendant={combobox?.activeDescendant}
                    placeholder={placeholder ?? t("word.howCanIHelp")}
                    disabled={disabled}
                    className="max-h-48 w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-6 text-gray-900 outline-none placeholder:text-gray-400 disabled:opacity-60"
                />
            </div>
            <div className="flex items-center justify-between gap-2 p-2">
                <div className="flex min-w-0 items-center gap-2">
                    {leftSlot}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {rightSlot}
                    <button
                        type="button"
                        onClick={() =>
                            isLoading ? onCancel?.() : canSend && onSubmit()
                        }
                        disabled={!isLoading && !canSend}
                        data-testid="chat-send"
                        aria-label={isLoading ? t("word.stopResponse") : t("word.sendMessage")}
                        className={cn(
                            COMPOSER_SEND_BUTTON_CLASS,
    SendArrowUI,
                            "h-8 w-8 shrink-0 rounded-[10px]",
                        )}
                    >
                        <SendArrowUI stop={isLoading} />
                    </button>
                </div>
            </div>
        </div>
    );
}
