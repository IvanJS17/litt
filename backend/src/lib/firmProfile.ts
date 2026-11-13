// The firm's profile (docs/firm-profile.md): what the assistant is told about the
// firm in every chat of the firm's workspace. Product data adapted to Mexico.
// Pure, so the orgs module (writes it) and the chat modules (read it) share one
// definition and one validation. Every field is optional; a profile with no
// field set is not stored (NULL).

/** ISO 3166-2:MX codes: stable identifiers; the label is the client's to translate. */
export const MX_STATE_CODES = [
    "AGU", "BCN", "BCS", "CAM", "CHP", "CHH", "CMX", "COA", "COL", "DUR", "GUA", "GRO", "HID", "JAL", "MEX", "MIC",
    "MOR", "NAY", "NLE", "OAX", "PUE", "QUE", "ROO", "SLP", "SIN", "SON", "TAB", "TAM", "TLA", "VER", "YUC", "ZAC",
] as const;
/** The name the assistant is told (Spanish: it is the firm's own country). */
export const MX_STATE_NAMES: Record<(typeof MX_STATE_CODES)[number], string> = {
    AGU: "Aguascalientes", BCN: "Baja California", BCS: "Baja California Sur", CAM: "Campeche", CHP: "Chiapas",
    CHH: "Chihuahua", CMX: "Ciudad de México", COA: "Coahuila", COL: "Colima", DUR: "Durango", GUA: "Guanajuato",
    GRO: "Guerrero", HID: "Hidalgo", JAL: "Jalisco", MEX: "Estado de México", MIC: "Michoacán", MOR: "Morelos",
    NAY: "Nayarit", NLE: "Nuevo León", OAX: "Oaxaca", PUE: "Puebla", QUE: "Querétaro", ROO: "Quintana Roo",
    SLP: "San Luis Potosí", SIN: "Sinaloa", SON: "Sonora", TAB: "Tabasco", TAM: "Tamaulipas", TLA: "Tlaxcala",
    VER: "Veracruz", YUC: "Yucatán", ZAC: "Zacatecas",
};
export const FIRM_SIZES = ["1", "2-5", "6-20", "21-50", "51+"] as const;
export const FIRM_CLIENT_TYPES = ["individuals", "companies", "public_sector", "mixed"] as const;
const CLIENT_TYPE_TEXT: Record<(typeof FIRM_CLIENT_TYPES)[number], string> = {
    individuals: "personas físicas",
    companies: "empresas",
    public_sector: "sector público",
    mixed: "mixto (personas físicas, empresas y sector público)",
};
/** Language of the briefs the firm writes; es-MX when not set. */
export const FIRM_BRIEF_LANGUAGES = ["es-MX", "en-US"] as const;

export const FIRM_CITY_MAX = 80;
export const FIRM_AREAS_MAX = 12;
export const FIRM_AREA_MAX = 60;
export const FIRM_INDUSTRIES_MAX = 8;
export const FIRM_INDUSTRY_MAX = 60;
export const FIRM_DESCRIPTION_MAX = 1000;
/** The database refuses a profile over this many bytes of jsonb text (octet_length <= 6000); we refuse it first. */
export const FIRM_PROFILE_MAX_BYTES = 6000;
export const FIRM_PROFILE_TOO_LARGE_CODE = "firm_profile_too_large";

export type FirmProfile = {
    hq_state?: (typeof MX_STATE_CODES)[number];
    hq_city?: string;
    other_states?: (typeof MX_STATE_CODES)[number][];
    size?: (typeof FIRM_SIZES)[number];
    practice_areas?: string[];
    client_type?: (typeof FIRM_CLIENT_TYPES)[number];
    industries?: string[];
    brief_language?: (typeof FIRM_BRIEF_LANGUAGES)[number];
    description?: string;
};
export const FIRM_PROFILE_FIELDS = [
    "hq_state", "hq_city", "other_states", "size", "practice_areas", "client_type", "industries", "brief_language", "description",
] as const;

export type FirmProfileCheck = { ok: true; profile: FirmProfile | null } | { ok: false; detail: string; code?: string };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();
const states = new Set<string>(MX_STATE_CODES);

/** Postgres writes jsonb text with a space after every `:` and `,`. */
function jsonbText(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
    if (isRecord(value)) return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${jsonbText(v)}`).join(", ")}}`;
    return JSON.stringify(value);
}

/** The size the database measures (octet_length of the jsonb text): accents take 2 bytes or more. */
export function firmProfileBytes(profile: FirmProfile): number {
    return Buffer.byteLength(jsonbText(profile));
}

function shortList(value: unknown, field: string, maxItems: number, maxLength: number): { ok: true; list: string[] } | { ok: false; detail: string } {
    if (!Array.isArray(value)) return { ok: false, detail: `${field} must be a list` };
    const list: string[] = [];
    for (const item of value) {
        if (typeof item !== "string") return { ok: false, detail: `${field} must be a list of text` };
        const text = oneLine(item);
        if (!text) continue;
        if (text.length > maxLength) return { ok: false, detail: `Each item of ${field} is at most ${maxLength} characters` };
        if (!list.some((seen) => seen.toLowerCase() === text.toLowerCase())) list.push(text);
    }
    if (list.length > maxItems) return { ok: false, detail: `${field} has at most ${maxItems} items` };
    return { ok: true, list };
}

