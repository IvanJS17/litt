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

export function isTrainingAttemptReady(value: string): boolean {
  const length = trainingAttemptLength(value);
  return (
    length >= TRAINING_ATTEMPT_MIN_CHARS && length <= TRAINING_ATTEMPT_MAX_CHARS
  );
}

export function TrainingAttemptFieldUI({
  id,
  value,
  onChange,
  disabled = false,
  showError = false,
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Set after a send was refused for a missing or short approach. */
  showError?: boolean;
  className?: string;
}) {
  const length = trainingAttemptLength(value);
  const missing = Math.max(0, TRAINING_ATTEMPT_MIN_CHARS - length);
  const excess = Math.max(0, length - TRAINING_ATTEMPT_MAX_CHARS);
  const invalid = missing > 0 || excess > 0;
  const hintId = `${id}-hint`;
  return (
    <div className={twMerge(clsx("flex min-w-0 flex-col gap-1", className))}>
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        Tu planteamiento (2–3 líneas)
      </label>
      <textarea
        id={id}
        value={value}
        rows={2}
        required
        disabled={disabled}
        aria-invalid={showError && invalid ? true : undefined}
        aria-describedby={hintId}
        placeholder="Antes de preguntar, escribe cómo lo resolverías tú."
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
          ? `${length}/${TRAINING_ATTEMPT_MAX_CHARS} caracteres: sobran ${excess}.`
          : missing > 0
            ? `${length}/${TRAINING_ATTEMPT_MIN_CHARS} caracteres: faltan ${missing}. Después de la respuesta verás un contraste con tu planteamiento.`
            : "Listo. Después de la respuesta verás un contraste con tu planteamiento."}
      </p>
    </div>
  );
}
