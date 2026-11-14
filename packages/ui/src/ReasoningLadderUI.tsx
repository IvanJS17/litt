"use client";

import * as React from "react";

/**
 * The reasoning ladder: one step per level the model offers, not counting
 * "none". It replaces the slider with a gradient. Two drawings of one control
 * (owner decision, 2026-11-13):
 *
 * - `ReasoningMiniUI`, beside the model's name: tinta (papel in the dark
 *   theme), 3 px wide steps of 4, 6, 8 and 10 px. Decorative.
 * - `ReasoningLadderUI`, inside the menu: amber, with steps of 6, 8, 10 and
 *   12 px. It is the keyboard control. The filled steps are the one amber
 *   outside the square, an approved exception to DESIGN.md rule 7; their
 *   colors are the `--litt-ladder-*` tokens in `DesignTokensUI.css`.
 *
 * Both fill from the bottom up when the level goes up and empty downward when
 * it goes down, once, in under 300 ms (see `ladderStepMotions`). There is no
 * animation for the keyboard, for a drag, under `prefers-reduced-motion`, nor
 * while LiTT is working, and none when the menu opens: the ladder arrives
 * still.
 */

/** A level that is not a step: the ladder starts above it. */
const NONE_LEVEL = "none";

/** Heights of the first and the last step, in px. */
export const LADDER_HEIGHTS = {
    menu: { min: 6, max: 12 },
    mini: { min: 4, max: 10 },
} as const;

export type LadderKind = keyof typeof LADDER_HEIGHTS;

/** The steps of a model's levels: every level except "none". */
export function ladderStepCount(levels: readonly string[]): number {
    return levels.filter((level) => level !== NONE_LEVEL).length;
}

/** How many steps are filled at `level`; "none" fills none. */
export function ladderFilledSteps(
    levels: readonly string[],
    level: string,
): number {
    if (level === NONE_LEVEL) return 0;
    const steps = levels.filter((candidate) => candidate !== NONE_LEVEL);
    const index = steps.indexOf(level);
    return index < 0 ? 0 : index + 1;
}

/** The level that fills `filled` steps, or undefined when there is none. */
export function ladderLevelForFilled<L extends string>(
    levels: readonly L[],
    filled: number,
): L | undefined {
    if (filled <= 0) return levels.find((level) => level === NONE_LEVEL);
    return levels.filter((level) => level !== NONE_LEVEL)[filled - 1];
}

/** Height of step `index` of `count`, rising evenly from min to max. */
export function ladderStepHeight(
    index: number,
    count: number,
    kind: LadderKind,
): number {
    const { min, max } = LADDER_HEIGHTS[kind];
    return Math.round(count > 1 ? min + ((max - min) * index) / (count - 1) : max);
}

export const LADDER_EASE = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Duration, stagger between steps and cap of the whole stagger, in ms. */
export const LADDER_MOTION = {
    menu: {
        up: { duration: 160, stagger: 30, cap: 90 },
        down: { duration: 110, stagger: 20, cap: 60 },
    },
    mini: {
        up: { duration: 140, stagger: 20, cap: 60 },
        down: { duration: 100, stagger: 15, cap: 45 },
    },
} as const;

export interface LadderStepMotion {
    duration: number;
    delay: number;
}

/**
 * The transition of each step when the level goes from `from` to `to` filled
 * steps. Only the steps that change move: going up they fill bottom to top,
 * `stagger` ms apart; going down the highest empties first. The whole
 * stagger never passes `cap`. `instant` (keyboard, drag, reduced motion, a
 * working LiTT) gives every step a 0 ms transition.
 */
