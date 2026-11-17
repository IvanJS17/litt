import type { ReactNode } from "react";
import { LANDING_PIXEL } from "./landingStyles";

/**
 * The head every section shares: the marker (PRIMERO … QUINTO, Departure Mono,
 * decorative) in the left margin from 960 px, above the title on a phone, and
 * the title with its lede on the right, aligned on their first baseline.
 */
export function SectionHead({
    marker,
    id,
    title,
    children,
}: {
    marker: string;
    id: string;
    title: string;
    children?: ReactNode;
}) {
    return (
        <div className="mb-[clamp(32px,5vw,56px)] grid grid-cols-1 gap-4 min-[960px]:grid-cols-[minmax(0,3fr)_minmax(0,9fr)] min-[960px]:items-baseline">
            <p className="text-muted-foreground">
                <span aria-hidden="true" className={LANDING_PIXEL}>
                    {marker}
                </span>
            </p>
            <div>
                <h2 id={id} tabIndex={-1} className="landing-h2">
                    {title}
                </h2>
                {children}
            </div>
        </div>
    );
}
