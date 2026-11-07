/**
 * A sidebar row owns its hover fill, so it also draws the focus ring when
 * the button inside it that carries `data-focus-fill` is focused from the
 * keyboard. The button itself stays `outline-none`.
 */
export const SIDEBAR_ROW_FOCUS_RING_CLASS =
    "has-[[data-focus-fill]:focus-visible]:ring-2 has-[[data-focus-fill]:focus-visible]:ring-inset has-[[data-focus-fill]:focus-visible]:ring-focus";
