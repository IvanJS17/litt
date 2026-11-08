import { describe, expect, it } from "vitest";
import {
    computeMap,
    countedTurns,
    KNOWN_TOPICS_LIMIT,
    mapEvents,
    MAP_MIN_EVENTS,
    rankKnownTopics,
    RETAKE_AFTER_DAYS,
    topicKey,
    topicState,
    type EvidenceNote,
    type MapEvent,
} from "./trainingMap";
import type { TrainingVerdict } from "./trainingVerdict";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-08T12:00:00Z");
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

let counter = 0;
function note(overrides: Partial<EvidenceNote> = {}): EvidenceNote {
    counter += 1;
    return {
        id: `n${counter}`,
        work: "chat:1",
        created_at: at(30 - counter),
        contrast_status: "ready",
        confidence: 2,
        verdict: "coincide",
        verdict_source: "contrast",
        foundation: "solid",
        topics: ["Prescripción"],
        answer_unverified: false,
        mode: null,
        ...overrides,
    };
}

const event = (verdict: TrainingVerdict, daysAgo: number, label = "Prescripción"): MapEvent => ({
    key: topicKey(label),
    label,
    at: at(daysAgo),
    verdict,
    source: "turn",
    note_id: null,
});

describe("topicKey", () => {
    it.each([
        ["Prescripción cambiaria", "prescripcion cambiaria"],
        ["  PRESCRIPCIÓN   cambiaria ", "prescripcion cambiaria"],
        ["Rescisión", "rescision"],
        ["", ""],
    ])("keys %j as %j", (label, key) => expect(topicKey(label)).toBe(key));
});

describe("countedTurns", () => {
    it("keeps a ready, verified turn with a verdict and no mode", () => {
        const turns = countedTurns([note({ id: "a" })]);
        expect(turns.map((turn) => [turn.id, turn.verdict, turn.confidence])).toEqual([["a", "coincide", 2]]);
    });

    it.each<[string, Partial<EvidenceNote>]>([
        ["a contrast that failed", { contrast_status: "failed" }],
        ["a contrast still pending", { contrast_status: "pending" }],
        ["a turn with no verdict", { verdict: null, verdict_source: null }],
        ["an answer with an unverified citation", { answer_unverified: true }],
        ["a hint", { mode: "hint" }],
        ["a counterpart round", { mode: "counterpart" }],
        ["the close of a counterpart round", { mode: "counterpart_close" }],
    ])("leaves out %s", (_label, overrides) => {
        expect(countedTurns([note(overrides)])).toEqual([]);
    });

    it("counts the right conclusion for the wrong reason as partial", () => {
        const [turn] = countedTurns([note({ foundation: "wrong" })]);
        expect(turn.verdict).toBe("parcial");
    });

    it("counts a mentor's verdict as written, even over a wrong foundation", () => {
        const [turn] = countedTurns([note({ foundation: "wrong", verdict_source: "mentor" })]);
        expect(turn.verdict).toBe("coincide");
    });

    it("leaves out the turn that follows a hint in the same work, and only that one", () => {
        const notes = [
            note({ id: "before", created_at: at(10) }),
            note({ id: "hint", mode: "hint", created_at: at(9) }),
            note({ id: "hint2", mode: "hint", created_at: at(8) }),
            note({ id: "after", created_at: at(7) }),
            note({ id: "later", created_at: at(6) }),
        ];
        expect(countedTurns(notes).map((turn) => turn.id)).toEqual(["before", "later"]);
    });

    it("keeps the hint rule inside one work", () => {
        const notes = [
            note({ id: "hint", mode: "hint", work: "chat:1", created_at: at(9) }),
            note({ id: "other", work: "chat:2", created_at: at(8) }),
            note({ id: "same", work: "chat:1", created_at: at(7) }),
        ];
        expect(countedTurns(notes).map((turn) => turn.id)).toEqual(["other"]);
    });

    it("a hint spent on a turn that could not count does not leak onto the next", () => {
        const notes = [
            note({ id: "hint", mode: "hint", created_at: at(9) }),
            note({ id: "unverified", answer_unverified: true, created_at: at(8) }),
            note({ id: "next", created_at: at(7) }),
        ];
        expect(countedTurns(notes).map((turn) => turn.id)).toEqual(["next"]);
    });

    it("does not depend on the order the rows arrive in", () => {
        const notes = [
            note({ id: "after", created_at: at(7) }),
            note({ id: "hint", mode: "hint", created_at: at(9) }),
        ];
        expect(countedTurns(notes)).toEqual([]);
    });
});

describe("mapEvents", () => {
    it("makes one event per distinct topic of a turn and one per answered retake", () => {
        const turns = countedTurns([note({ id: "t", topics: ["Rescisión", "rescision", "Pena convencional", ""] })]);
        const events = mapEvents(turns, [
            { topic_key: "mora", topic_label: "Mora", answered_at: at(1), verdict: "parcial" },
        ]);
        expect(events.map((e) => [e.key, e.source, e.verdict])).toEqual([
            ["rescision", "turn", "coincide"],
            ["pena convencional", "turn", "coincide"],
            ["mora", "retake", "parcial"],
        ]);
    });

    it("a turn without topics is no event", () => {
        expect(mapEvents(countedTurns([note({ topics: null })]), [])).toEqual([]);
    });
});

