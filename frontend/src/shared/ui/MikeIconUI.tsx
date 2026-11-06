"use client";

import React, { useId, useSyncExternalStore } from "react";

const DEGREES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const STOP_TRANSITION = "stop-color 220ms ease, stop-opacity 220ms ease";

type IconPalette = {
    fillStops: [string, string, string, string];
    fillOpacities: [number, number, number, number];
    specularStops: [number, number, number, number];
    borderStops: [string, string, string];
    borderOpacities: [number, number, number];
    innerStops: [string, string, string, string];
    innerOpacities: [number, number, number, number];
};

const DEFAULT_PALETTE: IconPalette = {
    fillStops: ["#0a0a0a", "#151515", "#080808", "#111111"],
    fillOpacities: [0.9, 0.8, 0.85, 0.9],
    specularStops: [0.5, 0.2, 0, 0],
    borderStops: ["#ffffff", "#666666", "#ffffff"],
    borderOpacities: [0.3, 0.1, 0.2],
    innerStops: ["#ffffff", "#777777", "#222222", "#ffffff"],
    innerOpacities: [0, 0.08, 0.05, 0],
};

const DONE_PALETTE: IconPalette = {
    fillStops: ["#4ade80", "#86efac", "#22c55e", "#bbf7d0"],
    fillOpacities: [0.95, 0.88, 0.9, 0.94],
    specularStops: [0.68, 0.32, 0.03, 0],
    borderStops: ["#f0fdf4", "#86efac", "#dcfce7"],
    borderOpacities: [0.42, 0.24, 0.3],
    innerStops: ["#ffffff", "#dcfce7", "#4ade80", "#ffffff"],
    innerOpacities: [0, 0.16, 0.08, 0],
};

const ERROR_PALETTE: IconPalette = {
    fillStops: ["#f87171", "#fca5a5", "#ef4444", "#fecaca"],
    fillOpacities: [0.95, 0.88, 0.9, 0.94],
    specularStops: [0.68, 0.32, 0.03, 0],
    borderStops: ["#fef2f2", "#fca5a5", "#fee2e2"],
    borderOpacities: [0.42, 0.24, 0.3],
    innerStops: ["#ffffff", "#fee2e2", "#f87171", "#ffffff"],
    innerOpacities: [0, 0.16, 0.08, 0],
};

// Tints that tell several marks apart, such as subagents working side by
// side. Each follows the status palettes' recipe one step darker on one
// Tailwind hue (fill 500/400/600/300, border 100/400/200, inner
// white/200/500/white), so a small mark keeps its colour against a light
// surface. Red and green are left out so a tint never reads as an error or
// as done.
type TintScale = [string, string, string, string, string, string];

function tintPalette([c100, c200, c300, c400, c500, c600]: TintScale): IconPalette {
    return {
        fillStops: [c500, c400, c600, c300],
        fillOpacities: [0.95, 0.88, 0.9, 0.94],
        specularStops: [0.68, 0.32, 0.03, 0],
        borderStops: [c100, c400, c200],
        borderOpacities: [0.42, 0.24, 0.3],
        innerStops: ["#ffffff", c200, c500, "#ffffff"],
        innerOpacities: [0, 0.16, 0.08, 0],
    };
}

// Tailwind 100–600 for each hue: the categorical palette documented in
// docs/design-system.md ("Categorical palettes"). No blue family (Marca LiTT
// v1.0, "Sin azul"), and no amber, which the brand reserves for focus and its
// marks.
const TINT_PALETTES = {
    stone: tintPalette(["#f5f5f4", "#e7e5e4", "#d6d3d1", "#a8a29e", "#78716c", "#57534e"]),
    teal: tintPalette(["#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#14b8a6", "#0d9488"]),
    rose: tintPalette(["#ffe4e6", "#fecdd3", "#fda4af", "#fb7185", "#f43f5e", "#e11d48"]),
    lime: tintPalette(["#ecfccb", "#d9f99d", "#bef264", "#a3e635", "#84cc16", "#65a30d"]),
    pink: tintPalette(["#fce7f3", "#fbcfe8", "#f9a8d4", "#f472b6", "#ec4899", "#db2777"]),
    emerald: tintPalette(["#d1fae5", "#a7f3d0", "#6ee7b7", "#34d399", "#10b981", "#059669"]),
} satisfies Record<string, IconPalette>;

export type MikeIconTint = keyof typeof TINT_PALETTES;

/** The tints in the order a list of marks should take them. */
export const MIKE_ICON_TINTS = Object.keys(TINT_PALETTES) as MikeIconTint[];

// The dark mark, inverted for dark surfaces: white glass blades shaded with
// the tinta-papel gray ramp, with the depth cues (inner shading, hairline
// border) darkened instead of lightened so overlapping blades stay readable
// against a dark background.
const WHITE_PALETTE: IconPalette = {
    fillStops: ["#ffffff", "#f2f2ed", "#f9f9f7", "#ffffff"],
    fillOpacities: [0.95, 0.85, 0.9, 0.95],
    specularStops: [0.7, 0.3, 0, 0],
    borderStops: ["#151a26", "#4d515a", "#151a26"],
    borderOpacities: [0.28, 0.12, 0.18],
    innerStops: ["#151a26", "#393e48", "#e7e7e2", "#151a26"],
    innerOpacities: [0, 0.1, 0.06, 0],
};

