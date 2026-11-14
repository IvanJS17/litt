"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";

const LINK_CLASS =
    "inline-flex min-h-11 items-center rounded-sm font-medium text-gray-900 underline underline-offset-2 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:min-h-0";

/**
 * A sentence with one link in it, for pointing from one home of Settings to
 * the other («Estos ajustes son tuyos. Lo de tu despacho está en Ajustes del
 * despacho →»). The message marks the linked words `<link>…</link>`. On a
 * phone the link has the 44 px touch height.
 */
export function SettingsCrossLink({
    messageKey,
    href,
    values,
    className,
}: {
    messageKey:
        | "settings.map.personalBanner"
        | "settings.map.firmBanner"
        | "settings.map.managedByFirmAdmin"
        | "settings.map.keysManagedByFirmAdmin";
    href: string;
    values?: Record<string, string>;
    className?: string;
}) {
    const t = useTranslations();
    return (
        <p className={cn("text-sm text-gray-600", className)}>
            {t.rich(messageKey, {
                name: "",
                ...values,
                link: (chunks) => (
                    <Link href={href} className={LINK_CLASS}>
                        {chunks}
                    </Link>
                ),
            })}
        </p>
    );
}
