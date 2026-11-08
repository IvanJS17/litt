"use client";

import { clsx } from "clsx";
import { CircleHelp, ShieldCheck, TriangleAlert } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { twMerge } from "tailwind-merge";
import type {
  TrainingBackingCheck,
  TrainingBackingConclusion,
  TrainingBackingMark,
  TrainingBackingStatus,
} from "@mike/contracts";

// LiTT training layer 3, «Modo de rendir cuentas» (docs/training.md): under a
// junior's answer, each conclusion it makes and the source LiTT could show
// for it. The status is the server's (the AI only proposes which citation a
// conclusion rests on): «respaldada» has the exact passage from a document in
// LiTT beside it; «cita sin verificar» names a quote LiTT could not find;
// «sin respaldo» has no citation, which includes any law cited from memory
// (LiTT has no corpus of laws). The status is carried by text and shape (an
// icon and a word), never by colour alone. Rendered by the web app and the
// Word add-in; both pass their own texts (`BackingPanelLabels`) and never
// import from this file's host.

/** The longest reason the server accepts for keeping a conclusion. */
export const BACKING_NOTE_MAX_CHARS = 500;

/** Everything the panel says; the host fills it from the catalog. */
export interface BackingPanelLabels {
  title: string;
  intro: string;
  listLabel: string;
  pending: string;
  failed: string;
  privacy: string;
  status: Record<TrainingBackingStatus, string>;
  statusHelp: Record<TrainingBackingStatus, string>;
  /** «Cita 2». */
  citationRef: (ref: number) => string;
  passageLabel: string;
  /** «contrato.docx, página 3»; the page is absent when the citation has none. */
  passageSource: (source: { title: string | null; page: number | string | null }) => string;
  /** «Sin verificar: art. 27. Confírmalo en la fuente oficial.» */
  unverifiedReferences: (references: string) => string;
  verified: string;
  reasonLabel: string;
  reasonHint: (max: number) => string;
  reasonSave: string;
  saving: string;
  saved: string;
  personVerified: string;
  personNotVerified: string;
  personReason: string;
}

const STATUS_ICON = {
  backed: ShieldCheck,
  citation_unverified: TriangleAlert,
  unbacked: CircleHelp,
} as const;

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2";

function StatusLine({
  conclusion,
  labels,
}: {
  conclusion: TrainingBackingConclusion;
  labels: BackingPanelLabels;
}) {
  const Icon = STATUS_ICON[conclusion.status];
  return (
    <p className="mt-1 flex min-w-0 flex-wrap items-start gap-x-1.5 gap-y-0.5 text-xs text-gray-700">
      <Icon aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="font-medium text-gray-900">
        {labels.status[conclusion.status]}
        {conclusion.status === "citation_unverified" && conclusion.citation_ref !== null
          ? ` · ${labels.citationRef(conclusion.citation_ref)}`
          : ""}
      </span>
      <span className="min-w-0 break-words">{labels.statusHelp[conclusion.status]}</span>
    </p>
  );
}