// The mark is inline SVG, so the neutral-palette dark remapping in
// globals.css cannot reach it; it watches the document theme class itself.
// One observer serves every icon on the page. Targets that never set the
// class (the Word add-in) always read false and keep the dark mark.
const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | null = null;

function subscribeToTheme(listener: () => void): () => void {
    themeListeners.add(listener);
    if (!themeObserver && typeof MutationObserver !== "undefined") {
        themeObserver = new MutationObserver(() => {
            themeListeners.forEach((notify) => notify());
        });
        themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }

    return () => {
        themeListeners.delete(listener);
        if (themeListeners.size === 0) {
            themeObserver?.disconnect();
            themeObserver = null;
        }
    };
}

function readDarkTheme(): boolean {
    return (
        typeof document !== "undefined" &&
        document.documentElement.classList.contains("dark")
    );
}

function readDarkThemeOnServer(): boolean {
    return false;
}

function useDarkTheme(): boolean {
    return useSyncExternalStore(
        subscribeToTheme,
        readDarkTheme,
        readDarkThemeOnServer,
    );
}

function GlassGradient({
    offsets,
    colors,
    opacities,
    ...props
}: React.SVGProps<SVGLinearGradientElement> & {
    offsets: number[];
    colors: string | string[];
    opacities: number[];
}) {
    return (
        <linearGradient {...props}>
            {offsets.map((offset, index) => (
                <stop
                    key={offset}
                    offset={`${offset}%`}
                    style={{
                        stopColor: typeof colors === "string" ? colors : colors[index],
                        stopOpacity: opacities[index],
                        transition: STOP_TRANSITION,
                    }}
                />
            ))}
        </linearGradient>
    );
}

function Blades({ ids }: { ids: Record<string, string> }) {
    return (
        <g transform="translate(250, 250)">
            {DEGREES.map((deg) => (
                <g key={deg} transform={`rotate(${deg})`}>
                    <use
                        href={`#${ids.blade}`}
                        fill={`url(#${ids.glassFill})`}
                    />
                    <use
                        href={`#${ids.blade}`}
                        fill={`url(#${ids.innerLight})`}
                    />
                    <use
                        href={`#${ids.blade}`}
                        fill={`url(#${ids.specular})`}
                        clipPath={`url(#${ids.topClip})`}
                    />
                    <use
                        href={`#${ids.blade}`}
                        fill="none"
                        stroke={`url(#${ids.glassBorder})`}
                        strokeWidth="0.8"
                    />
                </g>
            ))}
        </g>
    );
}

export function MikeIcon({
    spin = false,
    done = false,
    error = false,
    mike = false,
    tint,
    size = 24,
    style,
}: {
    spin?: boolean;
    done?: boolean;
    error?: boolean;
    mike?: boolean;
    /** A colour for the mark; the status palettes take precedence. */
    tint?: MikeIconTint;
    size?: number;
    style?: React.CSSProperties;
}) {
    void mike;
    const id = useId().replace(/:/g, "");
    const darkTheme = useDarkTheme();
    const palette = error
        ? ERROR_PALETTE
        : done
          ? DONE_PALETTE
          : tint
            ? TINT_PALETTES[tint]
            : darkTheme
              ? WHITE_PALETTE
              : DEFAULT_PALETTE;
    const m = {
        glassFill: `${id}-m-glassFill`,
        specular: `${id}-m-specular`,
        glassBorder: `${id}-m-glassBorder`,
        innerLight: `${id}-m-innerLight`,
        topClip: `${id}-m-topClip`,
        blade: `${id}-m-blade`,
    };

    return (
        <span
            className="shrink-0 inline-block animate-[spin_3s_linear_infinite]"
            style={{
                animationPlayState: spin ? "running" : "paused",
                ...style,
            }}
        >
            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="100 100 300 300"
                width={size}
                height={size}
                style={{ display: "block" }}
            >
                <defs>
                    <GlassGradient
                        id={m.glassFill}
                        x1="0%" y1="0%" x2="100%" y2="100%"
                        offsets={[0, 30, 70, 100]}
                        colors={palette.fillStops}
                        opacities={palette.fillOpacities}
                    />
                    <GlassGradient
                        id={m.specular}
                        x1="0%" y1="0%" x2="0%" y2="100%"
                        offsets={[0, 15, 35, 100]}
                        colors="#ffffff"
                        opacities={palette.specularStops}
                    />
                    <GlassGradient
                        id={m.glassBorder}
                        x1="0%" y1="0%" x2="0%" y2="100%"
                        offsets={[0, 50, 100]}
                        colors={palette.borderStops}
                        opacities={palette.borderOpacities}
                    />
                    <GlassGradient
                        id={m.innerLight}
                        x1="100%" y1="0%" x2="0%" y2="100%"
                        offsets={[0, 40, 60, 100]}
                        colors={palette.innerStops}
                        opacities={palette.innerOpacities}
                    />
                    <clipPath id={m.topClip}>
                        <rect x="30" y="-25" width="130" height="23" />
                    </clipPath>
                    <path
                        id={m.blade}
                        d="M 40,0 A 4,4 0 0 1 43,-3 Q 95,-22 147,-3 A 4,4 0 0 1 150,0 A 4,4 0 0 1 147,3 Q 95,22 43,3 A 4,4 0 0 1 40,0 Z"
                    />
                </defs>

                <Blades ids={m} />
            </svg>
        </span>
    );
}
