"use client";

import { useState, type ReactNode } from "react";
import {
    Building2,
    ChevronRight,
    Clock,
    Info,
    Lock,
    Receipt,
    Send,
    ShieldCheck,
    TriangleAlert,
    User,
    type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { SettingsSignalIconName } from "@/app/lib/settingsMap";

export function SettingsLabel({ children }: { children: ReactNode }) {
    return (
        <p className="text-sm font-medium text-gray-700">{children}</p>
    );
}

export function SettingsDescription({ children }: { children: ReactNode }) {
    return <p className="text-sm text-gray-600">{children}</p>;
}

/**
 * The icons of the six Settings signals. Each is decoration next to a text
 * that is always visible: nothing depends on the icon or its color.
 */
export const SETTINGS_SIGNAL_ICONS: Record<SettingsSignalIconName, LucideIcon> = {
    /** A limited role: only some people see or change it. */
    lock: Lock,
    /** The whole firm. */
    firm: Building2,
    /** Only you. */
    user: User,
    /** Asks for a verification. */
    shield: ShieldCheck,
    /** Cannot be undone. */
    alert: TriangleAlert,
    /** It costs money. */
    receipt: Receipt,
    /** Not verified. */
    info: Info,
    /** Data goes to a third party. */
    send: Send,
    /** A deadline. */
    clock: Clock,
};

export type SettingsTagKind = "optional" | "recommended" | "audience";

/**
 * A small label next to a title: «Opcional», «Recomendado» or who the thing
 * applies to. The text is always shown. At most one «Recomendado» a screen.
 * «Opcional» and «Recomendado» say their own word; an audience tag takes its
 * text as children and, optionally, an icon.
 */
export function SettingsTag({
    kind,
    icon,
    children,
}: {
    kind: SettingsTagKind;
    icon?: SettingsSignalIconName;
    children?: ReactNode;
}) {
    const t = useTranslations();
    if (kind === "optional") {
        return (
            <span
                data-slot="settings-tag"
                data-kind="optional"
                className="inline-flex min-h-5 items-center text-xs font-medium text-gray-500"
            >
                {children ?? t("settings.signals.optional")}
            </span>
        );
    }
    if (kind === "recommended") {
        return (
            <span
                data-slot="settings-tag"
                data-kind="recommended"
                className="inline-flex min-h-5 items-center rounded-md px-1.5 text-xs font-semibold text-gray-900 ring-1 ring-inset ring-interactive-border"
            >
                {children ?? t("settings.signals.recommended")}
            </span>
        );
    }
    const Icon = icon ? SETTINGS_SIGNAL_ICONS[icon] : null;
    return (
        <span
            data-slot="settings-tag"
            data-kind="audience"
            className="inline-flex min-h-5 items-center gap-1 rounded-md bg-interactive-soft px-1.5 py-0.5 text-left text-xs font-medium text-gray-700"
        >
            {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0 text-gray-500" /> : null}
            {children}
        </span>
    );
}

/** A row of tags, wrapping, after a title or a help text. */
export function SettingsTagRow({
    children,
    className,
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            data-slot="settings-tags"
            className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5", className)}
        >
            {children}
        </div>
    );
}

export interface SettingsNoticeEntry {
    icon: SettingsSignalIconName;
    label: string;
}

/**
 * A notice that is never hidden: cost, data sent to a third party, a deadline,
 * an unverified text (`note`), or something that cannot be undone
 * (`irreversible`, the only red). A rule on the left, a bold line with an icon
 * per entry and the body below. A fixed text, so no `role="alert"`. The legal
 * texts of socium-legal go in the body complete and unedited; `bodyId` lets a
 * control point at them with `aria-describedby`.
 */
export function SettingsNotice({
    tone = "note",
    entries,
    bodyId,
    children,
    className,
}: {
    tone?: "note" | "irreversible";
    entries: SettingsNoticeEntry[];
    bodyId?: string;
    children?: ReactNode;
    className?: string;
}) {
    const irreversible = tone === "irreversible";
    return (
        <div
            data-slot="settings-notice"
            data-tone={tone}
            className={cn(
                "flex flex-col gap-1 border-l-2 py-0.5 pl-3",
                irreversible
                    ? "border-[var(--litt-danger-rule)]"
                    : "border-[var(--litt-note-rule)]",
                className,
            )}
        >
            {entries.length > 0 ? (
            <p
                className={cn(
                    "flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] font-semibold",
                    irreversible ? "text-[var(--litt-danger-text)]" : "text-gray-900",
                )}
            >
                {entries.map((entry) => {
                    const Icon = SETTINGS_SIGNAL_ICONS[entry.icon];
                    return (
                        <span key={entry.label} className="inline-flex items-center gap-1.5">
                            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                            {entry.label}
                        </span>
                    );
                })}
            </p>
            ) : null}
            {children ? (
                <div id={bodyId} className="text-sm text-gray-700">
                    {children}
                </div>
            ) : null}
        </div>
    );
}

/** A notice of one line inside a row: what it costs, what is not verified. */
export function SettingsNoticeLine({
    icon,
    children,
}: {
    icon: Extract<SettingsSignalIconName, "receipt" | "info">;
    children: ReactNode;
}) {
    const Icon = SETTINGS_SIGNAL_ICONS[icon];
    return (
        <p
            data-slot="settings-notice-line"
            className="flex items-start gap-1.5 text-sm font-medium text-gray-700"
        >
            <Icon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-gray-900" />
            <span>{children}</span>
        </p>
    );
}

/**
 * «Lo administra tu despacho»: the first row of the card the firm controls,
 * never a sentence below it. Bold the words with `<b>` in the message.
 */
export function SettingsManagedRow({ children }: { children: ReactNode }) {
    return (
        <div
            data-slot="settings-managed-row"
            className="flex items-start gap-2.5 rounded-t-xl bg-interactive-soft px-4 py-3 text-sm text-gray-700 only:rounded-xl [&_b]:font-semibold [&_b]:text-gray-900"
        >
            <Building2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gray-900" />
            <div className="min-w-0">{children}</div>
        </div>
    );
}

/**
 * «Más información»: how a setting works, why and the links. A native
 * `<details>`, so the keyboard and screen readers work; `aria-expanded` is
 * kept on the summary as well. Never put a notice in here.
 */
export function SettingsMoreInfo({
    children,
    label,
    className,
}: {
    children: ReactNode;
    label?: string;
    className?: string;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    return (
        <details
            data-slot="settings-more-info"
            className={cn("group", className)}
            onToggle={(event) => setOpen(event.currentTarget.open)}
        >
            <summary
                aria-expanded={open}
                className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-sm text-sm font-medium text-gray-700 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus pointer-fine:min-h-8 [&::-webkit-details-marker]:hidden"
            >
                <ChevronRight
                    aria-hidden="true"
                    className="size-3.5 transition-transform duration-150 ease-[cubic-bezier(.23,1,.32,1)] group-open:rotate-90 motion-reduce:transition-none"
                />
                {label ?? t("settings.signals.moreInfo")}
            </summary>
            <div className="space-y-2 pb-1 pl-[18px] pt-1 text-sm text-gray-600">{children}</div>
        </details>
    );
}
