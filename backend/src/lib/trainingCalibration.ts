// LiTT training layer 3, calibration (docs/training.md): how often a turn
// agreed with the AI's answer at each level of the thermometer the person
// marked. «Cuando marcas "Seguro", coincidió 5 de 8 veces.»
//
// Counts of ONE person's own marked turns, by level: no percentage, average,
// ranking or comparison with anyone, and a level with fewer than
// CALIBRATION_MIN_PER_LEVEL turns says «aún pocos datos» instead of a number
// that would mean nothing. Pure function over the turns countedTurns keeps
// (unverified answers, turns after a hint and turns without a verdict never
// get here). What it counts is coincidence with the AI's answer, according to
// the AI contrast, never that the person was right.

import type { TrainingCalibration } from "@mike/contracts";
import type { CountedTurn } from "./trainingMap";

/** Marked turns a level needs before its counts are shown. */
export const CALIBRATION_MIN_PER_LEVEL = 3;
export const CONFIDENCE_LEVELS = [1, 2, 3, 4] as const;

export function computeCalibration(turns: readonly CountedTurn[]): TrainingCalibration {
    const levels = CONFIDENCE_LEVELS.map((level) => {
        const marked = turns.filter((turn) => turn.confidence === level);
        return {
            level,
            marked: marked.length,
            coincided: marked.filter((turn) => turn.verdict === "coincide").length,
            partial: marked.filter((turn) => turn.verdict === "parcial").length,
            enough: marked.length >= CALIBRATION_MIN_PER_LEVEL,
        };
    });
    return {
        min_per_level: CALIBRATION_MIN_PER_LEVEL,
        marked_turns: levels.reduce((total, level) => total + level.marked, 0),
        levels,
    };
}
