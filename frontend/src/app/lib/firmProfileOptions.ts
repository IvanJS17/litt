// Options of the firm's profile form (docs/firm-profile.md). The ids are the
// ones the server stores (ISO 3166-2:MX for states); only the labels are
// translated, under orgSettings.profile.*. Practice areas are the onboarding
// list (onboarding/options.ts), not repeated here.
export const MX_STATE_CODES = [
    "AGU", "BCN", "BCS", "CAM", "CHP", "CHH", "CMX", "COA",
    "COL", "DUR", "GUA", "GRO", "HID", "JAL", "MEX", "MIC",
    "MOR", "NAY", "NLE", "OAX", "PUE", "QUE", "ROO", "SLP",
    "SIN", "SON", "TAB", "TAM", "TLA", "VER", "YUC", "ZAC"
] as const;
export const FIRM_SIZES = ["1", "2-5", "6-20", "21-50", "51+"] as const;
export const FIRM_CLIENT_TYPES = ["individuals", "companies", "public_sector", "mixed"] as const;
export const FIRM_BRIEF_LANGUAGES = ["es-MX", "en-US"] as const;
export const FIRM_DESCRIPTION_MAX = 1000;
export const FIRM_CITY_MAX = 80;
export const FIRM_INDUSTRIES_MAX = 8;
export const FIRM_INDUSTRY_MAX = 60;

/** "a, b ,, c" to ["a", "b", "c"]. */
export function parseIndustries(text: string): string[] {
    return text.split(",").map((item) => item.trim()).filter(Boolean);
}
