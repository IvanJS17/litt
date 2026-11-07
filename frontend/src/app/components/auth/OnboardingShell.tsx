import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import type { ReactNode } from "react";
import { authGlassCardUIClassName } from "@mike/ui";

// A form step fits the narrow card; the provider grid wants room for two
// columns of cards.
const CARD_WIDTH_CLASS = {
    narrow: "max-w-md",
    wide: "max-w-2xl",
} as const;

export function OnboardingShell({
    step,
    title,
    description,
    width = "narrow",
    children,
}: {
    step: string;
    title: string;
    description?: string;
    width?: keyof typeof CARD_WIDTH_CLASS;
    children: ReactNode;
}) {
    return (
        <AuthPageShell>
            <div className={`w-full ${CARD_WIDTH_CLASS[width]}`}>
                <div className={authGlassCardUIClassName}>
                    <p className="mb-2 text-xs font-medium text-gray-400">
                        {step}
                    </p>
                    <h1 className="font-serif text-2xl font-medium text-gray-950">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                            {description}
                        </p>
                    )}
                    <div className="mt-6">{children}</div>
                </div>
            </div>
        </AuthPageShell>
    );
}
