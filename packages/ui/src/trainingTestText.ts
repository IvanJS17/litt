import {
  trainingAttemptText,
  trainingConfidenceText,
  trainingModesText,
  trainingNoteText,
  type TrainingTranslate,
} from "./trainingText";

// Test support: a translator that answers with the English words the catalog
// has, so component tests read like the screen without a provider.
const WORDS: Record<string, string> = {
  "modes.closeButton": "Close the round",
  "modes.closeExplain": "See which objections you held.",
  "modes.closeMessage": "I'm closing the round.",
  "modes.counterpartButton": "Test it against the counterparty's lawyer",
  "modes.counterpartExplain": "The AI plays the other side.",
  "modes.counterpartFull": "This round already had three turns.",
  "modes.hintButton": "Ask for a hint",
  "modes.hintExplain": "A hint never gives the answer.",
  "modes.hintsDone": "You already asked for all three hints.",
  "modes.needsQuestion": "Write your question first.",
  "modes.region": "Help for this turn",
  "modes.rungState.next": "next",
  "modes.rungState.pending": "pending",
  "modes.rungState.used": "used",
  "modes.rungs.focus": "Focus",
  "modes.rungs.review": "What to review",
  "modes.rungs.where": "Where to look",
  "modes.rungsLabel": "Rungs of the hint ladder",
  noteCloseHeading: "How the round went",
  noteModeCounterpartClose: "Close of the round",
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
  noteNotDelivered: "Not delivered",
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
  const name = key.replace("training.criterion.turn.", "").replace("training.criterion.", "");
  switch (name) {
    case "modes.hintNext":
      return `Next: hint ${values?.level} of 3, ${values?.name}.`;
    case "modes.counterpartStatus":
      return `Turn ${values?.step} of 3.`;
    case "noteModeHint":
      return `Hint ${values?.step} of 3`;
    case "noteModeCounterpart":
      return `Round, turn ${values?.step} of 3`;
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
export const modesText = trainingModesText(fakeTranslate);
export const noteText = trainingNoteText(fakeTranslate);
