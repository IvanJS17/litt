"use client";

import type { ReactElement } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export type MeterUIProps = {
    /** The accessible name: what is being measured. */
    label: string;
    value: number;
    min?: number;
    max?: number;
    /** The value in words («4 GB of 10 GB in use»), for assistive technology. */
    valueText?: string;
    className?: string;
};

/**
 * A bar that shows how much of a range is used: `role="progressbar"` with its
 * value, range and name. The value is kept inside the range, so the bar never
 * draws past its end. It carries no state by colour: the host writes the figure
 * and any notice as text beside it.
 */
export function MeterUI({
    label,
    value,
    min = 0,
    max = 100,
    valueText,
    className,
}: MeterUIProps): ReactElement {
    const shown = Math.min(max, Math.max(min, value));
    const share = max > min ? ((shown - min) / (max - min)) * 100 : 0;
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuenow={shown}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuetext={valueText}
            className={twMerge(
                clsx("h-2 w-full overflow-hidden rounded-full bg-gray-200", className),
            )}
        >
            <div
                data-slot="meter-fill"
                className="h-full rounded-full bg-interactive"
                style={{ width: `${share}%` }}
            />
        </div>
    );
}