function Conclusion({
  conclusion,
  labels,
  readOnly,
  onMark,
}: {
  conclusion: TrainingBackingConclusion;
  labels: BackingPanelLabels;
  readOnly: boolean;
  onMark?: (conclusionId: string, mark: TrainingBackingMark) => Promise<void>;
}) {
  const uid = useId();
  const textId = `${uid}-text`;
  const reasonId = `${uid}-reason`;
  const hintId = `${uid}-hint`;
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const saved = conclusion.person_note ?? "";
  const reason = draft ?? saved;

  const mark = async (next: TrainingBackingMark, isReason = false) => {
    if (!onMark || busy) return;
    setBusy(true);
    setJustSaved(false);
    try {
      await onMark(conclusion.id, next);
      if (isReason) {
        setDraft(null);
        setJustSaved(true);
      }
    } catch {
      // The host already told the person why; the controls stay as they were.
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="min-w-0 border-t border-gray-200 pt-3 first:border-t-0 first:pt-0">
      <p id={textId} className="whitespace-pre-wrap break-words text-sm text-gray-900">
        {conclusion.text}
      </p>
      <StatusLine conclusion={conclusion} labels={labels} />
      {conclusion.passage && (
        <figure className="mt-2 min-w-0 border-l-2 border-gray-300 pl-3">
          <figcaption className="break-words text-xs text-gray-600">
            {labels.passageLabel} · {labels.passageSource(conclusion.passage)}
          </figcaption>
          <blockquote className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-800">
            {conclusion.passage.excerpt}
          </blockquote>
        </figure>
      )}
      {conclusion.unverified_references.length > 0 && (
        <p className="mt-1 break-words text-xs text-gray-700">
          {labels.unverifiedReferences(conclusion.unverified_references.join(", "))}
        </p>
      )}
      {readOnly ? (
        <div className="mt-2 min-w-0 text-xs text-gray-700">
          <p>{conclusion.person_verified ? labels.personVerified : labels.personNotVerified}</p>
          {conclusion.person_note && (
            <p className="mt-0.5 whitespace-pre-wrap break-words">
              <span className="font-medium text-gray-900">{labels.personReason}: </span>
              {conclusion.person_note}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 flex min-w-0 flex-col gap-2">
          <label className="inline-flex w-fit items-center gap-2 text-sm text-gray-800">
            <input
              type="checkbox"
              checked={conclusion.person_verified}
              aria-busy={busy}
              aria-describedby={textId}
              onChange={(event) => void mark({ person_verified: event.target.checked })}
              className={clsx("h-4 w-4 shrink-0 cursor-pointer rounded accent-black", FOCUS_RING)}
            />
            {labels.verified}
          </label>
          {conclusion.status !== "backed" && (
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={reasonId} className="text-xs font-medium text-gray-700">
                {labels.reasonLabel}
              </label>
              <textarea
                id={reasonId}
                value={reason}
                rows={2}
                maxLength={BACKING_NOTE_MAX_CHARS}
                aria-busy={busy}
                aria-describedby={hintId}
                onChange={(event) => {
                  setJustSaved(false);
                  setDraft(event.target.value);
                }}
                className={clsx(
                  "w-full min-w-0 resize-y rounded-md border border-gray-200 bg-white/70 px-3 py-2 text-sm text-gray-900 outline-none transition-[color,box-shadow]",
                  "focus-visible:border-focus focus-visible:ring-[3px] focus-visible:ring-focus/30",
                )}
              />
              <p id={hintId} className="text-xs text-gray-600">
                {labels.reasonHint(BACKING_NOTE_MAX_CHARS)}
              </p>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                {/* aria-disabled, not disabled: the button keeps keyboard focus while it saves. */}
                <button
                  type="button"
                  aria-disabled={busy || reason.trim() === saved.trim()}
                  onClick={() => {
                    if (busy || reason.trim() === saved.trim()) return;
                    void mark({ person_note: reason.trim() || null }, true);
                  }}
                  className={clsx(
                    "inline-flex min-h-8 items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-900 hover:bg-gray-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
                    FOCUS_RING,
                  )}
                >
                  {busy ? labels.saving : labels.reasonSave}
                </button>
                <span role="status" className="text-xs text-gray-600">
                  {justSaved ? labels.saved : ""}
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The accountability panel of one answer. Nothing while the answer has no
 * conclusions; a line while the check runs or if it failed. `readOnly` is the
 * mentor's view: the same conclusions, passages and statuses, plus what the
 * person did with each, and no controls.
 */
export function BackingPanelUI({
  check,
  labels,
  readOnly = false,
  onMark,
  className,
  heading,
}: {
  check: Pick<TrainingBackingCheck, "id" | "status" | "conclusions">;
  labels: BackingPanelLabels;
  readOnly?: boolean;
  /** Saves «lo verifiqué» or the reason; the host reports its own failures. */
  onMark?: (conclusionId: string, mark: TrainingBackingMark) => Promise<void>;
  className?: string;
  /** Replaces the default title (the mentor's section names the answer). */
  heading?: ReactNode;
}) {
  const titleId = useId();
  const box = twMerge(
    clsx("flex min-w-0 flex-col gap-3 rounded-lg border border-gray-200 bg-white/70 px-4 py-3 text-left", className),
  );
  if (check.status === "pending") {
    return (
      <p role="status" className={twMerge(box, "text-sm text-gray-600")}>
        {labels.pending}
      </p>
    );
  }
  if (check.status === "failed") {
    return <p className={twMerge(box, "text-sm text-gray-700")}>{labels.failed}</p>;
  }
  const conclusions = check.conclusions ?? [];
  if (conclusions.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className={box}>
      <div className="min-w-0">
        <h4 id={titleId} className="text-sm font-medium text-gray-900">
          {heading ?? labels.title}
        </h4>
        {!readOnly && <p className="mt-1 text-xs text-gray-600">{labels.intro}</p>}
      </div>
      <ol aria-label={labels.listLabel} className="flex min-w-0 flex-col gap-3">
        {conclusions.map((conclusion) => (
          <Conclusion
            key={conclusion.id}
            conclusion={conclusion}
            labels={labels}
            readOnly={readOnly}
            onMark={onMark}
          />
        ))}
      </ol>
      <p className="text-xs text-gray-500">{labels.privacy}</p>
    </section>
  );
}

/** The catalog key of each label (namespace `training.criterion.backing`), for the hosts. */
export const BACKING_LABEL_KEYS = {
  title: "training.criterion.backing.title",
  intro: "training.criterion.backing.intro",
  listLabel: "training.criterion.backing.listLabel",
  pending: "training.criterion.backing.pending",
  failed: "training.criterion.backing.failed",
  privacy: "training.criterion.backing.privacy",
  statusBacked: "training.criterion.backing.status.backed",
  statusUnbacked: "training.criterion.backing.status.unbacked",
  statusCitationUnverified: "training.criterion.backing.status.citationUnverified",
  helpBacked: "training.criterion.backing.statusHelp.backed",
  helpUnbacked: "training.criterion.backing.statusHelp.unbacked",
  helpCitationUnverified: "training.criterion.backing.statusHelp.citationUnverified",
  citationRef: "training.criterion.backing.citationRef",
  passageLabel: "training.criterion.backing.passageLabel",
  passageSource: "training.criterion.backing.passageSource",
  passageSourceNoPage: "training.criterion.backing.passageSourceNoPage",
  passageUntitled: "training.criterion.backing.passageUntitled",
  unverifiedReferences: "training.criterion.backing.unverifiedReferences",
  verified: "training.criterion.backing.verified",
  reasonLabel: "training.criterion.backing.reasonLabel",
  reasonHint: "training.criterion.backing.reasonHint",
  reasonSave: "training.criterion.backing.reasonSave",
  saving: "training.criterion.backing.saving",
  saved: "training.criterion.backing.saved",
  personVerified: "training.criterion.backing.personVerified",
  personNotVerified: "training.criterion.backing.personNotVerified",
  personReason: "training.criterion.backing.personReason",
} as const;

export type BackingTranslate = (
  key: (typeof BACKING_LABEL_KEYS)[keyof typeof BACKING_LABEL_KEYS],
  values?: Record<string, string | number>,
) => string;

/** Builds the panel's texts from a translator, so the web app and the add-in say the same thing. */
export function buildBackingLabels(t: BackingTranslate): BackingPanelLabels {
  const k = BACKING_LABEL_KEYS;
  return {
    title: t(k.title),
    intro: t(k.intro),
    listLabel: t(k.listLabel),
    pending: t(k.pending),
    failed: t(k.failed),
    privacy: t(k.privacy),
    status: {
      backed: t(k.statusBacked),
      unbacked: t(k.statusUnbacked),
      citation_unverified: t(k.statusCitationUnverified),
    },
    statusHelp: {
      backed: t(k.helpBacked),
      unbacked: t(k.helpUnbacked),
      citation_unverified: t(k.helpCitationUnverified),
    },
    citationRef: (ref) => t(k.citationRef, { ref }),
    passageLabel: t(k.passageLabel),
    passageSource: ({ title, page }) => {
      const name = title ?? t(k.passageUntitled);
      return page === null || page === "" ? t(k.passageSourceNoPage, { title: name }) : t(k.passageSource, { title: name, page });
    },
    unverifiedReferences: (references) => t(k.unverifiedReferences, { references }),
    verified: t(k.verified),
    reasonLabel: t(k.reasonLabel),
    reasonHint: (max) => t(k.reasonHint, { max }),
    reasonSave: t(k.reasonSave),
    saving: t(k.saving),
    saved: t(k.saved),
    personVerified: t(k.personVerified),
    personNotVerified: t(k.personNotVerified),
    personReason: t(k.personReason),
  };
}
