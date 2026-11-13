"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * "‹ Back" on a legal page. A reader who came from the app (the onboarding
 * notice opens the Terms in the same tab) goes back to where they were; one
 * who opened the page directly, or in a new tab, goes to the start.
 */
export function LegalBackLink() {
    const t = useTranslations("legal");
    const router = useRouter();
    return (
        <Link
            href="/"
            onClick={(event) => {
                if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) {
                    event.preventDefault();
                    router.back();
                }
            }}
            className="inline-flex min-h-11 items-center gap-1 rounded-md pr-2 text-sm text-gray-600 transition-colors hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            {t("back")}
        </Link>
    );
}
