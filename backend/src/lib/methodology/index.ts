// Methodology calculators (docs/training.md): exact decimal arithmetic for the
// legal-financial figures a junior's work leans on. Pure code, no model.

export { MethodologyError } from "./decimal";
export {
    METHODOLOGY_CALCULATIONS,
    MAX_COMPOUND_PERIODS,
    calculate,
    methodologyInputNames,
    type MethodologyCalculation,
    type MethodologyResult,
} from "./calculators";
export {
    ANNEX_DISCLAIMER,
    NO_SOURCE_TEXT,
    appearsInMessage,
    buildAnnex,
    describeSource,
    verifyBasis,
    type Annex,
    type AnnexSection,
    type InputSource,
} from "./annex";
