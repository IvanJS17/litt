import type { TrainingAttemptFieldText } from "./TrainingAttemptFieldUI";
import type { TrainingConfidenceText } from "./TrainingConfidenceUI";
import type { TrainingNoteText } from "./TrainingNoteUI";

// LiTT training (docs/training.md): the words of the shared training
// components. The web app (next-intl) and the Word add-in (use-intl) each
// bring their translator; the keys exist once, under
// `training.criterion.turn`, in both catalogs.

type Turn = "training.criterion.turn";

/** Every catalog key the training components read. */
export type TrainingTurnKey =
  | `${Turn}.attemptLabel`
  | `${Turn}.attemptPlaceholder`
  | `${Turn}.attemptReady`
  | `${Turn}.attemptTooLong`
  | `${Turn}.attemptTooShort`
  | `${Turn}.confidenceHelp`
  | `${Turn}.confidenceLegend`
  | `${Turn}.confidenceLevels.doubt`
  | `${Turn}.confidenceLevels.fairlySure`
  | `${Turn}.confidenceLevels.guess`
  | `${Turn}.confidenceLevels.sure`
  | `${Turn}.confidenceRequired`
  | `${Turn}.foundations.solid`
  | `${Turn}.foundations.weak`
  | `${Turn}.foundations.wrong`
  | `${Turn}.noteAttemptHeading`
  | `${Turn}.noteConfidence`
  | `${Turn}.noteContrastFailed`
  | `${Turn}.noteContrastHeading`
  | `${Turn}.noteContrastPending`
  | `${Turn}.noteFoundation`
  | `${Turn}.notePrivacy`
  | `${Turn}.noteQuestionHeading`
  | `${Turn}.noteRegion`
  | `${Turn}.noteReply`
  | `${Turn}.noteReplyLabel`
  | `${Turn}.noteRightForWrongReason`
  | `${Turn}.noteVerdictByMentor`
  | `${Turn}.noteVerdictHeading`
  | `${Turn}.noteVerdictHeadingByMentor`
  | `${Turn}.passLater`
  | `${Turn}.passToday`
  | `${Turn}.verdicts.coincide`
  | `${Turn}.verdicts.noCoincide`
  | `${Turn}.verdicts.parcial`;

/** A message translator, as `useTranslations()` returns it in either app. */
export type TrainingTranslate = (
  key: TrainingTurnKey,
  values?: Record<string, string | number | Date>,
) => string;

export function trainingConfidenceText(t: TrainingTranslate): TrainingConfidenceText {
  return {
    legend: t("training.criterion.turn.confidenceLegend"),
    help: t("training.criterion.turn.confidenceHelp"),
    levels: {
      1: t("training.criterion.turn.confidenceLevels.guess"),
      2: t("training.criterion.turn.confidenceLevels.doubt"),
      3: t("training.criterion.turn.confidenceLevels.fairlySure"),
      4: t("training.criterion.turn.confidenceLevels.sure"),
    },
    required: t("training.criterion.turn.confidenceRequired"),
  };
}

export function trainingAttemptText(t: TrainingTranslate): TrainingAttemptFieldText {
  return {
    label: t("training.criterion.turn.attemptLabel"),
    placeholder: t("training.criterion.turn.attemptPlaceholder"),
    ready: t("training.criterion.turn.attemptReady"),
    tooShort: ({ length, min, missing }) =>
      t("training.criterion.turn.attemptTooShort", { length, min, missing }),
    tooLong: ({ length, max, excess }) =>
      t("training.criterion.turn.attemptTooLong", { length, max, excess }),
  };
}

export function trainingNoteText(t: TrainingTranslate): TrainingNoteText {
  const levels = trainingConfidenceText(t).levels;
  return {
    region: t("training.criterion.turn.noteRegion"),
    attemptHeading: t("training.criterion.turn.noteAttemptHeading"),
    contrastHeading: t("training.criterion.turn.noteContrastHeading"),
    contrastPending: t("training.criterion.turn.noteContrastPending"),
    contrastFailed: t("training.criterion.turn.noteContrastFailed"),
    privacy: t("training.criterion.turn.notePrivacy"),
    confidence: (level) => t("training.criterion.turn.noteConfidence", { level }),
    confidenceLevels: levels,
    verdictHeading: t("training.criterion.turn.noteVerdictHeading"),
    verdictHeadingByMentor: t("training.criterion.turn.noteVerdictHeadingByMentor"),
    verdicts: {
      coincide: t("training.criterion.turn.verdicts.coincide"),
      parcial: t("training.criterion.turn.verdicts.parcial"),
      no_coincide: t("training.criterion.turn.verdicts.noCoincide"),
    },
    verdictByMentor: t("training.criterion.turn.noteVerdictByMentor"),
    rightForWrongReason: t("training.criterion.turn.noteRightForWrongReason"),
    foundation: (basis) => t("training.criterion.turn.noteFoundation", { basis }),
    foundations: {
      solid: t("training.criterion.turn.foundations.solid"),
      weak: t("training.criterion.turn.foundations.weak"),
      wrong: t("training.criterion.turn.foundations.wrong"),
    },
    questionHeading: t("training.criterion.turn.noteQuestionHeading"),
    reply: t("training.criterion.turn.noteReply"),
    replyLabel: t("training.criterion.turn.noteReplyLabel"),
  };
}

/**
 * The sentence an urgency pass shows instead of the approach field: just the
 * time when it ends today, the date as well when it does not.
 */
export function trainingUrgencyPassText(
  t: TrainingTranslate,
  expiresAt: string,
  now: Date = new Date(),
): string {
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return "";
  return end.toDateString() === now.toDateString()
    ? t("training.criterion.turn.passToday", { end })
    : t("training.criterion.turn.passLater", { end });
}
