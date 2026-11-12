import type { LucideIcon } from "lucide-react";
import { AlignLeft, List, Hash, DollarSign, ToggleLeft, Calendar, Tag, Percent, Banknote } from "lucide-react";
import type { NsTranslate } from "@/i18n/Translate";
import type { ColumnFormat } from "../shared/types";

type T = NsTranslate<"tabular">;

type FormatOption = { value: ColumnFormat; label: string; icon: LucideIcon; iconClassName: string };

const FORMAT_STYLES: Array<Omit<FormatOption, "label">> = [
    { value: "text",            icon: AlignLeft,  iconClassName: "text-gray-600"     },
    { value: "bulleted_list",   icon: List,       iconClassName: "text-stone-500"  },
    { value: "number",          icon: Hash,       iconClassName: "text-lime-600"  },
    { value: "percentage",      icon: Percent,    iconClassName: "text-rose-500" },
    { value: "monetary_amount", icon: Banknote,   iconClassName: "text-emerald-600" },
    { value: "currency",        icon: DollarSign, iconClassName: "text-teal-600"    },
    { value: "yes_no",          icon: ToggleLeft, iconClassName: "text-orange-500"   },
    { value: "date",            icon: Calendar,   iconClassName: "text-rose-500"    },
    { value: "tag",             icon: Tag,        iconClassName: "text-orange-500"  },
];

/** The name of a column format. A switch of literal keys, so the keys can be searched for. */
export function formatLabel(format: ColumnFormat, t: T): string {
    switch (format) {
        case "text":
            return t("tabular.columnFormats.text");
        case "bulleted_list":
            return t("tabular.columnFormats.bulleted_list");
        case "number":
            return t("tabular.columnFormats.number");
        case "percentage":
            return t("tabular.columnFormats.percentage");
        case "monetary_amount":
            return t("tabular.columnFormats.monetary_amount");
        case "currency":
            return t("tabular.columnFormats.currency");
        case "yes_no":
            return t("tabular.columnFormats.yes_no");
        case "date":
            return t("tabular.columnFormats.date");
        case "tag":
            return t("tabular.columnFormats.tag");
        default:
            return t("tabular.columnFormats.fallback");
    }
}

/** Every format, with its name in the interface language. */
export function formatOptions(t: T): FormatOption[] {
    return FORMAT_STYLES.map((style) => ({ ...style, label: formatLabel(style.value, t) }));
}

export function formatIcon(format: ColumnFormat): LucideIcon {
    return FORMAT_STYLES.find((o) => o.value === format)?.icon ?? AlignLeft;
}

export function formatIconClassName(format: ColumnFormat): string {
    return FORMAT_STYLES.find((o) => o.value === format)?.iconClassName ?? "text-gray-600";
}
