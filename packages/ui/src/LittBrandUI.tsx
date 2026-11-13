/**
 * LiTT brand marks, v1.0.
 *
 * The wordmark is drawn from the outlined SVGs in `docs/brand/svg/`: the
 * paths below are copied from `litt-wordmark-color-*.svg` without changes.
 * Never retype the wordmark in a font, and never put the amber on a letter.
 * The rules are in `docs/brand/DESIGN.md` and are summarized under "Marca LiTT
 * v1.0" in `docs/design-system.md`.
 *
 * Both marks are transparent: they take the surface they sit on, and their
 * colors come from `--litt-mark-ink` and `--litt-mark-accent`
 * (`DesignTokensUI.css`). Those switch with the `.dark` class, so the light
 * theme always gets the light version (tinta letters, ámbar tinta square) and
 * the dark theme the dark one (papel letters, ámbar fósforo square). Place a
 * mark only on a papel or white surface in the light theme and on a tinta
 * surface in the dark theme.
 *
 * Nothing here animates. The square is a cursor that never blinks or pulses.
 * The one exception is the response-status indicator (`LittStatusMarkUI`),
 * whose motion spec the owner approved on 2026-11-13 (DESIGN.md, rules 9
 * and 10); these two marks stay still.
 */

/** Unit grid of the wordmark, protection area included: 36u × 18.3709u. */
const WORDMARK_WIDTH_U = 36;
const WORDMARK_HEIGHT_U = 18.3709;

/**
 * X is the font-size of Departure Mono and u = X / 11. Below X = 66 the
 * wordmark needs X to be a multiple of 11 so ıTT lands on whole pixels, and
 * below X = 22 it must not be used at all (use the monogram instead).
 */
export const LITT_WORDMARK_X_SIZES = [22, 33, 44, 55, 66, 88] as const;
export type LittWordmarkX = (typeof LITT_WORDMARK_X_SIZES)[number];

/** The pixel monogram exists at these native sizes only, never scaled. */
export const LITT_PIXEL_MONOGRAM_SIZES = [16, 32, 48] as const;
export type LittPixelMonogramSize = (typeof LITT_PIXEL_MONOGRAM_SIZES)[number];

const INK = "var(--litt-mark-ink, #151A26)";
const ACCENT = "var(--litt-mark-accent, #965900)";

const SERIF_L_PATH =
    "M1186.1381225585938 -66.29632568359375H1168.8098754882812L1027.66552734375 0H360.577392578125V76.96044921875H1155.0014038085938L996.3372802734375 43.05621337890625L1268.8341674804688 444.82513427734375L1302.3143920898438 436.12908935546875ZM556.8827514648438 1353.6398315429688V0H59.09576416015625V32.81610107421875L222.83135986328125 77.36016845703125V1353.6398315429688L59.09576416015625 1396.7598876953125V1430H720.6183471679688V1396.7598876953125Z";
const PIXEL_DOTLESS_I_PATH = "M150 250V50H50V0H300V50H200V300H50V250Z";
const PIXEL_T_PATH = "M50 400V350H150V0H200V350H300V400Z";

export interface LittWordmarkProps {
    /** Font-size of Departure Mono in CSS pixels. Defaults to the 22px minimum. */
    x?: LittWordmarkX;
    className?: string;
    /**
     * Hide the mark from assistive technology when a visible or
     * screen-reader-only "LiTT" already names the surrounding control.
     */
    decorative?: boolean;
}

/**
 * The LiTT wordmark with its 4u protection area built into the box. Its
 * width is 36u and its height 18.3709u, rounded up to a whole pixel so the
 * pixel letters keep falling on whole pixels.
 */
export function LittWordmark({
    x = 22,
    className,
    decorative = false,
}: LittWordmarkProps) {
    const u = x / 11;
    return (
        <svg
            data-slot="litt-wordmark"
            data-x={x}
            viewBox={`0 0 ${WORDMARK_WIDTH_U} ${WORDMARK_HEIGHT_U}`}
            width={WORDMARK_WIDTH_U * u}
            height={Math.ceil(WORDMARK_HEIGHT_U * u)}
            preserveAspectRatio="xMinYMin meet"
            className={["block shrink-0", className].filter(Boolean).join(" ")}
            {...(decorative
                ? { "aria-hidden": true, focusable: false }
                : { role: "img", "aria-label": "LiTT" })}
        >
            <g style={{ fill: INK }}>
                <path
                    transform="translate(3.6694 14) scale(0.0056 -0.0056)"
                    d={SERIF_L_PATH}
                />
                <g shapeRendering="crispEdges">
                    <path
                        transform="translate(12 14) scale(0.02 -0.02)"
                        d={PIXEL_DOTLESS_I_PATH}
                    />
                    <path
                        transform="translate(19 14) scale(0.02 -0.02)"
                        d={PIXEL_T_PATH}
                    />
                    <path
                        transform="translate(26 14) scale(0.02 -0.02)"
                        d={PIXEL_T_PATH}
                    />
                </g>
            </g>
            <rect
                data-slot="litt-square"
                x="14"
                y="4"
                width="3"
                height="3"
                shapeRendering="crispEdges"
                style={{ fill: ACCENT }}
            />
        </svg>
    );
}

export interface PixelRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Geometry of the «L.» pixel monogram at a native size, in pixels.
 *
 * The canvas is 16u, so u = 1px at 16, 2px at 32 and 3px at 48. The Departure
 * Mono L is 5u × 8u (a 1u stem and a 5u foot), then a 1u gap and the 3u
 * square on the baseline. The ink is centered horizontally (rounded half up
 * to a whole pixel) and vertically, exactly as the package's favicons are.
 */
export function littPixelMonogramGeometry(size: LittPixelMonogramSize): {
    stem: PixelRect;
    foot: PixelRect;
    square: PixelRect;
} {
    const u = size / 16;
    const x0 = Math.round((size - 9 * u) / 2);
    const y0 = (size - 8 * u) / 2;
    return {
        stem: { x: x0, y: y0, width: u, height: 8 * u },
        foot: { x: x0, y: y0 + 7 * u, width: 5 * u, height: u },
        square: { x: x0 + 6 * u, y: y0 + 5 * u, width: 3 * u, height: 3 * u },
    };
}

export interface LittMonogramPixelProps {
    /** One of the native sizes; the monogram is never scaled between them. */
    size?: LittPixelMonogramSize;
    className?: string;
    /** Hide it from assistive technology when "LiTT" is already named nearby. */
    decorative?: boolean;
}

/**
 * The «L.» pixel monogram, for places with less room than the 22px wordmark
 * minimum: 48px or smaller, at 16, 32 or 48px exactly. It is always «L.»
 * with its square; the L alone is never the reduced mark.
 */
export function LittMonogramPixel({
    size = 16,
    className,
    decorative = false,
}: LittMonogramPixelProps) {
    const { stem, foot, square } = littPixelMonogramGeometry(size);
    return (
        <svg
            data-slot="litt-monogram"
            data-size={size}
            viewBox={`0 0 ${size} ${size}`}
            width={size}
            height={size}
            shapeRendering="crispEdges"
            className={["block shrink-0", className].filter(Boolean).join(" ")}
            {...(decorative
                ? { "aria-hidden": true, focusable: false }
                : { role: "img", "aria-label": "LiTT" })}
        >
            <g style={{ fill: INK }}>
                <rect {...stem} />
                <rect {...foot} />
            </g>
            <rect data-slot="litt-square" {...square} style={{ fill: ACCENT }} />
        </svg>
    );
}
