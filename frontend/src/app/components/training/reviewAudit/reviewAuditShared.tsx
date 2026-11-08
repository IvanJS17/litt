"use client";

import { useTranslations } from "next-intl";
import type {
    TrainingAuditCell,
    TrainingAuditColumn,
    TrainingAuditMark,
    TrainingLintWarning,
} from "@/app/lib/mikeApi";
import { preprocessCitations } from "@/app/components/tabular/citation-utils";

// LiTT training layer 3, bulk review designer (docs/training.md): pieces the
// junior's page and the mentor's section share. The answers, passages and
// notes are the review's and the people's own text: shown as they are, never
// translated; every label around them is.

export const AUDIT_MARKS: readonly TrainingAuditMark[] = ["correct", "incomplete", "incorrect"];
/** The server's limit for a note. */
export const AUDIT_NOTE_MAX_CHARS = 500;

/** A reasoning split into its prose and the passages it cites. */
export function splitReasoning(reasoning: string | null): { prose: string; passages: { page?: number; quote: string }[] } {
    if (!reasoning) return { prose: "", passages: [] };
    const { processed, citations } = preprocessCitations(reasoning);
    return {
        prose: processed.replace(/§\d+§/g, "").replace(/[ \t]+\n/g, "\n").replace(/\s{2,}/g, " ").trim(),
        passages: citations.map((citation) => ({ page: citation.page, quote: citation.quote })),
    };
}

/** The column the way a warning names it: its name in quotes, or «Column n». */
export function useColumnLabel(columns: readonly TrainingAuditColumn[]) {
    const t = useTranslations("training.criterion.audit");
    return (index: number) => {
        const name = columns.find((column) => column.index === index)?.name.trim();
        return name ? `“${name}”` : t("design.column", { number: index + 1 });
    };
}

/** The design review of the questions: plain text notes, never blocks. */
export function LintNotes({
    columns,
    lint,
}: {
    columns: readonly TrainingAuditColumn[];
    lint: readonly TrainingLintWarning[];
}) {
    const t = useTranslations("training.criterion.audit");
    const label = useColumnLabel(columns);
    if (lint.length === 0) return <p className="text-sm text-gray-700">{t("design.clean")}</p>;
    return (
        <ul className="min-w-0 list-disc space-y-1 pl-5 text-sm text-gray-700">
            {lint.map((warning) => (
                <li key={`${warning.code}:${warning.column_index}`} className="break-words">
                    {t(`lint.${warning.code}`, {
                        column: label(warning.column_index),
                        other: label(warning.other_index ?? warning.column_index),
                    })}
                </li>
            ))}
        </ul>
    );
}

/** The questions as designed: name and instruction of each column. */
export function ColumnList({ columns }: { columns: readonly TrainingAuditColumn[] }) {
    const t = useTranslations("training.criterion.audit");
    const label = useColumnLabel(columns);
    return (
        <ol className="min-w-0 space-y-2 text-sm">
            {columns.map((column) => (
                <li key={column.index} className="min-w-0">
                    <p className="break-words font-medium text-gray-900">{label(column.index)}</p>
                    <p className="break-words text-gray-500">
                        {column.prompt.trim() ? t("design.instruction", { text: column.prompt.trim() }) : t("design.noInstruction")}
                    </p>
                </li>
            ))}
        </ol>
    );
}

/** One sampled answer with the passage it cites; the marking controls go in `children`. */
export function AuditCellBody({ cell }: { cell: TrainingAuditCell }) {
    const t = useTranslations("training.criterion.audit");
    if (cell.withheld) return <p className="text-sm text-gray-500">{t("cell.withheld")}</p>;
    const { prose, passages } = splitReasoning(cell.reasoning);
    return (
        <div className="min-w-0 space-y-3 text-sm">
            <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-gray-500">{t("cell.answer")}</p>
                <p className="whitespace-pre-wrap break-words text-gray-900">{cell.summary}</p>
            </div>
            {prose && (
                <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium text-gray-500">{t("cell.reasoning")}</p>
                    <p className="whitespace-pre-wrap break-words text-gray-700">{prose}</p>
                </div>
            )}
            <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-gray-500">{t("cell.passages")}</p>
                {passages.length === 0 ? (
                    <p className="text-gray-500">{t("cell.noPassage")}</p>
                ) : (
                    <ul className="space-y-2">
                        {passages.map((passage, index) => (
                            <li key={index} className="min-w-0 border-l-2 border-gray-300 pl-3">
                                <p className="break-words italic text-gray-700">{passage.quote}</p>
                                {passage.page !== undefined && (
                                    <p className="text-xs text-gray-500">{t("cell.page", { page: passage.page })}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
