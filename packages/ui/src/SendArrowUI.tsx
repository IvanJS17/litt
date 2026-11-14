import React from "react";

/**
 * The send button's glyph: a 7×7 arrow on LiTT's pixel grid (u = 2 px, so
 * 14 px), drawn with `crispEdges`. Part of the approved send-button
 * exception to DESIGN.md rule 7 (2026-11-13); see
 * `COMPOSER_SEND_BUTTON_CLASS`. It takes the button's `currentColor` for the
 * arrow and `--litt-send-stop` (papel, never amber) for the Stop square.
 * The hover advance and the arrow → square transition live in
 * `DesignTokensUI.css` under `.litt-send-glyph` and stop under
 * `prefers-reduced-motion`.
 */
export const SEND_ARROW_PATH =
    "M0 3h7v1H0z M3 0h1v1H3z M4 1h1v1H4z M5 2h1v1H5z M5 4h1v1H5z M4 5h1v1H4z M3 6h1v1H3z";

export interface SendArrowProps {
    /** Points right (the composer) or up (the citation menu). */
    direction?: "right" | "up";
    /** Shows the Stop square instead of the arrow. */
    stop?: boolean;
    className?: string;
}

export function SendArrowUI({
    direction = "right",
    stop = false,
    className,
}: SendArrowProps) {
    return (
        <span
            className={`litt-send-glyph${className ? ` ${className}` : ""}`}
            data-stop={stop ? "true" : "false"}
            data-direction={direction}
            style={
                {
                    "--lsg-rot": direction === "up" ? "-90deg" : "0deg",
                } as React.CSSProperties
            }
            aria-hidden="true"
        >
            <svg className="lsg-arrow" viewBox="0 0 7 7" width={14} height={14} focusable="false">
                <path d={SEND_ARROW_PATH} fill="currentColor" />
            </svg>
            <svg className="lsg-stop" viewBox="0 0 14 14" width={14} height={14} focusable="false">
                <rect x={2} y={2} width={10} height={10} fill="var(--litt-send-stop)" />
            </svg>
        </span>
    );
}
