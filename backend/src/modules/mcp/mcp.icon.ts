// The server's icon, declared in the initialize result (serverInfo.icons).
// Claude never fetches icon URLs: it needs an inline data: URI, PNG or JPEG,
// 64-128 px, under 10 KB. This is LiTT's small-size mark (the 16 px variant, #u16, of
// frontend/src/app/icon.svg, the favicon source: «L» with the amber square on the
// brand navy), rendered at 128x128 and palette-reduced. Regenerate with:
//   rsvg-convert -w 128 -h 128 frontend/src/app/icon.svg -o raw.png
//   python3 -c "from PIL import Image; Image.open('raw.png').convert('RGB').quantize(colors=8).save('assets/litt-icon-128.png', optimize=True)"
//   base64 -w0 assets/litt-icon-128.png
// (assets/litt-icon-128.png is the same image, kept for review.) A module, not a
// runtime file read, so tsc output and the image need nothing extra.

export const LITT_ICON_PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAIAAAACAAgMAAAC+UIlYAAAACVBMVEXs7Ob/sh4VGiatpvaVAAAARUlEQVR42u3XwQ0AIAhD0WJcUYbEJT15Qxfo75G8U0NCiNI/QwAAwB1k0gMAAAA0md1wS5IWRVnvwz2c5dhD8F8AAIBHDptSBQPm04y6AAAAAElFTkSuQmCC";

export const LITT_MCP_ICON = {
    src: `data:image/png;base64,${LITT_ICON_PNG_BASE64}`,
    mimeType: "image/png",
    sizes: ["128x128"],
} as const;