describe("topicState", () => {
    const table: [string, TrainingVerdict[], string, number, number][] = [
        ["two events", ["coincide", "coincide"], "few_data", 2, 2],
        ["three, all coincided", ["coincide", "coincide", "coincide"], "strong", 3, 3],
        ["three, last one missed", ["coincide", "coincide", "no_coincide"], "middle", 2, 3],
        ["four, 3 of 4 and the last coincided", ["no_coincide", "coincide", "coincide", "coincide"], "strong", 3, 4],
        ["four, 3 of 4 but the last was partial", ["coincide", "coincide", "coincide", "parcial"], "middle", 3, 4],
        ["four, 2 of 4", ["coincide", "no_coincide", "coincide", "no_coincide"], "weak", 2, 4],
        ["three, 1 of 3", ["no_coincide", "coincide", "no_coincide"], "weak", 1, 3],
        ["three, none", ["no_coincide", "parcial", "no_coincide"], "weak", 0, 3],
        ["partials never count as hits", ["parcial", "parcial", "parcial"], "weak", 0, 3],
        [
            "only the last four decide",
            ["no_coincide", "no_coincide", "no_coincide", "coincide", "coincide", "coincide", "coincide"],
            "strong",
            4,
            4,
        ],
        ["three of four, one miss in the middle of the window", ["coincide", "no_coincide", "coincide", "coincide"], "strong", 3, 4],
    ];
    it.each(table)("%s", (_label, verdicts, state, hits, size) => {
        expect(topicState(verdicts)).toEqual({ state, hits, size });
    });

    it("names the minimum", () => expect(MAP_MIN_EVENTS).toBe(3));
});

describe("computeMap", () => {
    it("is empty with no events", () => expect(computeMap([], NOW)).toEqual([]));

    it("groups accent and case variants of a label under one key", () => {
        const map = computeMap(
            [event("coincide", 5, "Prescripción"), event("coincide", 3, "prescripcion"), event("coincide", 1, "PRESCRIPCIÓN")],
            NOW,
        );
        expect(map).toHaveLength(1);
        expect(map[0]).toMatchObject({ key: "prescripcion", label: "PRESCRIPCIÓN", events: 3, state: "strong" });
    });

    it("marks a weak topic as due to retake only once its last event is old enough", () => {
        const weak = (daysAgo: number) =>
            computeMap([event("no_coincide", daysAgo + 2), event("no_coincide", daysAgo + 1), event("no_coincide", daysAgo)], NOW)[0];
        expect(weak(RETAKE_AFTER_DAYS - 1).retake_due).toBe(false);
        expect(weak(RETAKE_AFTER_DAYS).retake_due).toBe(true);
        expect(weak(RETAKE_AFTER_DAYS + 30).retake_due).toBe(true);
        expect(weak(RETAKE_AFTER_DAYS).state).toBe("weak");
    });

    it("never offers a retake for a topic that is not weak, however old", () => {
        const map = computeMap(
            [
                event("coincide", 90, "Fuerte"),
                event("coincide", 89, "Fuerte"),
                event("coincide", 88, "Fuerte"),
                event("no_coincide", 90, "Pocos"),
                event("no_coincide", 89, "Pocos"),
                event("coincide", 90, "Medio"),
                event("coincide", 89, "Medio"),
                event("no_coincide", 88, "Medio"),
            ],
            NOW,
        );
        expect(Object.fromEntries(map.map((t) => [t.key, [t.state, t.retake_due]]))).toEqual({
            fuerte: ["strong", false],
            pocos: ["few_data", false],
            medio: ["middle", false],
        });
    });

    it("lists the most recently worked topic first, then by name, never by how it went", () => {
        const map = computeMap(
            [event("coincide", 1, "B"), event("no_coincide", 1, "A"), event("no_coincide", 5, "C"), event("coincide", 9, "D")],
            NOW,
        );
        expect(map.map((topic) => topic.key)).toEqual(["a", "b", "c", "d"]);
    });

    it("answered retakes that coincided lift a weak topic out", () => {
        const events: MapEvent[] = [
            event("no_coincide", 60),
            event("no_coincide", 59),
            event("no_coincide", 58),
            { ...event("coincide", 2), source: "retake" },
            { ...event("coincide", 1), source: "retake" },
            { ...event("coincide", 0), source: "retake" },
        ];
        expect(computeMap(events, NOW)[0]).toMatchObject({ state: "strong", window_hits: 3, window_size: 4, retake_due: false });
    });

    it("answers counts of one person and nothing that scores, averages or ranks", () => {
        const text = JSON.stringify(computeMap([event("coincide", 3), event("coincide", 2), event("coincide", 1)], NOW));
        expect(text).not.toMatch(/score|rank|average|percent|share|promedio/i);
    });
});

describe("rankKnownTopics", () => {
    it("lists the most used labels first and merges variants by key", () => {
        expect(
            rankKnownTopics([["Mora"], ["Prescripción", "mora"], ["prescripcion", "Rescisión"], ["Prescripción"]]),
        ).toEqual(["Prescripción", "Mora", "Rescisión"]);
    });

    it("breaks ties by which was seen first (newest notes come first)", () => {
        expect(rankKnownTopics([["Nueva"], ["Vieja"]])).toEqual(["Nueva", "Vieja"]);
    });

    it("caps the list", () => {
        const many = [Array.from({ length: 60 }, (_, i) => `Tema ${i}`)];
        expect(rankKnownTopics(many)).toHaveLength(KNOWN_TOPICS_LIMIT);
        expect(rankKnownTopics(many, 5)).toHaveLength(5);
    });
});
