import { Check } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { TrainingTurnMode } from "@mike/contracts";

// LiTT training (docs/training.md, layer 3): what a pasante can ask for
// instead of the answer — a hint from a ladder of three rungs, or a round with
// the counterparty's lawyer that they close for a contrast. Rendered by the
// web composers and the Word add-in; the host passes the words and what the
// server said was open (`GET /training/stage`). The server decides the rung
// and the turn of the round again on every turn: this only shows them.
//
// A button sends the turn in that mode (the host runs the same checks as for
// «Enviar»). Where a rung stands is said in words, never by colour alone: the
// next rung is `aria-current="step"`, a used one carries a check mark and a
// visually hidden «usada».

export type TrainingRung = 1 | 2 | 3;

/** The rungs of the ladder, in the order they are given. */
export const TRAINING_HINT_RUNGS: readonly TrainingRung[] = [1, 2, 3];

/** What `GET /training/stage` says is open now, as the composer keeps it. */
export interface TrainingModesState {
  modes: readonly TrainingTurnMode[];
  /** The rung the next hint would be; null when the ladder is used up. */
  nextHintLevel: TrainingRung | null;
  /** The turn of the round the next counterpart turn would be; null when the round is full. */
  counterpartNextStep: TrainingRung | null;
}

/** The words of the modes, in the host's language. */
export interface TrainingModesText {
  /** The accessible name of the group. */
  region: string;
  hintButton: string;
  /** One line under «Pedir una pista» that says what a hint is. */
  hintExplain: string;
  /** "Next: hint {level} of 3, {name}" */
  hintNext: (level: TrainingRung, name: string) => string;
  /** Said when the three hints were given. */
  hintsDone: string;
  /** The accessible name of the list of rungs. */
  rungsLabel: string;
  rungs: Record<TrainingRung, string>;
  rungState: { used: string; next: string; pending: string };
  counterpartButton: string;
  counterpartExplain: string;
  /** "Turn {step} of 3 with the counterparty's lawyer" */
  counterpartStatus: (step: TrainingRung) => string;
  /** Said when the round is full and only closing it is left. */
  counterpartFull: string;
  closeButton: string;
  closeExplain: string;
}

const BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-background/70 px-3 py-1.5 text-sm font-medium text-foreground transition-[color,background-color,box-shadow] hover:bg-interactive-soft focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-focus/50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-background/70";

function Rung({
  rung,
  state,
  text,
}: {
  rung: TrainingRung;
  state: "used" | "next" | "pending";
  text: TrainingModesText;
}) {
  return (
    <li
      aria-current={state === "next" ? "step" : undefined}
      className={clsx(
        "flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs",
        state === "next"
          ? "border-interactive-border bg-interactive-soft-strong font-medium text-interactive"
          : "border-border text-muted-foreground",
      )}
    >
      {state === "used" ? (
        <Check aria-hidden="true" className="h-3 w-3 shrink-0" />
      ) : (
        <span aria-hidden="true">{rung}</span>
      )}
      <span className="min-w-0 break-words">{text.rungs[rung]}</span>
      <span className="sr-only">{`, ${text.rungState[state]}`}</span>
    </li>
  );
}

export function TrainingModesUI({
  id,
  state,
  text,
  onPick,
  disabled = false,
  error,
  className,
}: {
  /** Unique within the page; the descriptions are named after it. */
  id: string;
  state: TrainingModesState;
  text: TrainingModesText;
  /** Send the turn in this mode. */
  onPick: (mode: TrainingTurnMode) => void;
  disabled?: boolean;
  /** Said after a mode was asked for without what it needs. */
  error?: string | null;
  className?: string;
}) {
  const hint = state.modes.includes("hint") && state.nextHintLevel !== null;
  const counterpart =
    state.modes.includes("counterpart") && state.counterpartNextStep !== null;
  const close = state.modes.includes("counterpart_close");
  if (state.modes.length === 0) return null;

  const hintId = `${id}-hint`;
  const counterpartId = `${id}-counterpart`;
  const closeId = `${id}-close`;
  const errorId = `${id}-error`;
  const used = state.nextHintLevel === null ? 3 : state.nextHintLevel - 1;
  const rungState = (rung: TrainingRung) =>
    rung <= used ? "used" : rung === state.nextHintLevel ? "next" : "pending";

  return (
    <section
      aria-label={text.region}
      className={twMerge(clsx("flex min-w-0 flex-col gap-3", className))}
    >
      <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-3">
        {hint && state.nextHintLevel !== null ? (
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5">
            <button
              type="button"
              disabled={disabled}
              aria-describedby={clsx(hintId, error && errorId)}
              onClick={() => onPick("hint")}
              className={BUTTON_CLASS}
            >
              {text.hintButton}
            </button>
            <p id={hintId} className="text-xs text-muted-foreground">
              {text.hintExplain}{" "}
              <span className="font-medium text-foreground">
                {text.hintNext(state.nextHintLevel, text.rungs[state.nextHintLevel])}
              </span>
            </p>
            <ol aria-label={text.rungsLabel} className="flex min-w-0 flex-wrap gap-1.5">
              {TRAINING_HINT_RUNGS.map((rung) => (
                <Rung key={rung} rung={rung} state={rungState(rung)} text={text} />
              ))}
            </ol>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{text.hintsDone}</p>
        )}
        {counterpart && state.counterpartNextStep !== null ? (
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5">
            <button
              type="button"
              disabled={disabled}
              aria-describedby={clsx(counterpartId, error && errorId)}
              onClick={() => onPick("counterpart")}
              className={BUTTON_CLASS}
            >
              {text.counterpartButton}
            </button>
            <p id={counterpartId} className="text-xs text-muted-foreground">
              {text.counterpartExplain}{" "}
              <span className="font-medium text-foreground">
                {text.counterpartStatus(state.counterpartNextStep)}
              </span>
            </p>
          </div>
        ) : close ? (
          <p className="text-xs text-muted-foreground">{text.counterpartFull}</p>
        ) : null}
        {close ? (
          <div className="flex min-w-0 max-w-full flex-col items-start gap-1.5">
            <button
              type="button"
              disabled={disabled}
              aria-describedby={clsx(closeId, error && errorId)}
              onClick={() => onPick("counterpart_close")}
              className={BUTTON_CLASS}
            >
              {text.closeButton}
            </button>
            <p id={closeId} className="text-xs text-muted-foreground">
              {text.closeExplain}
            </p>
          </div>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
