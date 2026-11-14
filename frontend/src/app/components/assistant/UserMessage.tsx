"use client";

import { useState } from "react";
import Link from "next/link";
import { playbookPath } from "../playbooks/PlaybookTable";
import { FileTypeIcon } from "../shared/FileTypeIcon";
import type { MessageFile } from "../shared/types";
import {
    AttachmentChipUI,
    ComposerChipsUI,
    ExcerptModalUI,
    ExcerptPillUI,
} from "@mike/ui";
import {
    parseExcerpts,
    type MessageExcerpt,
} from "@mike/client";
import { TrainingNoteUI, type TrainingNoteView } from "@mike/ui";
import { useTrainingText } from "@/app/hooks/useTrainingText";
import { useTranslations } from "next-intl";

interface Props {
    content: string;
    files?: MessageFile[];
    workflow?: { id: string; title: string };
    /** The playbook this message ran; its pill links to the playbook. */
    playbook?: { id: string; title: string };
    onFileClick?: (file: MessageFile) => void;
    /** Reveals the workflow this message ran, in the workflow modal. */
    onWorkflowClick?: (workflow: { id: string; title: string }) => void;
    /** LiTT training: the private note beside this message, if any. */
    trainingNote?: TrainingNoteView;
}

export function UserMessage({
    content,
    files,
    workflow,
    playbook,
    onFileClick,
    onWorkflowClick,
    trainingNote,
}: Props) {
    const t = useTranslations();
    const trainingText = useTrainingText();
    const hasFiles = files && files.length > 0;
    // Passages quoted from an earlier response travel as leading blockquotes;
    // here they are pills that open the passage, as in the composer.
    const { excerpts, body } = parseExcerpts(content);
    const [openExcerpt, setOpenExcerpt] = useState<MessageExcerpt | null>(
        null,
    );

    return (
        <div className="w-full flex flex-col items-end gap-2">
            <div className="max-w-[80%] bg-gray-100 rounded-xl px-4 py-3">
                {body && (
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">
                        {body}
                    </p>
                )}
                {(workflow || playbook || hasFiles || excerpts.length > 0) && (
                    <ComposerChipsUI
                        justify="end"
                        className={body ? "mt-3" : ""}
                        workflow={
                            workflow
                                ? {
                                      title: workflow.title,
                                      onOpen: onWorkflowClick
                                          ? () => onWorkflowClick(workflow)
                                          : undefined,
                                  }
                                : null
                        }
                        playbook={
                            playbook
                                ? {
                                      title: playbook.title,
                                      renderOpen: ({
                                          children,
                                          className,
                                          ariaLabel,
                                      }) => (
                                          <Link
                                              href={playbookPath(playbook.id)}
                                              aria-label={ariaLabel}
                                              className={className}
                                          >
                                              {children}
                                          </Link>
                                      ),
                                  }
                                : null
                        }
                        attached={[
                            ...excerpts.map((excerpt, i) => ({
                                key: `excerpt-${i}`,
                                node: (
                                    <ExcerptPillUI
                                        excerpt={excerpt}
                                        onOpen={() => setOpenExcerpt(excerpt)}
                                    />
                                ),
                            })),
                            ...(files ?? []).map((f, i) => ({
                                key: `file-${i}`,
                                node: (
                                    <AttachmentChipUI
                                        name={f.filename}
                                        icon={
                                            <FileTypeIcon fileType={f.filename} />
                                        }
                                        onOpen={
                                            f.document_id && onFileClick
                                                ? () => onFileClick(f)
                                                : undefined
                                        }
                                        openLabel={t(
                                            "assistant.userMessage.openFilename",
                                            { filename: f.filename },
                                        )}
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
