import type { ReactNode } from "react";
import { SiteLogo } from "@/app/components/site-logo";
import { LocaleSwitcher } from "@/app/components/shared/LocaleSwitcher";

/*
 * Vertical rhythm by window height, so a card and the links under it fit a
 * short laptop window (1280×640) without scrolling. The three height ranges
 * never overlap, so no rule has to win over another:
 *
 * - tall, 861 px and up: 40 px above the wordmark on desktop, 56 px between
 *   the wordmark and the card;
 * - medium, 701–860 px: 24 px and 32 px (1366×768, 1440×900 at 125 %);
 * - short, 700 px and less: 8 px and 4 px, and the wordmark drawn at
 *   X = 33 instead of 44 (u = 3 px, the brand's `md` size). At X = 44 the
 *   login card and its links leave no room for any gap at all. The
 *   wordmark's own clear space (4u = 12 px) still separates its ink from
 *   the card.
 *
 * Tailwind finds classes by reading this file, so each one is written out
 * in full.
 */
const FRAME_CLASS =
    "py-6 [@media(min-height:861px)]:md:py-10 [@media(min-height:701px)_and_(max-height:860px)]:py-6 [@media(max-height:700px)]:py-2";

const AREA_CLASS =
    "pt-10 [@media(min-height:861px)]:md:pt-14 [@media(min-height:701px)_and_(max-height:860px)]:pt-8 [@media(max-height:700px)]:pt-1";

// X = 33 is 36u × 18.371u at u = 3 px. The SVG keeps its viewBox, so this
// is the geometry `<LittWordmark x={33} />` draws.
const SHORT_LOGO_CLASS =
    "[@media(max-height:700px)]:[&_[data-slot=litt-wordmark]]:h-[56px] [@media(max-height:700px)]:[&_[data-slot=litt-wordmark]]:w-[108px]";

/**
 * The page frame shared by every signed-out and onboarding screen: the LiTT
 * wordmark sits in the normal flow above the card, so the two never overlap
 * however short the window is. The card always starts the same distance
 * under the wordmark, on every screen and every step: centring it moved it
 * with the card's height, so it jumped from one step to the next. The
 * language selector sits under the card on every screen that uses the frame.
 */
export function AuthPageShell({ children }: { children: ReactNode }) {
    return (
        <div
            className={`flex min-h-dvh flex-col items-center bg-app-background px-6 ${FRAME_CLASS}`}
        >
            <div className={`shrink-0 ${SHORT_LOGO_CLASS}`}>
                <SiteLogo size="lg" asLink />
            </div>
            <div className={`flex w-full flex-1 flex-col items-center ${AREA_CLASS}`}>
                {children}
            </div>
            {/* Every signed-out screen offers the language choice (plan i18n §2.3). */}
            <div className="shrink-0 pt-2 [@media(max-height:700px)]:pt-0">
                <LocaleSwitcher />
            </div>
        </div>
    );
}
