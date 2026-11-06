import { LittWordmark, type LittWordmarkX } from "@/shared/ui/LittBrandUI";

/** LiTT's own public page. MikeOSS, the upstream, is credited in the README. */
export const LITT_HOME_URL = "https://asteroitt.com/#producto-litt";

interface SiteLogoProps {
    size?: "sm" | "md" | "lg" | "xl";
    className?: string;
    asLink?: boolean;
}

/** X (the wordmark's module) for each size; every one is a multiple of 11. */
const WORDMARK_X: Record<NonNullable<SiteLogoProps["size"]>, LittWordmarkX> = {
    sm: 22,
    md: 33,
    lg: 44,
    xl: 66,
};

/**
 * The LiTT wordmark as the page's top heading. The mark is the outlined
 * brand SVG, named "LiTT" for assistive technology. It never fades, dims or
 * moves, so the link has no hover effect on it, only a focus ring.
 */
export function SiteLogo({
    size = "md",
    className = "",
    asLink = false,
}: SiteLogoProps) {
    const logo = (
        <h1 className={`flex ${className}`.trim()}>
            <LittWordmark x={WORDMARK_X[size]} />
        </h1>
    );

    if (asLink) {
        return (
            <a
                href={LITT_HOME_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
                {logo}
                <span className="sr-only"> (opens in a new tab)</span>
            </a>
        );
    }

    return logo;
}
