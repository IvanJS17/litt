"use client";

import type { ReactNode } from "react";
import { cn } from "@/app/lib/utils";

type EmptyStateProps = {
    /** Rendered at 32px; pass the bare icon, the wrapper sizes it. */
    icon?: ReactNode;
    title: ReactNode;
    description?: ReactNode;
    /** Usually a `PillButtonUI`. */
    action?: ReactNode;
    /** A `GuideTrigger` («¿Cuándo usarla?») under the description. */
    help?: ReactNode;
    tone?: "default" | "error";
    className?: string;
};

/**
 * The standard "nothing here yet" block: icon, serif display heading, muted
 * body copy and an optional call to action. Drop it inside `TableEmptyState`
 * for tables, or use it standalone for panels.
 */
export function EmptyState({
    icon,
    title,
    description,
    action,
    help,
    tone = "default",
    className,
}: EmptyStateProps) {
    return (
        <div
            data-slot="empty-state"
            className={cn("flex flex-col items-start text-left", className)}
        >
            {icon ? (
                <span
                    data-slot="empty-state-icon"
                    aria-hidden="true"
                    className="mb-4 inline-flex [&>*]:h-8 [&>*]:w-8"
                >
                    {icon}
                </span>
            ) : null}
            <p className="font-serif text-2xl font-medium text-gray-900">
                {title}
            </p>
            {description ? (
                <p
                    data-slot="empty-state-description"
                    className={cn(
                        "mt-1 max-w-sm text-sm",
                        // gray-500 is the muted text that passes AA (5.2:1 on papel); gray-400 is for markers only.
                        tone === "error" ? "text-red-500" : "text-gray-500",
                    )}
                >
                    {description}
                </p>
            ) : null}
            {help ? <div data-slot="empty-state-help" className="mt-1">{help}</div> : null}
            {action ? <div className="mt-4">{action}</div> : null}
        </div>
    );
}
