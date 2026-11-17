"use client";

import * as React from "react";
import { ChevronDown, KeyRound } from "lucide-react";
import { twMerge } from "tailwind-merge";
import {
    COMPOSER_GHOST_BUTTON_CLASS,
    COMPOSER_GHOST_WEB_ICON_CLASS,
    COMPOSER_GHOST_WEB_SIZE_CLASS,
} from "./ComposerSurfaceUI.styles";
import { TOUCH_TARGET_CLASS } from "./touchTargetUI.styles";

const KEY_CHIP_CLASS = "text-[0.78125rem]";

/**
 * The composer's key button: a key icon, the name of the key a new
 * conversation runs on, and a chevron. `compact` leaves only the icon. As a
 * trigger it is a button; with `preview` it is the same look as a plain span
 * with no behavior, for a picture of the composer.
 */
export function KeyChipUI({
    label,
    compact = false,
    preview = false,
    className,
    ref,
    ...props
}: Omit<React.ComponentPropsWithoutRef<"button">, "children"> & {
    label: string;
    compact?: boolean;
    preview?: boolean;
    ref?: React.Ref<HTMLButtonElement>;
}): React.ReactElement {
    const classes = twMerge(
        TOUCH_TARGET_CLASS,
        COMPOSER_GHOST_BUTTON_CLASS,
        COMPOSER_GHOST_WEB_SIZE_CLASS,
        compact && COMPOSER_GHOST_WEB_ICON_CLASS,
        KEY_CHIP_CLASS,
        className,
    );
    const content = (
        <>
            <KeyRound aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            {!compact && <span className="whitespace-nowrap">{label}</span>}
            {!compact && <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0" />}
        </>
    );
    if (preview) return <span className={classes}>{content}</span>;
    return (
        <button ref={ref} type="button" className={classes} {...props}>
            {content}
        </button>
    );
}