export function ladderStepMotions(
    from: number,
    to: number,
    count: number,
    kind: LadderKind,
    instant: boolean,
): LadderStepMotion[] {
    const still = Array.from({ length: count }, () => ({
        duration: 0,
        delay: 0,
    }));
    if (instant || from === to) return still;
    const up = to > from;
    const cfg = LADDER_MOTION[kind][up ? "up" : "down"];
    const changed = up
        ? Array.from({ length: to - from }, (_, k) => from + k)
        : Array.from({ length: from - to }, (_, k) => from - 1 - k);
    const stagger =
        changed.length > 1
            ? Math.min(cfg.stagger, cfg.cap / (changed.length - 1))
            : 0;
    return still.map((motion, index) => {
        const order = changed.indexOf(index);
        return order < 0
            ? motion
            : { duration: cfg.duration, delay: order * stagger };
    });
}

function subscribeReducedMotion(onChange: () => void): () => void {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
}

function reducedMotionSnapshot(): boolean {
    return (
        typeof window !== "undefined" &&
        !!window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

/** Whether the system asks for no motion. */
export function usePrefersReducedMotion(): boolean {
    return React.useSyncExternalStore(
        subscribeReducedMotion,
        reducedMotionSnapshot,
        () => false,
    );
}

/**
 * The motion of each step for the latest change of `filled`, or all still
 * until there is one. Computed while rendering, from the previous value, so
 * the new level and its transition arrive in the same frame. An interrupted
 * change simply retargets: the final state is always the one asked for.
 */
export function useLadderMotion(
    filled: number,
    count: number,
    kind: LadderKind,
    instant: boolean,
): LadderStepMotion[] {
    const reduced = usePrefersReducedMotion();
    const [state, setState] = React.useState<{
        filled: number;
        motions: LadderStepMotion[] | null;
    }>({ filled, motions: null });
    let current = state;
    if (state.filled !== filled) {
        current = {
            filled,
            motions: ladderStepMotions(
                state.filled,
                filled,
                count,
                kind,
                instant || reduced,
            ),
        };
        setState(current);
    }
    return current.motions ?? ladderStepMotions(0, 0, count, kind, true);
}

function stepStyle(
    index: number,
    count: number,
    kind: LadderKind,
    motion: LadderStepMotion,
): React.CSSProperties {
    return {
        "--ladder-h": `${ladderStepHeight(index, count, kind)}px`,
        "--ladder-t": count > 1 ? index / (count - 1) : 1,
        "--ladder-dur": `${motion.duration}ms`,
        "--ladder-delay": `${motion.delay}ms`,
        "--ladder-ease": LADDER_EASE,
    } as React.CSSProperties;
}

/** The thumbnail beside the model's name: tinta (papel in dark), rising. */
export function ReasoningMiniUI<L extends string>({
    levels,
    level,
    instant = false,
    className,
}: {
    levels: readonly L[];
    level: L;
    /** No transition: LiTT is working, or the keyboard or a drag moved it. */
    instant?: boolean;
    className?: string;
}): React.ReactElement {
    const count = ladderStepCount(levels);
    const filled = ladderFilledSteps(levels, level);
    const motions = useLadderMotion(filled, count, "mini", instant);
    return (
        <span
            aria-hidden="true"
            data-litt-ladder-mini=""
            data-level={filled}
            className={`litt-ladder-mini ${className ?? ""}`}
        >
            {motions.map((motion, index) => (
                <span
                    key={index}
                    className="litt-ladder-mini-step"
                    data-on={index < filled ? "true" : "false"}
                    style={stepStyle(index, count, "mini", motion)}
                >
                    <i />
                </span>
            ))}
        </span>
    );
}

export type LadderChangeSource = "pointer" | "key" | "drag";

const KEY_OFFSETS: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    ArrowUp: 1,
    PageUp: 1,
    ArrowLeft: -1,
    ArrowDown: -1,
    PageDown: -1,
};

/**
 * The ladder inside the menu: a `slider` of `count` steps. Arrow keys, Page
 * Up/Down, Home and End move it with no animation; a click or touch on step k
 * chooses its level (the first step again chooses "none", when the model
 * allows it); dragging follows the finger, also without animation. With a
 * mouse, the steps up to the pointer are outlined and `onPreview` reports the
 * level a click would choose.
 */
export function ReasoningLadderUI<L extends string>({
    levels,
    level,
    onChange,
    onPreview,
    label,
    valueText,
    className,
    ref: forwardedRef,
}: {
    levels: readonly L[];
    level: L;
    onChange: (level: L, source: LadderChangeSource) => void;
    /** The level a click would choose, or null when the pointer leaves. */
    onPreview?: (level: L | null) => void;
    /** The accessible name, "Reasoning level". */
    label: string;
    /** The accessible value, the current level's name. */
    valueText: string;
    className?: string;
    ref?: React.Ref<HTMLDivElement>;
}): React.ReactElement {
    const count = ladderStepCount(levels);
    const filled = ladderFilledSteps(levels, level);
    const hasNone = levels.includes(NONE_LEVEL as L);
    const min = hasNone ? 0 : 1;
    const [previewFilled, setPreviewFilled] = React.useState<number | null>(
        null,
    );
    const [source, setSource] = React.useState<LadderChangeSource>("pointer");
    const motions = useLadderMotion(filled, count, "menu", source !== "pointer");
    const dragging = React.useRef(false);
    const localRef = React.useRef<HTMLDivElement | null>(null);

    const setRefs = (node: HTMLDivElement | null): void => {
        localRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
    };

    const change = (to: number, via: LadderChangeSource): void => {
        const next = ladderLevelForFilled(levels, to);
        if (next === undefined || next === level) return;
        setSource(via);
        onChange(next, via);
    };

    const stepAt = (clientX: number): number => {
        const rect = localRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return 0;
        const raw = Math.floor(((clientX - rect.left) / rect.width) * count);
        return Math.max(0, Math.min(count - 1, raw));
    };

    const onKeyDown = (event: React.KeyboardEvent): void => {
        let to: number | null = null;
        if (event.key === "Home") to = min;
        else if (event.key === "End") to = count;
        else if (KEY_OFFSETS[event.key] !== undefined) {
            to = Math.min(
                count,
                Math.max(min, filled + KEY_OFFSETS[event.key]!),
            );
        }
        if (to === null) return;
        event.preventDefault();
        // The menu's own arrow keys must not also move its highlight.
        event.stopPropagation();
        change(to, "key");
    };

    const preview = (clientX: number): void => {
        const to = stepAt(clientX) + 1;
        setPreviewFilled(to);
        onPreview?.(to === filled ? null : (ladderLevelForFilled(levels, to) ?? null));
    };

    const clearPreview = (): void => {
        setPreviewFilled(null);
        onPreview?.(null);
    };

    return (
        <div
            ref={setRefs}
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-orientation="horizontal"
            aria-valuemin={min}
            aria-valuemax={count}
            aria-valuenow={filled}
            aria-valuetext={valueText}
            data-litt-ladder=""
            className={`litt-ladder ${className ?? ""}`}
            onKeyDown={onKeyDown}
            onPointerDown={(event) => {
                // A press here is the ladder's, not the menu item's.
                event.stopPropagation();
                dragging.current = true;
                try {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                } catch {
                    // A pointer that is already gone has nothing to capture.
                }
                const step = stepAt(event.clientX);
                // The first step again turns reasoning off, when it can be.
                change(step === 0 && filled === 1 && hasNone ? 0 : step + 1, "pointer");
            }}
            onPointerMove={(event) => {
                if (dragging.current) {
                    const to = stepAt(event.clientX) + 1;
                    if (to !== filled) change(to, "drag");
                    return;
                }
                if (event.pointerType === "mouse") preview(event.clientX);
            }}
            onPointerUp={() => {
                dragging.current = false;
            }}
            onPointerCancel={() => {
                dragging.current = false;
            }}
            onPointerLeave={clearPreview}
            onBlur={clearPreview}
        >
            {motions.map((motion, index) => (
                <span
                    key={index}
                    className="litt-ladder-step"
                    data-on={index < filled ? "true" : "false"}
                    data-preview={
                        previewFilled !== null && index < previewFilled
                            ? "true"
                            : "false"
                    }
                    style={stepStyle(index, count, "menu", motion)}
                >
                    <i />
                </span>
            ))}
        </div>
    );
}
