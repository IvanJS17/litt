import { Check } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TrainingConfidenceLevel } from "@mike/contracts";

// LiTT training (docs/training.md, layer 3): the thermometer. A pasante marks
// how sure they are of their approach before sending it: one mark per
// approach, four named levels and no hidden number. Rendered by the web
// composers and the Word add-in; the host passes the words (each app has its
// own translator) and the server decides who owes the mark.
//
// A radio group: native radios give the arrow keys, the group has an
// accessible name, the chosen level is `aria-checked` and carries a check
// mark besides its fill (never colour alone), and keyboard focus is visible.

export const TRAINING_CONFIDENCE_LEVELS: readonly TrainingConfidenceLevel[] = [
  1, 2, 3, 4,
];

/** The words of the thermometer, in the host's language. */
export interface TrainingConfidenceText {
  /** The question that names the group, e.g. "How sure are you of your approach?". */
  legend: string;
  /** One line under the options; omitted when empty. */
  help?: string;
  /** The label of each level, from 1 (barely a guess) to 4 (sure). */
  levels: Record<TrainingConfidenceLevel, string>;
  /** Said when a send was refused for a missing mark. */
  required: string;
}

export function TrainingConfidenceUI({
  id,
  value,
  onChange,
  text,
  disabled = false,
  showError = false,
  className,
}: {
  /** Unique within the page; the radios share it as their `name`. */
  id: string;
  /** The chosen level, or null while none is chosen. */
  value: TrainingConfidenceLevel | null;
  onChange: (level: TrainingConfidenceLevel) => void;
  text: TrainingConfidenceText;
  disabled?: boolean;
  /** Set after a send was refused for a missing mark. */
  showError?: boolean;
  className?: string;
}) {
  const legendId = `${id}-legend`;
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const missing = showError && value === null;
  const describedBy =
    [text.help ? helpId : null, missing ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={twMerge(clsx("flex min-w-0 flex-col gap-1.5", className))}>
      <span id={legendId} className="text-sm font-medium text-gray-700">
        {text.legend}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={legendId}
        aria-describedby={describedBy}
        aria-required="true"
        aria-invalid={missing ? true : undefined}
        className="flex min-w-0 flex-wrap gap-2"
      >
        {TRAINING_CONFIDENCE_LEVELS.map((level) => {
          const checked = value === level;
          return (
            <label
              key={level}
              className={clsx(
                "relative flex min-w-[7rem] flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-center text-sm transition-[color,background-color,box-shadow]",
                checked
                  ? "border-interactive-border bg-interactive-soft-strong font-medium text-interactive"
                  : "border-gray-200 bg-white/70 text-gray-700 hover:bg-interactive-soft",
                missing && "border-red-500",
                "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus/50",
                disabled && "cursor-not-allowed opacity-50 hover:bg-white/70",
              )}
            >
              <input
                type="radio"
                name={id}
                value={level}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(level)}
                className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              />
              {checked ? (
                <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              ) : null}
              <span className="min-w-0 break-words">{text.levels[level]}</span>
            </label>
          );
        })}
      </div>
      {text.help ? (
        <p id={helpId} className="text-xs text-gray-500">
          {text.help}
        </p>
      ) : null}
      {missing ? (
        <p id={errorId} role="alert" className="text-xs text-red-600">
          {text.required}
        </p>
      ) : null}
    </div>
  );
}
