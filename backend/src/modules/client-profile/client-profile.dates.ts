/**
 * Dates and notice periods read from the words of a document, by code. A model
 * never computes a date: it copies what the document says (`value_raw`) and
 * this file turns the formats a Mexican contract uses into an ISO date, or says
 * it cannot. A date that cannot be read with certainty is left as the
 * document words it, and the radar flags the fact for review.
 */

import { isIsoDate } from "./client-profile.shared";

const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const pad = (value: number) => String(value).padStart(2, "0");

function iso(year: number, month: number, day: number): string | null {
  const text = `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`;
  return isIsoDate(text) ? text : null;
}

/**
 * An ISO date from: `2027-03-15`, `15/03/2027` or `15-03-2027` (day first, as in
 * Mexico), and `15 de marzo de 2027` (also `1o de enero del 2026`). Anything
 * else, an impossible day, or a numeric date whose day and month could be
 * swapped (`03/04/2027`) is null: the person reads it.
 */
export function normalizeDate(raw: string): string | null {
  const text = raw.trim().replace(/\s+/g, " ");
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return iso(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);
    // Both could be a month: 03/04/2027 is 3 April or 4 March. Not decided here.
    if (first <= 12 && second <= 12 && first !== second) return null;
    return iso(Number(match[3]), second, first);
  }

  match = /^(\d{1,2})\s*(?:o|º|°)?\s+de\s+([a-záéíóú]+)\s+(?:de|del)\s+(\d{4})$/i.exec(text);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    return month ? iso(Number(match[3]), month, Number(match[1])) : null;
  }
  return null;
}

/** `90 días`, `noventa (90) días hábiles`, `30 días naturales`: the number written in digits. */
export function parseNoticePeriod(raw: string): { days: number; type: "calendar" | "business" } | null {
  const match = /(\d{1,4})\s*\)?\s*d[ií]as?(?:\s+(h[aá]biles|naturales|calendario))?/i.exec(raw);
  if (!match) return null;
  return {
    days: Number(match[1]),
    type: match[2] && match[2].toLowerCase().startsWith("h") ? "business" : "calendar",
  };
}
