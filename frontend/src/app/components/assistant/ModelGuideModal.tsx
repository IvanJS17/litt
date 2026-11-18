"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
    PillButtonUI,
    REASONING_LEVELS,
    REASONING_LEVEL_LABEL_KEYS,
    TabPillButtonUI,
    type ModelToggleOption,
} from "@mike/ui";
import { Modal } from "../modals/Modal";
import { useModelGuide } from "@/app/hooks/useModelGuide";

type GuideTab = "models" | "reasoning";

interface Props {
    open: boolean;
    onClose: () => void;
    /** The models the person can use now; the guide offers no other. */
    models: readonly ModelToggleOption[];
    value: string;
    /** «Usar este»: select the model; the dialog then closes. */
    onSelect: (id: string) => void;
}

/**
 * The full model guide («¿Cuál elijo?»): a dialog on a desktop and a bottom
 * sheet on a phone (the shared Modal). Its texts live in the `modelGuide`
 * catalog; a model without an entry is listed by name under «Otros modelos».
 */
export function ModelGuideModal({
    open,
    onClose,
    models,
    value,
    onSelect,
}: Props) {
    const t = useTranslations();
    const guide = useModelGuide();
    const [tab, setTab] = useState<GuideTab>("models");
    const described = models.flatMap((model) => {
        const entry = guide.entryFor(model.id);
        return entry ? [{ model, entry }] : [];
    });
    const others = models.filter((model) => !guide.entryFor(model.id));

    const row = (model: ModelToggleOption, body?: React.ReactNode) => {
        const current = model.id === value;
        return (
            <li
                key={model.id}
                className="flex items-start gap-3 py-2.5"
            >
                <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 [overflow-wrap:anywhere]">
                        {model.label}
                    </p>
                    {body}
                </div>
                {current ? (
                    <span className="shrink-0 pt-1 text-xs text-gray-500">
                        {t("assistant.modelGuide.inUse")}
                    </span>
                ) : (
                    <PillButtonUI
                        tone="white"
                        aria-label={t("assistant.modelGuide.useThisLabel", {
                            model: model.label,
                        })}
                        onClick={() => {
                            onSelect(model.id);
                            onClose();
                        }}
                    >
                        {t("assistant.modelGuide.useThis")}
                    </PillButtonUI>
                )}
            </li>
        );
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="md"
            breadcrumbs={[t("assistant.modelGuide.title")]}
        >
            <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
                <div className="flex shrink-0 gap-2">
                    <TabPillButtonUI
                        active={tab === "models"}
                        onClick={() => setTab("models")}
                    >
                        {t("assistant.modelGuide.tabModels")}
                    </TabPillButtonUI>
                    <TabPillButtonUI
                        active={tab === "reasoning"}
                        onClick={() => setTab("reasoning")}
                    >
                        {t("assistant.modelGuide.tabReasoning")}
                    </TabPillButtonUI>
                </div>
                <div
                    data-modal-scroll
                    className="min-h-0 flex-1 overflow-y-auto"
                >
                    {tab === "models" ? (
                        <>
                            <p className="mb-1 text-xs text-gray-700">
                                {guide.recommended}
                            </p>
                            <ul className="divide-y divide-gray-100">
                                {described.map(({ model, entry }) =>
                                    row(
                                        model,
                                        <div className="mt-1 space-y-0.5 text-xs text-gray-600">
                                            {entry.useFor && (
                                                <p>
                                                    <span className="font-medium text-gray-900">
                                                        {t("assistant.modelGuide.useFor")}:{" "}
                                                    </span>
                                                    {entry.useFor}
                                                </p>
                                            )}
                                            {entry.notice && (
                                                <p>
                                                    <span className="font-medium text-gray-900">
                                                        {t("assistant.modelGuide.notice")}:{" "}
                                                    </span>
                                                    {entry.notice}
                                                </p>
                                            )}
                                        </div>,
                                    ),
                                )}
                            </ul>
                            {others.length > 0 && (
                                <>
                                    <h3 className="mt-3 text-xs font-semibold text-gray-900">
                                        {t("assistant.modelGuide.others")}
                                    </h3>
                                    <ul className="divide-y divide-gray-100">
                                        {others.map((model) => row(model))}
                                    </ul>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <p className="mb-1 text-xs text-gray-600">
                                {guide.availability}
                            </p>
                            <ul className="divide-y divide-gray-100">
                                {REASONING_LEVELS.map((level) => (
                                    <li
                                        key={level}
                                        className="flex items-start gap-3 py-2.5"
                                    >
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-gray-900">
                                                {t(
                                                    REASONING_LEVEL_LABEL_KEYS[
                                                        level
                                                    ],
                                                )}
                                            </p>
                                            <p className="text-xs text-gray-600">
                                                {guide.levelHints[level]}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>
                <div className="shrink-0 space-y-0.5 text-2xs text-gray-500">
                    <p>{guide.intro}</p>
                    <p>{guide.retention}</p>
                    <p>{guide.disclaimer}</p>
                    <p>
                        {t("assistant.modelGuide.updated", {
                            date: guide.updated,
                        })}
                    </p>
                </div>
            </div>
        </Modal>
    );
}
