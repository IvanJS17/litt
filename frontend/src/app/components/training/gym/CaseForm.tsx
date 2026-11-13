"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import { PillButtonUI } from "@mike/ui";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { FieldLabel, FormTextInput, FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";
import {
    draftGymCase,
    type TrainingGymCase,
    type TrainingGymCaseBody,
    type TrainingGymErrorKind,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { usePracticeOptionLabel } from "../trainingShared";
import { GymNotice, useGymKindOptions } from "./gymShared";

// The mentor's form for a fictitious gym case. Paragraphs are one textarea
// (a blank line separates them); the AI draft only fills the form.

type Row = { paragraph: number; kind: TrainingGymErrorKind; explanation: string; hint: string };

const splitParagraphs = (text: string) =>
    text
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);

export function CaseForm({
    orgId,
    existing,
    busy,
    onSave,
    onCancel,
}: {
    orgId: string;
    existing: TrainingGymCase | null;
    busy: boolean;
    onSave: (body: TrainingGymCaseBody) => void;
    onCancel: () => void;
}) {
    const t = useTranslations("training.gym");
    const practiceLabel = usePracticeOptionLabel();
    const id = useId();
    const kindOptions = useGymKindOptions();
    const [title, setTitle] = useState(existing?.title ?? "");
    const [practice, setPractice] = useState(existing?.practice ?? "");
    const [minutes, setMinutes] = useState(String(existing?.time_limit_minutes ?? 30));
    const [text, setText] = useState(existing?.paragraphs.join("\n\n") ?? "");
    const [rows, setRows] = useState<Row[]>(
        existing?.errors.map((error) => ({ ...error, hint: error.hint ?? "" })) ?? [],
    );
    const [fictitious, setFictitious] = useState(false);
    const [topic, setTopic] = useState("");
    const [count, setCount] = useState("3");
    const [drafting, setDrafting] = useState(false);

    const paragraphs = splitParagraphs(text);
    const minutesNumber = Number(minutes);
    const duplicate = new Set(rows.map((row) => row.paragraph)).size !== rows.length;
    const practiceOptions = PRACTICE_OPTIONS.filter((option) => option !== "Other").map((option) => ({
        value: option.trim().toLowerCase(),
        label: practiceLabel(option.trim().toLowerCase()),
    }));
    const valid =
        title.trim() !== "" &&
        practice !== "" &&
        Number.isInteger(minutesNumber) &&
        minutesNumber >= 1 &&
        minutesNumber <= 240 &&
        paragraphs.length > 0 &&
        !duplicate &&
        rows.every((row) => row.explanation.trim() !== "" && row.paragraph >= 1 && row.paragraph <= paragraphs.length) &&
        fictitious;
    const setRow = (index: number, patch: Partial<Row>) =>
        setRows(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

    const draft = async () => {
        setDrafting(true);
        try {
            const body = await draftGymCase(orgId, {
                practice,
                topic: topic.trim(),
                error_count: Number(count),
            });
            setTitle(body.title);
            setMinutes(String(body.time_limit_minutes));
            setText(body.paragraphs.join("\n\n"));
            setRows(body.errors.map((error) => ({ ...error, hint: error.hint ?? "" })));
        } catch (error) {
            notifyError(error, { action: t("mentor.actions.draft"), operation: "training.manage" });
        } finally {
            setDrafting(false);
        }
    };

    const field = "min-w-0 space-y-1";
    return (
        <form
            className="min-w-0 space-y-4 rounded-xl border border-gray-100 p-4"
            onSubmit={(event) => {
                event.preventDefault();
                if (!valid) return;
                onSave({
                    practice,
                    title: title.trim(),
                    paragraphs,
                    errors: rows.map((row) => ({
                        paragraph: row.paragraph,
                        kind: row.kind,
                        explanation: row.explanation.trim(),
                        hint: row.hint.trim() || null,
                    })),
                    time_limit_minutes: minutesNumber,
                    fictitious: true,
                });
            }}
        >
            <GymNotice />
            <div className={field}>
                <FieldLabel htmlFor={`${id}-title`}>{t("form.title")}</FieldLabel>
                <FormTextInput id={`${id}-title`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex min-w-0 flex-wrap gap-3">
                <div className={`${field} flex-1`}>
                    <FieldLabel as="p">{t("form.practice")}</FieldLabel>
                    <ModalSelect
                        id={`${id}-practice`}
                        aria-label={t("form.practice")}
                        value={practice}
                        options={
                            practice && !practiceOptions.some((option) => option.value === practice)
                                ? [...practiceOptions, { value: practice, label: practiceLabel(practice) }]
                                : practiceOptions
                        }
                        onChange={setPractice}
                        wrapLabels
                        className="min-w-0"
                    />
                </div>
                <div className={field}>
                    <FieldLabel htmlFor={`${id}-minutes`}>{t("form.minutes")}</FieldLabel>
                    <FormTextInput
                        id={`${id}-minutes`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={240}
                        value={minutes}
                        onChange={(e) => setMinutes(e.target.value)}
                        className="w-40"
                    />
                </div>
            </div>
            <div className={field}>
                <FieldLabel htmlFor={`${id}-text`}>{t("form.paragraphs")}</FieldLabel>
                <textarea
                    id={`${id}-text`}
                    aria-describedby={`${id}-help`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    className={`${FORM_CONTROL_GLASS_CLASS} min-h-40 py-2`}
                />
                <p id={`${id}-help`} className="text-xs text-gray-500">
                    {t("form.paragraphsHelp")}
                </p>
                {paragraphs.length > 0 && (
                    <div className="space-y-1">
                        <p className="text-xs font-medium text-gray-500">{t("form.preview")}</p>
                        <ol className="space-y-1 text-sm text-gray-700">
                            {paragraphs.map((paragraph, index) => (
                                <li key={index} className="break-words">
                                    <span className="font-medium text-gray-900">{index + 1}.</span> {paragraph}
                                </li>
                            ))}
                        </ol>
                    </div>
                )}
            </div>
            <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-gray-900">{t("form.errors")}</p>
                {rows.length === 0 && <p className="text-sm text-gray-500">{t("form.noErrors")}</p>}
                {rows.map((row, index) => (
                    <div key={index} className="min-w-0 space-y-2 rounded-xl border border-gray-100 p-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <ModalSelect
                                id={`${id}-p-${index}`}
                                aria-label={t("form.errorParagraph", { number: index + 1 })}
                                value={String(row.paragraph)}
                                options={paragraphs.map((_, at) => ({
                                    value: String(at + 1),
                                    label: t("paragraph", { number: at + 1 }),
                                }))}
                                onChange={(value) => setRow(index, { paragraph: Number(value) })}
                                className="w-40"
                            />
                            <ModalSelect
                                id={`${id}-k-${index}`}
                                aria-label={t("form.errorKind", { number: index + 1 })}
                                value={row.kind}
                                options={kindOptions}
                                onChange={(value) => setRow(index, { kind: value as TrainingGymErrorKind })}
                                wrapLabels
                                className="min-w-0 sm:w-56"
                            />
                            <button
                                type="button"
                                aria-label={t("form.removeError", { number: index + 1 })}
                                onClick={() => setRows(rows.filter((_, at) => at !== index))}
                                className="rounded p-1 text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                        </div>
                        <FormTextInput
                            aria-label={t("form.explanation", { number: index + 1 })}
                            placeholder={t("form.explanation", { number: index + 1 })}
                            value={row.explanation}
                            onChange={(e) => setRow(index, { explanation: e.target.value })}
                        />
                        <FormTextInput
                            aria-label={t("form.hint", { number: index + 1 })}
                            placeholder={t("form.hint", { number: index + 1 })}
                            value={row.hint}
                            onChange={(e) => setRow(index, { hint: e.target.value })}
                        />
                    </div>
                ))}
                {duplicate && <p className="text-sm text-gray-700">{t("form.duplicate")}</p>}
                <PillButtonUI
                    type="button"
                    tone="white"
                    size="sm"
                    disabled={paragraphs.length === 0}
                    onClick={() => setRows([...rows, { paragraph: 1, kind: "other", explanation: "", hint: "" }])}
                >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {t("form.addError")}
                </PillButtonUI>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                    type="checkbox"
                    className={TABLE_CHECKBOX_CLASS}
                    checked={fictitious}
                    onChange={(e) => setFictitious(e.target.checked)}
                />
                {t("form.fictitious")}
            </label>
            <div className="min-w-0 space-y-2">
                <p className="text-sm font-medium text-gray-900">{t("form.draftTitle")}</p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <FormTextInput
                        aria-label={t("form.draftTopic")}
                        placeholder={t("form.draftTopic")}
                        value={topic}
                        onChange={(e) => setTopic(e.target.value)}
                        className="min-w-0 flex-1"
                    />
                    <FormTextInput
                        aria-label={t("form.draftCount")}
                        type="number"
                        min={1}
                        max={5}
                        value={count}
                        onChange={(e) => setCount(e.target.value)}
                        className="w-24"
                    />
                    <PillButtonUI
                        type="button"
                        tone="white"
                        size="sm"
                        loading={drafting}
                        disabled={drafting || practice === "" || topic.trim() === "" || !(Number(count) >= 1 && Number(count) <= 5)}
                        onClick={() => void draft()}
                    >
                        {t("form.draftButton")}
                    </PillButtonUI>
                </div>
                <p className="text-xs text-gray-500">{t("form.draftHelp")}</p>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
                <PillButtonUI type="submit" tone="black" size="sm" loading={busy} disabled={busy || !valid}>
                    {t("form.save")}
                </PillButtonUI>
                <PillButtonUI type="button" tone="white" size="sm" onClick={onCancel}>
                    {t("form.cancel")}
                </PillButtonUI>
            </div>
        </form>
    );
}
