import {
  trainingAttemptText,
  trainingConfidenceText,
  trainingNoteText,
  type TrainingTranslate,
} from "./trainingText";

// Test support: a translator that answers with the English words the catalog
// has, so component tests read like the screen without a provider.
const WORDS: Record<string, string> = {
  attemptLabel: "Your approach (2–3 lines)",
  attemptPlaceholder: "Before asking, write how you would solve it.",
  attemptReady: "Ready.",
  confidenceHelp: "One mark for the whole approach.",
  confidenceLegend: "How sure are you of your approach?",
  "confidenceLevels.guess": "Almost a guess",
  "confidenceLevels.doubt": "I doubt it",
  "confidenceLevels.fairlySure": "Fairly sure",
  "confidenceLevels.sure": "Sure",
  confidenceRequired: "Mark how sure you are before sending.",
  "foundations.solid": "solid",
  "foundations.weak": "weak",
  "foundations.wrong": "wrong",
  noteAttemptHeading: "Your approach",
  noteContrastFailed: "The contrast couldn't be generated",
  noteContrastHeading: "Contrast with your approach",
  noteContrastPending: "Generating contrast…",
  notePrivacy: "Private: only you and your mentor see this",
  noteQuestionHeading: "A question about your basis",
  noteRegion: "Private training notes",
  noteReply: "Reply",
  noteReplyLabel: "Reply to the question about your basis",
  noteRightForWrongReason: "Right for the wrong reason.",
  noteVerdictHeading: "Match with the answer, per the AI contrast:",
  noteVerdictHeadingByMentor: "Match with the answer, per your mentor:",
  "verdicts.coincide": "Matches",
  "verdicts.noCoincide": "Doesn't match",
  "verdicts.parcial": "Partly matches",
};

export const fakeTranslate: TrainingTranslate = (key, values) => {
  const name = key.replace("training.criterion.turn.", "");
  switch (name) {
    case "attemptTooShort":
      return `${values?.length}/${values?.min} caracteres: faltan ${values?.missing}.`;
    case "attemptTooLong":
      return `${values?.length}/${values?.max} caracteres: sobran ${values?.excess}.`;
    case "noteConfidence":
      return `Your mark: ${values?.level}`;
    case "noteFoundation":
      return `Basis: ${values?.basis}`;
    case "passToday":
      return `today until ${(values?.end as Date).toISOString()}`;
    case "passLater":
      return `later until ${(values?.end as Date).toISOString()}`;
    default:
      return WORDS[name] ?? `?${name}`;
  }
};

export const attemptText = trainingAttemptText(fakeTranslate);
export const confidenceText = trainingConfidenceText(fakeTranslate);
export const noteText = trainingNoteText(fakeTranslate);
