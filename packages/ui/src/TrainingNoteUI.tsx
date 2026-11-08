import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type {
  TrainingConfidenceLevel,
  TrainingVerdictValue,
} from "@mike/contracts";
import { requestTrainingReply } from "./trainingReply";

// LiTT training (docs/training.md): the private note beside a pasante's chat
// turn — what they wrote before asking ("Tu planteamiento"), how sure they
// said they were, how the answer compares ("Contraste con tu planteamiento")
// with the verdict and, when the conclusion matched on a weak basis, one
// question about that basis with «Responder». Rendered by the web chats and
// the Word add-in; the host passes the words. Only the author and their
// current mentor are served the note; this component only draws it. Status is
// carried by text, never by colour alone, and the verdict is a coincidence
// with the AI's answer, never a score.

/** The part of a turn note this component draws. */
export interface TrainingNoteView {
  attempt: string;
  /** Coincide / No coincide / Faltó; null until ready. */
  contrast: string | null;
  /** `skipped`: a turn with nothing to contrast; the contrast block is not drawn. */
  contrast_status: "pending" | "ready" | "failed" | "skipped";
  /** The chat of the note: where «Responder» takes the question. */
  chat_id?: string;
  /** The mark the pasante gave their approach, 1 to 4. */
  confidence?: TrainingConfidenceLevel | null;
  /** The verdict that counts (the mentor's, or the contrast's after the basis rule). */
  effective_verdict?: TrainingVerdictValue | null;
  /** Whose verdict it is. */
  verdict_source?: "contrast" | "mentor" | null;
  /** The conclusion matched but the reasoning did not. */
  right_for_wrong_reason?: boolean;
  foundation?: "solid" | "weak" | "wrong" | null;
  /** One question about the basis, to answer in the next turn. */
  foundation_question?: string | null;
}

/** The words of the note, in the host's language. */
export interface TrainingNoteText {
  /** The accessible name of the note. */
  region: string;
  attemptHeading: string;
  contrastHeading: string;
  contrastPending: string;
  contrastFailed: string;
  privacy: string;
  /** "Your mark: {level}" */
  confidence: (level: string) => string;
  /** The label of each thermometer level. */
  confidenceLevels: Record<TrainingConfidenceLevel, string>;
  /** "Match with the answer, according to the AI contrast" */
  verdictHeading: string;
  verdicts: Record<TrainingVerdictValue, string>;
  /** Said besides a verdict the mentor wrote. */
  verdictByMentor: string;
  rightForWrongReason: string;
  /** "Basis: {basis}" */
  foundation: (basis: string) => string;
  foundations: Record<"solid" | "weak" | "wrong", string>;
  questionHeading: string;
  reply: string;
  /** The accessible name of «Responder». */
  replyLabel: string;
}

export function TrainingNoteUI({
  note,
  text,
  onReply,
  className,
}: {
  note: TrainingNoteView;
  text: TrainingNoteText;
  /** Overrides where «Responder» takes the question (the composer of the chat by default). */
  onReply?: (question: string) => void;
  className?: string;
}) {
  const ready = note.contrast_status === "ready" && !!note.contrast;
  const verdict = note.effective_verdict ?? null;
  const question = note.foundation_question?.trim() || null;
  const foundation = note.foundation ?? null;
  return (
    <section
      aria-label={text.region}
      className={twMerge(
        clsx(
          "flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background/70 px-4 py-3 text-left",
          className,
        ),
      )}
    >
      <div className="min-w-0">
        <h4 className="text-xs font-medium text-muted-foreground">{text.attemptHeading}</h4>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
          {note.attempt}
        </p>
        {note.confidence ? (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {text.confidence(text.confidenceLevels[note.confidence])}
          </p>
        ) : null}
      </div>
      {note.contrast_status !== "skipped" ? (
        <div className="min-w-0 border-t border-border pt-3">
          <h4 className="text-xs font-medium text-muted-foreground">{text.contrastHeading}</h4>
          {ready ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
              {note.contrast}
            </p>
          ) : note.contrast_status === "pending" ? (
            <p role="status" className="mt-1 text-sm text-muted-foreground">
              {text.contrastPending}
            </p>
          ) : (
            <p className="mt-1 text-sm text-foreground">{text.contrastFailed}</p>
          )}
          {ready && verdict ? (
            <div className="mt-2 min-w-0 text-sm text-foreground">
              <p className="break-words">
                <span className="text-xs font-medium text-muted-foreground">
                  {text.verdictHeading}
                </span>{" "}
                <strong className="font-semibold">{text.verdicts[verdict]}</strong>
                {note.verdict_source === "mentor" ? (
                  <span className="text-xs text-muted-foreground"> · {text.verdictByMentor}</span>
                ) : null}
              </p>
              {foundation ? (
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {text.foundation(text.foundations[foundation])}
                </p>
              ) : null}
              {note.right_for_wrong_reason ? (
                <p className="mt-1 break-words text-sm text-foreground">
                  {text.rightForWrongReason}
                </p>
              ) : null}
            </div>
          ) : null}
          {ready && question ? (
            <div className="mt-3 min-w-0 rounded-md bg-interactive-soft px-3 py-2">
              <h5 className="text-xs font-medium text-muted-foreground">{text.questionHeading}</h5>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
                {question}
              </p>
              <button
                type="button"
                aria-label={text.replyLabel}
                onClick={() =>
                  onReply
                    ? onReply(question)
                    : requestTrainingReply(question, note.chat_id)
                }
                className="mt-2 rounded-md px-2 py-1 text-sm font-medium text-interactive underline underline-offset-2 hover:text-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {text.reply}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-muted-foreground">{text.privacy}</p>
    </section>
  );
}
