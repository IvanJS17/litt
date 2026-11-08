import { describe, expect, it } from "vitest";
import { CALIBRATION_MIN_PER_LEVEL, computeCalibration } from "./trainingCalibration";
import type { CountedTurn } from "./trainingMap";
import type { TrainingVerdict } from "./trainingVerdict";

let n = 0;
const turn = (confidence: number | null, verdict: TrainingVerdict): CountedTurn => ({
    id: `t${++n}`,
    at: new Date(1_800_000_000_000 + n * 1000).toISOString(),
    confidence,
    verdict,
    topics: [],
});
const many = (count: number, confidence: number | null, verdict: TrainingVerdict) =>
    Array.from({ length: count }, () => turn(confidence, verdict));

describe("computeCalibration", () => {
    it("has the four levels and no data for a person who marked nothing", () => {
        expect(computeCalibration([])).toEqual({
            min_per_level: CALIBRATION_MIN_PER_LEVEL,
            marked_turns: 0,
            levels: [1, 2, 3, 4].map((level) => ({ level, marked: 0, coincided: 0, partial: 0, enough: false })),
        });
    });

    it("counts «coincidió 5 de 8» at the level the person marked", () => {
        const result = computeCalibration([
            ...many(5, 4, "coincide"),
            ...many(1, 4, "parcial"),
            ...many(2, 4, "no_coincide"),
        ]);
        expect(result.levels[3]).toEqual({ level: 4, marked: 8, coincided: 5, partial: 1, enough: true });
        expect(result.marked_turns).toBe(8);
    });

    it("says there are too few turns below the minimum and enough at it", () => {
        const result = computeCalibration([...many(CALIBRATION_MIN_PER_LEVEL - 1, 1, "coincide"), ...many(CALIBRATION_MIN_PER_LEVEL, 2, "coincide")]);
        expect(result.levels.map((level) => level.enough)).toEqual([false, true, false, false]);
    });

    it("ignores a turn with no mark", () => {
        const result = computeCalibration([turn(null, "coincide"), turn(3, "coincide")]);
        expect(result.marked_turns).toBe(1);
        expect(result.levels[2].marked).toBe(1);
    });

    it("keeps one person's levels apart and never combines them", () => {
        const result = computeCalibration([...many(3, 1, "no_coincide"), ...many(3, 4, "coincide")]);
        expect(result.levels.map((level) => [level.marked, level.coincided])).toEqual([
            [3, 0],
            [0, 0],
            [0, 0],
            [3, 3],
        ]);
    });

    it("answers counts only: no score, percentage, average or ranking", () => {
        const text = JSON.stringify(computeCalibration([...many(4, 3, "coincide"), ...many(4, 4, "no_coincide")]));
        expect(text).not.toMatch(/score|rank|average|percent|share|promedio/i);
    });
});
