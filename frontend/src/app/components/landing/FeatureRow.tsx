import type { ReactNode } from "react";

/**
 * One of the four features: its number, a large title, the text and an example
 * on a sheet. From 960 px the odd rows put the text on the left (5fr 7fr) and
 * the even rows the example on the left (7fr 5fr); on a phone the text comes
 * first. Rows are separated by a rule; there is no grid of equal cards.
 */
export function FeatureRow({
    n,
    id,
    title,
    body,
    also,
    children,
}: {
    n: number;
    id: string;
    title: string;
    body: string;
    also?: ReactNode;
    children: ReactNode;
}) {
    return (
        <article
            aria-labelledby={id}
            className="group/row grid items-center gap-x-[clamp(32px,5vw,72px)] gap-y-6 border-t border-foreground/14 py-[clamp(32px,5vw,56px)] first:border-t-0 first:pt-0 min-[960px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] min-[960px]:even:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
        >
            <div className="min-w-0 min-[960px]:group-even/row:order-2">
                <p aria-hidden="true" className="text-base text-muted-foreground tabular-nums">
                    {n}
                </p>
                <h3 id={id} className="landing-h3 mt-1.5">
                    {title}
                </h3>
                <p className="landing-pretty mt-3 max-w-[42ch] text-muted-foreground">{body}</p>
                {also ? (
                    <p className="landing-pretty mt-3.5 max-w-[42ch] text-base text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
                        {also}
                    </p>
                ) : null}
            </div>
            <div className="min-w-0 rounded-[20px] bg-surface-sheet p-[clamp(12px,2vw,20px)] font-sans shadow-elev-sheet">
                {children}
            </div>
        </article>
    );
}
