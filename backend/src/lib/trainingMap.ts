// LiTT training layer 3, the person's own map (docs/training.md): what they
// are strong and weak at, by topic, and which weak topics are due to be
// taken up again.
//
// There is no table of topics and no score. A topic is a short label the
// contrast proposed for a turn; the map is COMPUTED ON READ from the turn
// notes and the answered retakes, so there is nothing to keep in sync or to
// delete apart from the notes themselves. Pure functions over rows already
// read, tested with tables of cases. It describes ONE person with counts of
// that person's own events («3 de 4»); it never averages, ranks or compares.
//
// What counts as an event (the same rule feeds the calibration):
//   - a turn with a verdict that counts (the contrast's, or the mentor's),
//     a ready contrast, no unverified citation in the answer, no hint asked
//     before it and no mode (a hint or a counterpart round has no answer to
//     compare with);
//   - an answered retake.
// A «hit» is a verdict of `coincide`; `parcial` is not one. What it measures
// is a coincidence with the AI's own answer, according to the AI contrast,
// not that the person was right.

import type { TrainingMapState } from "@mike/contracts";
import { effectiveVerdict, type TrainingFoundation, type TrainingVerdict, type TrainingVerdictSource } from "./trainingVerdict";

/** Fewer events than this on a topic: «pocos datos». */
export const MAP_MIN_EVENTS = 3;
/** The last events of a topic that decide its state. */
export const MAP_WINDOW_EVENTS = 4;
/** Strong: at least this share of the window coincided, and the last event did. */
export const MAP_STRONG_SHARE = 0.75;
/** Weak: at most this share of the window coincided. */
export const MAP_WEAK_SHARE = 0.5;
/** A weak topic whose last event is this old is due to be retaken. */
export const RETAKE_AFTER_DAYS = 14;
/** How many of the person's own labels the contrast is shown to reuse. */
export const KNOWN_TOPICS_LIMIT = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A topic's grouping key: no accents, lower case, single spaces. */
export function topicKey(label: string): string {
    return label
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

/** The columns of a turn note the map and the calibration read. */
export type EvidenceNote = {
    id: string;
    /** One value per work (chat): the hint rule runs inside a work. */
    work: string;
    created_at: string;
    contrast_status: string;
    confidence: number | null;
    verdict: TrainingVerdict | null;
    verdict_source: TrainingVerdictSource | null;
    foundation: TrainingFoundation | null;
    topics: string[] | null;
    answer_unverified: boolean;
    mode: string | null;
};

/** A turn that counts as evidence, with the verdict that counts. */
export type CountedTurn = {
    id: string;
    at: string;
    confidence: number | null;
    verdict: TrainingVerdict;
    topics: string[];
};

/**
 * The turns that count: see the top of the file. A hint asks for the next
 * full turn of the same work not to count (the pasante saw a way in before
 * answering), and only that turn.
 */
export function countedTurns(notes: readonly EvidenceNote[]): CountedTurn[] {
    const ordered = [...notes].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const hinted = new Set<string>();
    const counted: CountedTurn[] = [];
    for (const note of ordered) {
        if (note.mode === "hint") {
            hinted.add(note.work);
            continue;
        }
        if (note.mode !== null) continue;
        const afterHint = hinted.delete(note.work);
        if (afterHint || note.answer_unverified || note.contrast_status !== "ready") continue;
        const verdict = effectiveVerdict(note);
        if (!verdict) continue;
        counted.push({
            id: note.id,
            at: note.created_at,
            confidence: note.confidence,
            verdict,
            topics: note.topics ?? [],
        });
    }
    return counted;
}

export type MapEvent = {
    key: string;
    label: string;
    at: string;
    verdict: TrainingVerdict;
    source: "turn" | "retake";
    /** The note behind a turn event; null for a retake. */
    note_id: string | null;
};

export type AnsweredRetake = { topic_key: string; topic_label: string; answered_at: string; verdict: TrainingVerdict };

/** One event per topic of each counted turn, and one per answered retake. */
export function mapEvents(turns: readonly CountedTurn[], retakes: readonly AnsweredRetake[]): MapEvent[] {
    const events: MapEvent[] = [];
    for (const turn of turns) {
        const seen = new Set<string>();
        for (const label of turn.topics) {
            const key = topicKey(label);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            events.push({ key, label, at: turn.at, verdict: turn.verdict, source: "turn", note_id: turn.id });
        }
    }
    for (const retake of retakes)
        events.push({
            key: retake.topic_key,
            label: retake.topic_label,
            at: retake.answered_at,
            verdict: retake.verdict,
            source: "retake",
            note_id: null,
        });
    return events;
}

export type MapTopic = {
    key: string;
    label: string;
    state: TrainingMapState;
    /** Every event of the topic. */
    events: number;
    /** Of the last MAP_WINDOW_EVENTS: how many coincided, out of how many. */
    window_hits: number;
    window_size: number;
    last_at: string;
    last_verdict: TrainingVerdict;
    /** Weak, and the last event is RETAKE_AFTER_DAYS old or more. */
    retake_due: boolean;
};

const time = (value: string) => Date.parse(value);

/** The state of one topic from its events, oldest first. */
export function topicState(
    verdicts: readonly TrainingVerdict[],
): { state: TrainingMapState; hits: number; size: number } {
    const window = verdicts.slice(-MAP_WINDOW_EVENTS);
    const hits = window.filter((verdict) => verdict === "coincide").length;
    const size = window.length;
    if (verdicts.length < MAP_MIN_EVENTS) return { state: "few_data", hits, size };
    const share = hits / size;
    const last = window[window.length - 1];
    if (share >= MAP_STRONG_SHARE && last === "coincide") return { state: "strong", hits, size };
    if (share <= MAP_WEAK_SHARE) return { state: "weak", hits, size };
    return { state: "middle", hits, size };
}

/**
 * The map of one person. Topics come back most recently worked first, then
 * by name: never by how well they went.
 */
export function computeMap(events: readonly MapEvent[], now: number = Date.now()): MapTopic[] {
    const byKey = new Map<string, MapEvent[]>();
    for (const event of events) {
        const list = byKey.get(event.key) ?? [];
        list.push(event);
        byKey.set(event.key, list);
    }
    const topics: MapTopic[] = [];
    for (const [key, list] of byKey) {
        list.sort((a, b) => time(a.at) - time(b.at));
        const last = list[list.length - 1];
        const { state, hits, size } = topicState(list.map((event) => event.verdict));
        topics.push({
            key,
            // The label as it was last written.
            label: last.label,
            state,
            events: list.length,
            window_hits: hits,
            window_size: size,
            last_at: last.at,
            last_verdict: last.verdict,
            retake_due: state === "weak" && now - time(last.at) >= RETAKE_AFTER_DAYS * DAY_MS,
        });
    }
    return topics.sort((a, b) => time(b.last_at) - time(a.last_at) || a.key.localeCompare(b.key));
}

/**
 * The labels the person already uses, most used first (ties: the more recent),
 * so the contrast reuses them instead of inventing a near-duplicate. Takes
 * the topic lists of their notes, newest first.
 */
export function rankKnownTopics(topicLists: readonly (readonly string[])[], limit: number = KNOWN_TOPICS_LIMIT): string[] {
    const seen = new Map<string, { label: string; count: number; first: number }>();
    let order = 0;
    for (const list of topicLists)
        for (const label of list) {
            const key = topicKey(label);
            if (!key) continue;
            const known = seen.get(key);
            if (known) known.count += 1;
            else seen.set(key, { label, count: 1, first: order++ });
        }
    return [...seen.values()]
        .sort((a, b) => b.count - a.count || a.first - b.first)
        .slice(0, limit)
        .map((entry) => entry.label);
}
