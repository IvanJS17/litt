/**
 * What a download left out because the holder cannot open it (or what it was
 * drawn from) today: kind of thing → how many. The builder makes one and hands
 * it to the places that withhold. Archived rows are not counted, and neither
 * are the records of an organization the holder has left.
 */
export type HeldBack = Map<string, number>;

export function holdBack(tally: HeldBack, kind: string, count = 1) {
    if (count > 0) tally.set(kind, (tally.get(kind) ?? 0) + count);
}
