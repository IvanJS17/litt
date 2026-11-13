/**
 * Grows a control's tappable area to 44 px (Apple's minimum) on a touch
 * screen without moving or resizing anything the eye sees: an invisible
 * square centred on the control. `pointer-coarse:` applies only when the
 * primary pointer is a finger, so on a desktop nothing changes.
 *
 * Put it before the caller's classes in a `twMerge`/`cn` call, so a caller's
 * own `absolute`/`fixed` positioning wins over the `relative` that anchors the
 * square.
 */
export const TOUCH_TARGET_CLASS =
    "relative pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-1/2 pointer-coarse:after:content-['']";
