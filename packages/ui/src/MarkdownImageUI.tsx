import type { ComponentPropsWithoutRef, ReactElement } from "react";

/** The page's own origin compared with `url`'s; null when `url` cannot be parsed. */
function isSameOrigin(url: string): boolean | null {
  if (typeof window === "undefined") return false;
  try {
    return new URL(url, window.location.href).origin === window.location.origin;
  } catch {
    return null;
  }
}

/**
 * The `img` renderer for Markdown written by a model or another person. An
 * image from another site would load with no click, and its URL can carry
 * data, so it is drawn as a link to the image (opened in a new tab) with the
 * alt text; an image from the page's own origin is drawn as an image; an empty
 * or unparsable address draws nothing.
 */
export function MarkdownImageUI(
  props: ComponentPropsWithoutRef<"img"> & { node?: unknown },
): ReactElement | null {
  const { node, src, alt, ...imageProps } = props;
  void node;
  if (typeof src !== "string" || !src) return null;
  const sameOrigin = isSameOrigin(src);
  if (sameOrigin === null) return null;
  if (!sameOrigin) {
    return (
      <a
        href={src}
        className="text-interactive hover:text-interactive-hover underline [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        target="_blank"
        rel="noopener noreferrer"
      >
        {alt?.trim() || src}
      </a>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- markdown content, not an optimizable page asset
    <img src={src} alt={alt ?? ""} {...imageProps} />
  );
}

const SAFE_TABLES = new WeakMap<object, object>();
const IMAGES_ONLY = Object.freeze({ img: MarkdownImageUI });

/**
 * The `components` table for a Markdown renderer, with the image rule applied
 * last: a caller's own table cannot replace it. Every `<ReactMarkdown>` in
 * production code passes its table through here (an architecture test checks).
 * The same input gives the same output, so the renderer receives a stable
 * object across renders. The tables are frozen: assigning to one throws in
 * strict mode (and does nothing otherwise), so no caller can change the rule
 * for the others.
 */
export function withSafeMarkdownImages<T extends object>(
  components?: T,
): T & { img: typeof MarkdownImageUI } {
  if (!components) return IMAGES_ONLY as T & { img: typeof MarkdownImageUI };
  let safe = SAFE_TABLES.get(components);
  if (!safe) {
    safe = Object.freeze({ ...components, img: MarkdownImageUI });
    SAFE_TABLES.set(components, safe);
  }
  return safe as T & { img: typeof MarkdownImageUI };
}
