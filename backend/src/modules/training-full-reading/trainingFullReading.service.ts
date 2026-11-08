// Facade of the periodic full reading (LiTT training layer 3, docs/training.md).
export { compareReading } from "./trainingFullReading.compare";
export { listPupilReadings } from "./trainingFullReading.mentor";
export {
    getMyReading,
    getMyReadings,
    getReadingDocument,
    READING_DOCUMENT_UNAVAILABLE_CODE,
    READING_FINDINGS_RECORDED_CODE,
    READING_NO_DOCUMENT_CODE,
    READING_NOT_DUE_CODE,
    READING_SWAP_USED_CODE,
    startReading,
    submitFindings,
    swapReading,
} from "./trainingFullReading.readings";
