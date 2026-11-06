import type { ColumnConfig } from "../shared/types";

/** Sequential colors assigned to tags by their position in the tags array. */
export const TAG_COLORS = [
    "bg-stone-200 text-stone-800",
    "bg-lime-100 text-lime-800",
    "bg-pink-100 text-pink-700",
    "bg-orange-100 text-orange-700",
    "bg-teal-100 text-teal-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-800",
    "bg-rose-100 text-rose-700",
];

const CURRENCY_COLORS: Record<string, string> = {
    USD: "bg-green-100 text-green-700",
    EUR: "bg-stone-200 text-stone-800",
    GBP: "bg-emerald-100 text-emerald-800",
    JPY: "bg-red-100 text-red-700",
    CHF: "bg-orange-100 text-orange-700",
    AUD: "bg-gray-200 text-gray-800",
    CAD: "bg-teal-100 text-teal-700",
    SGD: "bg-pink-100 text-pink-700",
    HKD: "bg-rose-100 text-rose-700",
    NZD: "bg-lime-100 text-lime-700",
    CNY: "bg-amber-100 text-amber-700",
};

export function getPillClass(content: string, column?: ColumnConfig): string {
    if (column?.format === "yes_no") {
        const lower = content.toLowerCase();
        if (lower === "yes") return "bg-green-100 text-green-700";
        if (lower === "no") return "bg-red-100 text-red-700";
        return "bg-gray-100 text-gray-700";
    }
    if (column?.format === "currency") {
        return (
            CURRENCY_COLORS[content.toUpperCase()] ??
            "bg-gray-100 text-gray-700"
        );
    }
    if (column?.format === "tag" && column.tags?.length) {
        const idx = column.tags.findIndex(
            (t) => t.toLowerCase() === content.toLowerCase(),
        );
        if (idx >= 0) return TAG_COLORS[idx % TAG_COLORS.length]!;
    }
    return "bg-gray-100 text-gray-700";
}
