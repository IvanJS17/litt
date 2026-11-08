import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// LiTT training (docs/training.md): the private note beside a pasante's chat
// turn — what they wrote before asking ("Tu planteamiento") and how the
// answer compares ("Contraste con tu planteamiento"). Rendered by the web
// chats and the Word add-in. Only the author and their current mentor are
// served the note; this component only draws it. Status is carried by text,
// never by colour alone.

/** The part of a turn note this component draws. */
export interface TrainingNoteView {
  attempt: string;
  /** Coincide / No coincide / Faltó; null until ready. */
  contrast: string | null;
  /** `skipped`: a turn with nothing to contrast; the contrast block is not drawn. */
  contrast_status: "pending" | "ready" | "failed" | "skipped";
}

export const TRAINING_NOTE_PRIVACY_LEGEND =
  "Privado: solo tú y tu mentor lo ven";

export function TrainingNoteUI({
  note,
  className,
}: {
  note: TrainingNoteView;
  className?: string;
}) {
  return (
    <section
      aria-label="Notas privadas de formación"
      className={twMerge(
        clsx(
          "flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white/70 px-4 py-3 text-left",
          className,
        ),
      )}
    >
      <div className="min-w-0">
        <h4 className="text-xs font-medium text-gray-600">Tu planteamiento</h4>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
          {note.attempt}
        </p>
      </div>
      {note.contrast_status !== "skipped" ? (
        <div className="min-w-0 border-t border-gray-200 pt-3">
          <h4 className="text-xs font-medium text-gray-600">
            Contraste con tu planteamiento
          </h4>
          {note.contrast_status === "ready" && note.contrast ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
              {note.contrast}
            </p>
          ) : note.contrast_status === "pending" ? (
            <p role="status" className="mt-1 text-sm text-gray-600">
              Generando contraste…
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-700">
              No se pudo generar el contraste
            </p>
          )}
        </div>
      ) : null}
      <p className="text-xs text-gray-500">{TRAINING_NOTE_PRIVACY_LEGEND}</p>
    </section>
  );
}
