import type { TrainingAttemptFieldText } from "./TrainingAttemptFieldUI";
import type { TrainingConfidenceText } from "./TrainingConfidenceUI";
import type { TrainingModesText, TrainingRung } from "./TrainingModesUI";
import type { TrainingNoteText } from "./TrainingNoteUI";

// LiTT training (docs/training.md): the words of the shared training
// components. The web app (next-intl) and the Word add-in (use-intl) each
// bring their translator; the keys exist once, under
// `training.criterion.turn`, in both catalogs.

type Turn = "training.criterion.turn";
type Modes = "training.criterion.modes";

/** Every catalog key the training components read. */
export type TrainingTurnKey =
  | `${Modes}.closeButton`
  | `${Modes}.closeExplain`
  | `${Modes}.closeMessage`
  | `${Modes}.counterpartButton`
  | `${Modes}.counterpartExplain`
  | `${Modes}.counterpartFull`
  | `${Modes}.counterpartStatus`
  | `${Modes}.hintButton`
  | `${Modes}.hintExplain`
  | `${Modes}.hintNext`
  | `${Modes}.hintsDone`
  | `${Modes}.needsQuestion`
  | `${Modes}.region`
  | `${Modes}.rungState.next`
  | `${Modes}.rungState.pending`
  | `${Modes}.rungState.used`
  | `${Modes}.rungs.focus`
  | `${Modes}.rungs.review`
  | `${Modes}.rungs.where`
  | `${Modes}.rungsLabel`
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
  | `${Turn}.noteCloseHeading`
  | `${Turn}.noteContrastFailed`
  | `${Turn}.noteContrastHeading`
  | `${Turn}.noteContrastPending`
  | `${Turn}.noteNotDelivered`
  | `${Turn}.noteFoundation`
  | `${Turn}.noteModeCounterpart`
  | `${Turn}.noteModeCounterpartClose`
  | `${Turn}.noteModeHint`
  | `${Turn}.notePrivacy`
  | `${Turn}.noteQuestionHeading`
  | `${Turn}.noteRegion`
  | `${Turn}.noteReply`
  | `${Turn}.noteReplyLabel`
  | `${Turn}.noteRightForWrongReason`
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
    notDelivered: t("training.criterion.turn.noteNotDelivered"),
    closeHeading: t("training.criterion.turn.noteCloseHeading"),
    mode: {
      hint: (step) => t("training.criterion.turn.noteModeHint", { step }),
      counterpart: (step) => t("training.criterion.turn.noteModeCounterpart", { step }),
      counterpart_close: t("training.criterion.turn.noteModeCounterpartClose"),
    },
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

export function trainingModesText(t: TrainingTranslate): TrainingModesText {
  return {
    region: t("training.criterion.modes.region"),
    hintButton: t("training.criterion.modes.hintButton"),
    hintExplain: t("training.criterion.modes.hintExplain"),
    hintNext: (level: TrainingRung, name: string) =>
      t("training.criterion.modes.hintNext", { level, name }),
    hintsDone: t("training.criterion.modes.hintsDone"),
    rungsLabel: t("training.criterion.modes.rungsLabel"),
    rungs: {
      1: t("training.criterion.modes.rungs.focus"),
      2: t("training.criterion.modes.rungs.where"),
      3: t("training.criterion.modes.rungs.review"),
    },
    rungState: {
      used: t("training.criterion.modes.rungState.used"),
      next: t("training.criterion.modes.rungState.next"),
      pending: t("training.criterion.modes.rungState.pending"),
    },
    counterpartButton: t("training.criterion.modes.counterpartButton"),
    counterpartExplain: t("training.criterion.modes.counterpartExplain"),
    counterpartStatus: (step: TrainingRung) =>
      t("training.criterion.modes.counterpartStatus", { step }),
    counterpartFull: t("training.criterion.modes.counterpartFull"),
    closeButton: t("training.criterion.modes.closeButton"),
    closeExplain: t("training.criterion.modes.closeExplain"),
  };
}

/** The line sent when a round is closed without a message of its own. */
export function trainingCloseMessage(t: TrainingTranslate): string {
  return t("training.criterion.modes.closeMessage");
}

/** Said when a mode is asked for with no question written. */
export function trainingNeedsQuestionText(t: TrainingTranslate): string {
  return t("training.criterion.modes.needsQuestion");
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
