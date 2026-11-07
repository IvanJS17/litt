import type { ReactNode } from "react";
import { SiteLogo } from "@/app/components/site-logo";

/**
 * The page frame shared by every signed-out and onboarding screen: the LiTT
 * wordmark sits in the normal flow above the card, so the two never overlap
 * however short the window is. `center` puts the card in the middle of the
 * space left under the wordmark; `top` keeps it right under the wordmark, for
 * forms whose height changes as the user types (the card does not jump).
 */
export function AuthPageShell({
    align = "center",
    children,
}: {
    align?: "center" | "top";
    children: ReactNode;
}) {
    return (
        <div className="flex min-h-dvh flex-col items-center bg-app-background px-6 py-6 md:py-10">
            <div className="shrink-0">
                <SiteLogo size="lg" asLink />
            </div>
            <div
                data-align={align}
                className={`flex w-full flex-1 flex-col items-center pt-10 md:pt-14 ${
                    align === "center" ? "justify-center pb-10 md:pb-14" : ""
                }`}
            >
                {children}
            </div>
        </div>
    );
}
