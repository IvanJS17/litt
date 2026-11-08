import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// LiTT training ("Tu turno primero", docs/training.md): a pasante writes their
// own approach before asking. Rendered by the web composer and the Word
// add-in. The server decides who must write it and checks the length; this
// field only says so and counts.

/** The shortest approach the server accepts, after trimming. */
export const TRAINING_ATTEMPT_MIN_CHARS = 60;
/** The longest one. */
export const TRAINING_ATTEMPT_MAX_CHARS = 4000;

/** Length as the server counts it: Unicode code points, after trimming. */
export function trainingAttemptLength(value: string): number {
  return [...value.trim()].length;
}

/**
 * What the person wrote themselves: the lines quoted by «Responder» (a basis
 * question) do not count towards the minimum, or quoting would be an approach.
 */
export function trainingAttemptOwnLength(value: string): number {
  return trainingAttemptLength(
    value
      .split(/\r?\n/)
      .filter((line) => !line.trimStart().startsWith(">"))
      .join("\n"),
  );
}

export function isTrainingAttemptReady(value: string): boolean {
  return (
    trainingAttemptOwnLength(value) >= TRAINING_ATTEMPT_MIN_CHARS &&
    trainingAttemptLength(value) <= TRAINING_ATTEMPT_MAX_CHARS
  );
}

/** The words of the field, in the host's language. */
export interface TrainingAttemptFieldText {
  label: string;
  placeholder: string;
  /** Under the limit and long enough. */
  ready: string;
  /** Shorter than the minimum. */
  tooShort: (counts: { length: number; min: number; missing: number }) => string;
  /** Longer than the maximum. */
  tooLong: (counts: { length: number; max: number; excess: number }) => string;
}

export function TrainingAttemptFieldUI({
  id,
  value,
  onChange,
  text,
  disabled = false,
  showError = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  text: TrainingAttemptFieldText;
  disabled?: boolean;
  /** Set after a send was refused for a missing or short approach. */
  showError?: boolean;
  className?: string;
}) {
  const length = trainingAttemptOwnLength(value);
  const total = trainingAttemptLength(value);
  const missing = Math.max(0, TRAINING_ATTEMPT_MIN_CHARS - length);
  const excess = Math.max(0, total - TRAINING_ATTEMPT_MAX_CHARS);
  const invalid = missing > 0 || excess > 0;
  const hintId = `${id}-hint`;
  return (
    <div className={twMerge(clsx("flex min-w-0 flex-col gap-1", className))}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {text.label}
      </label>
      <textarea
        id={id}
        value={value}
        rows={2}
        required
        disabled={disabled}
        aria-invalid={showError && invalid ? true : undefined}
        aria-describedby={hintId}
        placeholder={text.placeholder}
        onChange={(event) => onChange(event.target.value)}
        className={clsx(
          "w-full min-w-0 resize-y rounded-md border border-gray-200 bg-white/70 px-3 py-2 text-sm text-gray-900 outline-none transition-[color,box-shadow] placeholder:text-gray-400",
          "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/30",
          "aria-invalid:border-red-500 aria-invalid:ring-red-500/20",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      <p
        id={hintId}
        aria-live="polite"
        className={clsx(
          "text-xs",
          (showError && invalid) || excess > 0 ? "text-red-600" : "text-gray-500",
        )}
      >
        {excess > 0
          ? text.tooLong({ length: total, max: TRAINING_ATTEMPT_MAX_CHARS, excess })
          : missing > 0
            ? text.tooShort({ length, min: TRAINING_ATTEMPT_MIN_CHARS, missing })
            : text.ready}
      </p>
    </div>
  );
}

/**
 * The plain-text line a pasante sees instead of the field while their
 * mentor's urgency pass is in force on the matter (training layer 2). The
 * host writes the sentence, with the end of the pass in its own language.
 */
export function TrainingUrgencyPassLineUI({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <p className={twMerge(clsx("min-w-0 text-xs text-gray-600", className))}>
      {text}
    </p>
  );
}