/**
 * A profile as an owner or admin sends it, checked and trimmed. Refused as a
 * whole (never trimmed to fit). Empty fields are dropped; a profile with no
 * field left is `null` (no profile).
 */
export function normalizeFirmProfile(input: unknown): FirmProfileCheck {
    if (input === null) return { ok: true, profile: null };
    if (!isRecord(input)) return { ok: false, detail: "The profile must be an object" };
    for (const key of Object.keys(input)) {
        if (!(FIRM_PROFILE_FIELDS as readonly string[]).includes(key)) return { ok: false, detail: `Unknown field ${key}` };
    }
    const out: FirmProfile = {};
    const empty = (v: unknown) => v === undefined || v === null || v === "";
    if (!empty(input.hq_state)) {
        if (typeof input.hq_state !== "string" || !states.has(input.hq_state)) return { ok: false, detail: "hq_state is not a state of Mexico" };
        out.hq_state = input.hq_state as FirmProfile["hq_state"];
    }
    if (!empty(input.hq_city)) {
        const city = typeof input.hq_city === "string" ? oneLine(input.hq_city) : "";
        if (typeof input.hq_city !== "string" || city.length > FIRM_CITY_MAX) return { ok: false, detail: `hq_city is at most ${FIRM_CITY_MAX} characters` };
        if (city) out.hq_city = city;
    }
    if (!empty(input.other_states)) {
        if (!Array.isArray(input.other_states) || input.other_states.some((s) => typeof s !== "string" || !states.has(s)))
            return { ok: false, detail: "other_states must be states of Mexico" };
        const other = [...new Set(input.other_states as string[])].filter((s) => s !== out.hq_state);
        if (other.length) out.other_states = other as FirmProfile["other_states"];
    }
    if (!empty(input.size)) {
        if (!(FIRM_SIZES as readonly unknown[]).includes(input.size)) return { ok: false, detail: "size is not one of the ranges" };
        out.size = input.size as FirmProfile["size"];
    }
    if (!empty(input.practice_areas)) {
        const areas = shortList(input.practice_areas, "practice_areas", FIRM_AREAS_MAX, FIRM_AREA_MAX);
        if (!areas.ok) return areas;
        if (areas.list.length) out.practice_areas = areas.list;
    }
    if (!empty(input.client_type)) {
        if (!(FIRM_CLIENT_TYPES as readonly unknown[]).includes(input.client_type)) return { ok: false, detail: "client_type is not one of the options" };
        out.client_type = input.client_type as FirmProfile["client_type"];
    }
    if (!empty(input.industries)) {
        const industries = shortList(input.industries, "industries", FIRM_INDUSTRIES_MAX, FIRM_INDUSTRY_MAX);
        if (!industries.ok) return industries;
        if (industries.list.length) out.industries = industries.list;
    }
    if (!empty(input.brief_language)) {
        if (!(FIRM_BRIEF_LANGUAGES as readonly unknown[]).includes(input.brief_language)) return { ok: false, detail: "brief_language is not supported" };
        out.brief_language = input.brief_language as FirmProfile["brief_language"];
    }
    if (!empty(input.description)) {
        if (typeof input.description !== "string") return { ok: false, detail: "description must be text" };
        // Line breaks stay; other control characters go.
        const description = input.description.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
        if (description.length > FIRM_DESCRIPTION_MAX) return { ok: false, detail: `description is at most ${FIRM_DESCRIPTION_MAX} characters` };
        if (description) out.description = description;
    }
    if (Object.keys(out).length === 0) return { ok: true, profile: null };
    if (firmProfileBytes(out) > FIRM_PROFILE_MAX_BYTES)
        return { ok: false, detail: "The profile is too long to save.", code: FIRM_PROFILE_TOO_LARGE_CODE };
    return { ok: true, profile: out };
}

/** A stored value, or null when it is empty or no longer valid (a stale row never breaks a chat). */
export function readStoredFirmProfile(stored: unknown): FirmProfile | null {
    const checked = normalizeFirmProfile(stored ?? null);
    return checked.ok ? checked.profile : null;
}

/** Names of the fields whose value differs: the audit records these and never the values. */
export function changedFirmProfileFields(before: FirmProfile | null, after: FirmProfile | null): string[] {
    return FIRM_PROFILE_FIELDS.filter((field) => JSON.stringify(before?.[field] ?? null) !== JSON.stringify(after?.[field] ?? null));
}

/** The profile as the assistant reads it: short lines, only what is present. Empty when nothing is set. */
export function firmProfileFacts(profile: FirmProfile | null): Record<string, string | string[]> {
    if (!profile) return {};
    const place = [profile.hq_city, profile.hq_state ? MX_STATE_NAMES[profile.hq_state] : undefined].filter(Boolean).join(", ");
    return {
        ...(place ? { headquarters: place } : {}),
        ...(profile.other_states?.length ? { also_present_in: profile.other_states.map((s) => MX_STATE_NAMES[s]) } : {}),
        ...(profile.size ? { lawyers: profile.size } : {}),
        ...(profile.practice_areas?.length ? { practice_areas: profile.practice_areas } : {}),
        ...(profile.client_type ? { clients: CLIENT_TYPE_TEXT[profile.client_type] } : {}),
        ...(profile.industries?.length ? { industries: profile.industries } : {}),
        ...(profile.brief_language ? { brief_language: profile.brief_language } : {}),
        ...(profile.description ? { description: profile.description } : {}),
    };
}
