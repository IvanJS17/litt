/**
 * The surface of the composer's send button, without its size or corner
 * radius. Shared so every control that sends something into the chat, on the
 * web and in the Word add-in, is the same button.
 *
 * Option "A" (owner decision, 2026-11-13): tinta fill, ámbar fósforo arrow,
 * soft corners. It is an approved exception to DESIGN.md rule 7 (amber never
 * outside the square): the amber arrow appears ONLY in the ready state. The
 * disabled button is gray and "Stop" is a papel square on tinta; neither has
 * amber. Every color is a `--litt-send-*` token in `DesignTokensUI.css`, so
 * both themes and the Word add-in share them. The dark theme's papel edge is
 * the inset ring. Draw the glyph with `SendArrowUI`. Keyboard focus is the
 * global outline; the disabled state is a real `disabled`.
 */
export const COMPOSER_SEND_BUTTON_CLASS =
    "relative flex cursor-pointer items-center justify-center border-0 bg-[var(--litt-send-bg)] text-[var(--litt-send-fg)] shadow-[inset_0_0_0_1px_var(--litt-send-edge)] transition-[transform,background-color,box-shadow] duration-150 motion-reduce:transition-none enabled:hover:bg-[var(--litt-send-bg-hover)] enabled:hover:shadow-[inset_0_0_0_1px_var(--litt-send-edge-hover)] active:enabled:scale-95 disabled:cursor-default disabled:bg-[var(--litt-send-bg-disabled)] disabled:text-[var(--litt-send-fg-disabled)] disabled:shadow-none";
