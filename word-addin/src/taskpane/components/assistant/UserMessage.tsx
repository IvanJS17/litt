import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import {
  AttachmentChipUI,
  ComposerChipsUI,
  ExcerptModalUI,
  ExcerptPillUI,
  TrainingNoteUI,
  type TrainingNoteView,
} from "@mike/ui";
import { parseExcerpts, type MessageExcerpt } from "@mike/client";
import { useTrainingText } from "../../i18n/useTrainingText";
import { useTranslations } from "use-intl";

const COLLAPSED_CONTENT_HEIGHT = 144;

/**
 * Right-aligned user bubble, duplicated from the web app's UserMessage
 * including the same file/workflow chips used by the frontend assistant.
 * Memoized: user turns never change while an answer streams below them.
 */
function UserMessageImpl({
  content,
  files,
  workflow,
  playbook,
  trainingNote,
}: {
  content: string;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
  /** The playbook this message ran, as the web thread shows it. */
  playbook?: { id: string; title: string };
  /** LiTT training: the private note beside this message, if any. */
  trainingNote?: TrainingNoteView;
}): React.ReactElement {
  const t = useTranslations();
  const trainingText = useTrainingText();
  const contentRef = useRef<HTMLParagraphElement>(null);
  const [canExpand, setCanExpand] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Passages quoted from an earlier response travel as leading blockquotes;
  // here they are pills that open the passage, as in the composer.
  const { excerpts, body } = parseExcerpts(content);
  const [openExcerpt, setOpenExcerpt] = useState<MessageExcerpt | null>(null);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    setExpanded(false);
    let frame: number | null = null;
    const measure = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        const overflows = element.scrollHeight > COLLAPSED_CONTENT_HEIGHT + 1;
        setCanExpand((current) =>
          current === overflows ? current : overflows,
        );
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [content]);

  return (
    <div className="w-full flex flex-col items-end gap-2">
      <div className="max-w-[80%] bg-gray-100 rounded-xl px-4 py-3">
        {body && (
          <div
            className="relative overflow-hidden"
            // Clamped from the very first frame (maxHeight is inert for short
            // content): the height painted on send is final, and ChatView's
            // pre-paint spacer measurement sees the same clamped box. Only the
            // gradient/expand affordances wait for the post-paint overflow
            // measurement — they don't change the box height.
            style={
              expanded ? undefined : { maxHeight: COLLAPSED_CONTENT_HEIGHT }
            }
            data-testid="user-message-content"
          >
            <p
              ref={contentRef}
              className={`text-sm text-gray-900 whitespace-pre-wrap break-words ${
                canExpand ? "pb-8" : ""
              }`}
            >
              {body}
            </p>
            {canExpand && !expanded && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent via-gray-100/80 to-gray-100 backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,transparent,black_55%)]"
              />
            )}
            {canExpand && (
              <button
                type="button"
                aria-label={
                  expanded ? t("word.collapseUserMessage") : t("word.expandUserMessage")
                }
                aria-expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
                className="absolute bottom-0 left-1/2 z-10 inline-flex h-7 w-9 -translate-x-1/2 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-200/90 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        )}
        {(workflow ||
          playbook ||
          (files && files.length > 0) ||
          excerpts.length > 0) && (
          <ComposerChipsUI
            justify="end"
            className={body ? "mt-3" : ""}
            workflow={workflow ? { title: workflow.title } : null}
            playbook={playbook ? { title: playbook.title } : null}
            attached={[
              ...excerpts.map((excerpt, index) => ({
                key: `excerpt-${index}`,
                node: (
                  <ExcerptPillUI
                    excerpt={excerpt}
                    onOpen={() => setOpenExcerpt(excerpt)}
                  />
                ),
              })),
              ...(files ?? []).map((file) => ({
                key: `${file.document_id ?? file.filename}-${file.filename}`,
                node: (
                  <AttachmentChipUI
                    name={file.filename}
                    icon={<FileText />}
                  />
                ),
              })),
            ]}
          />
        )}
      </div>
      {trainingNote && (
        <TrainingNoteUI
          note={trainingNote}
          text={trainingText.note}
          className="w-full max-w-[80%]"
        />
      )}
      <ExcerptModalUI
        excerpt={openExcerpt}
        onClose={() => setOpenExcerpt(null)}
      />
    </div>
  );
}

export const UserMessage = React.memo(UserMessageImpl);
