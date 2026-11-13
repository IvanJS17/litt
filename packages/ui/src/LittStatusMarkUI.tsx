import React from "react";

/**
 * LiTT's response-status indicator, "A · Cursor". The square is a lit cursor:
 * it blinks while LiTT works and sits still on its rule when it is done. The
 * motion and colours are an approved exception to DESIGN.md rules 10 and 9
 * (owner decision, 2026-11-13); every animation lives in `DesignTokensUI.css`
 * under `.litt-status-mark` and stops under `prefers-reduced-motion`.
 *
 * Grid: u = floor(size / 7). The square is 3u, the rule and its gap 1u, the
 * error outline ceil(u / 2). Everything is drawn in whole pixels.
 */
export const LITT_STATUS_MARK_STATES = [
    "idle",
    "working",
    "waiting",
    "done",
    "error",
] as const;
export type LittStatusMarkState = (typeof LITT_STATUS_MARK_STATES)[number];

/**
 * Subagent hues, in the order a list of marks should take them. Amber is
 * LiTT's own, so it is not one of them. Values: `--litt-status-hue-*`.
 */
export const LITT_STATUS_MARK_HUES = ["teal", "pink", "lime", "stone"] as const;
export type LittStatusMarkHue = (typeof LITT_STATUS_MARK_HUES)[number];

export interface LittStatusMarkProps {
    state?: LittStatusMarkState;
    /** A categorical colour for the square, e.g. one subagent among several. */
    hue?: LittStatusMarkHue;
    /** Pixel size of the box; the grid snaps to whole pixels. Defaults to 22. */
    size?: number;
    className?: string;
}

export function littStatusMarkGeometry(size: number) {
    const u = Math.max(1, Math.floor(size / 7));
    const square = 3 * u;
    const x = Math.floor((size - square) / 2);
    const y = x;
    return { u, square, x, y, ruleY: y + square + u, frame: Math.ceil(u / 2) };
}

export function LittStatusMarkUI({
    state = "idle",
    hue,
    size = 22,
    className,
}: LittStatusMarkProps) {
    const g = littStatusMarkGeometry(size);
    const f = g.frame;
    const outline =
        `M${g.x} ${g.y}h${g.square}v${g.square}h${-g.square}Z ` +
        `M${g.x + f} ${g.y + f}v${g.square - 2 * f}h${g.square - 2 * f}v${-(g.square - 2 * f)}Z`;
    // Three dots, 1u wide with a 1u gap, centred under the square. They span
    // 5u, so they fit the box at every size from 14 px up.
    const dotsX = g.x + (g.square - 5 * g.u) / 2;

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`litt-status-mark${className ? ` ${className}` : ""}`}
            data-state={state}
            data-hue={hue}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={
                hue
                    ? ({
                          "--litt-status-hue": `var(--litt-status-hue-${hue})`,
                      } as React.CSSProperties)
                    : undefined
            }
            aria-hidden="true"
            focusable="false"
        >
            <rect className="lsm-lead" x={0} y={g.ruleY} width={g.x} height={g.u} />
            <rect className="lsm-rule" x={0} y={g.ruleY} width={size} height={g.u} />
            {[0, 1, 2].map((i) => (
                <rect
                    key={i}
                    className={`lsm-dot lsm-dot-${i + 1}`}
                    x={dotsX + 2 * g.u * i}
                    y={g.ruleY}
                    width={g.u}
                    height={g.u}
                />
            ))}
            <rect className="lsm-square" x={g.x} y={g.y} width={g.square} height={g.square} />
            <path className="lsm-outline" fillRule="evenodd" d={outline} />
        </svg>
    );
}
