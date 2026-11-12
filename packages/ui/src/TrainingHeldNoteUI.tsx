import { useTranslations } from "use-intl";
import { twMerge } from "tailwind-merge";

// LiTT training (docs/training.md): the mark of a pasante's version that is
// not approved for its current bytes. It can be viewed inside LiTT but not
// downloaded or exported; the server refuses that with a 409. Plain text, no
// pill: it is a status, not a control. Rendered by the web app and the Word
// add-in.

/** The catalog key of the held-draft mark; read it with the caller's `t`. */
export const TRAINING_HELD_LABEL_KEY = "ui.trainingHeldNote.label" as const;

/** Whether a document or version may not leave LiTT yet. */
export function isTrainingHeld(item: { training_held?: boolean } | null | undefined): boolean {
  return item?.training_held === true;
}

export function TrainingHeldNoteUI({ className }: { className?: string }) {
  const t = useTranslations();
  return (
    <span className={twMerge("min-w-0 break-words text-xs text-muted-foreground", className)}>
      {t(TRAINING_HELD_LABEL_KEY)}
    </span>
  );
}
