import { AuthPageShell } from "@/app/components/auth/AuthPageShell";
import type { ReactNode } from "react";
import { authGlassCardUIClassName } from "@mike/ui";

// A form step fits the narrow card; the provider grid wants room for two
// columns of cards.
const CARD_WIDTH_CLASS = {
    narrow: "max-w-md",
    wide: "max-w-2xl",
} as const;

// A short window (an iPhone's Safari is about 660 px tall) gets a tighter card,
// so a step that is a few dozen pixels taller than the screen fits it instead
// of scrolling. Written out in full: Tailwind finds classes by reading this file.
const SHORT_CARD_CLASS = "[@media(max-height:700px)]:p-5";
const SHORT_BODY_CLASS = "mt-6 [@media(max-height:700px)]:mt-4";

export function OnboardingShell({
    step,
    title,
    description,
    width = "narrow",
    children,
}: {
    step?: string;
    title: string;
    description?: string;
    width?: keyof typeof CARD_WIDTH_CLASS;
    children: ReactNode;
}) {
    return (
        <AuthPageShell>
            <div className={`w-full ${CARD_WIDTH_CLASS[width]}`}>
                <div className={`${authGlassCardUIClassName} ${SHORT_CARD_CLASS}`}>
                    {step && (
                        <p className="mb-2 text-xs font-medium text-gray-500 [@media(max-height:700px)]:mb-1">
                            {step}
                        </p>
                    )}
                    <h1 className="font-serif text-2xl font-medium text-gray-950">
                        {title}
                    </h1>
                    {description && (
                        <p className="mt-2 text-sm leading-relaxed text-gray-600">
                            {description}
                        </p>
                    )}
                    <div className={SHORT_BODY_CLASS}>{children}</div>
                </div>
            </div>
        </AuthPageShell>
    );
}
