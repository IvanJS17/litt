/** The product name every tab title ends with: "Settings · LiTT". */
export const BRAND = "LiTT";
export const TITLE_SEPARATOR = " · ";
/** For Next's `title.template`: the screen's name, then the product. */
export const TITLE_TEMPLATE = `%s${TITLE_SEPARATOR}${BRAND}`;

export function titleFor(name: string): string {
    return `${name}${TITLE_SEPARATOR}${BRAND}`;
}
