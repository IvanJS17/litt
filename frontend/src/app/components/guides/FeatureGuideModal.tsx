"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMessages, useTranslations } from "next-intl";
import type { TrainingStage } from "@mike/contracts";
import { PillButtonUI, TabPillButtonUI } from "@mike/ui";
import { Modal } from "@/app/components/modals/Modal";
import { type GuideContent, type GuideId, parseGuide, ROLE_GUIDE_IDS } from "./guideCatalog";
import { useMyTrainingStage } from "./useMyTrainingStage";

export function useGuide(id: GuideId): GuideContent {
    const messages = useMessages();
    return parseGuide((messages.guides as Record<string, unknown>)[id]);
}

const TAB_ORDER: TrainingStage[] = ["pasante", "junior"];

/** Tabs per WAI-ARIA: arrows, Home and End move and select; only the selected tab is in the tab order. */
function StageTabs({
    guide,
    stage,
    onStage,
    idBase,
}: {
    guide: GuideContent;
    stage: TrainingStage;
    onStage: (stage: TrainingStage) => void;
    idBase: string;
}) {
    const tabs = TAB_ORDER.flatMap((id) => guide.tabs.filter((tab) => tab.id === id));
    const refs = useRef<Record<string, HTMLButtonElement | null>>({});
    const move = (event: React.KeyboardEvent, index: number) => {
        const last = tabs.length - 1;
        const next =
            event.key === "ArrowRight" || event.key === "ArrowDown"
                ? (index + 1) % tabs.length
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? (index + last) % tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? last
                      : null;
        if (next === null) return;
        event.preventDefault();
        const target = tabs[next]!;
        onStage(target.id);
        refs.current[target.id]?.focus();
    };
    const current = tabs.find((tab) => tab.id === stage) ?? tabs[0]!;
    return (
        <div className="space-y-2">
            <div role="tablist" aria-label={guide.tabsLabel} className="flex shrink-0 gap-2">
                {tabs.map((tab, index) => {
                    const selected = tab.id === current.id;
                    return (
                        <TabPillButtonUI
                            key={tab.id}
                            ref={(node: HTMLButtonElement | null) => {
                                refs.current[tab.id] = node;
                            }}
                            id={`${idBase}-tab-${tab.id}`}
                            role="tab"
                            aria-pressed={undefined}
                            aria-selected={selected}
                            aria-controls={`${idBase}-panel`}
                            tabIndex={selected ? 0 : -1}
                            active={selected}
                            className="min-h-8 pointer-coarse:min-h-11"
                            onClick={() => onStage(tab.id)}
                            onKeyDown={(event) => move(event, index)}
                        >
                            {tab.label}
                        </TabPillButtonUI>
                    );
                })}
            </div>
            <p
                role="tabpanel"
                id={`${idBase}-panel`}
                aria-labelledby={`${idBase}-tab-${current.id}`}
                tabIndex={0}
                className="rounded-sm text-sm text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
                {current.body}
            </p>
        </div>
    );
}

function GuideBody({
    id,
    initialStage,
    onSwitch,
}: {
    id: GuideId;
    initialStage?: TrainingStage;
    onSwitch: (id: GuideId) => void;
}) {
    const t = useTranslations();
    const guide = useGuide(id);
    const idBase = useId();
    const title = useRef<HTMLHeadingElement>(null);
    const training = useMyTrainingStage();
    const [stage, setStage] = useState<TrainingStage>(initialStage ?? "pasante");
    const isRole = (ROLE_GUIDE_IDS as readonly string[]).includes(id);
    // Focus goes to the title when the guide opens, so a screen reader starts at its beginning.
    // A frame later: the dialog notes the button that opened it (to give focus
    // back on close) when its own effect runs, which is after this one.
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => title.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [id]);
    // The guide for training opens on the person's own stage once it is known.
    const [followed, setFollowed] = useState(false);
    useEffect(() => {
        if (!followed && !initialStage && training.stage) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- adopt the stage once it is read
            setStage(training.stage);
            setFollowed(true);
        }
    }, [followed, initialStage, training.stage]);

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4" data-guide-id={id}>
            <div data-modal-scroll className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
                <div className="space-y-2">
                    <h2
                        ref={title}
                        tabIndex={-1}
                        className="rounded-sm font-serif text-2xl font-medium text-gray-900 focus-visible:outline-none"
                    >
                        {guide.title}
                    </h2>
                    <p className="text-sm text-gray-700">{guide.summary}</p>
                </div>
                {guide.tabs.length > 0 ? (
                    <StageTabs guide={guide} stage={stage} onStage={setStage} idBase={idBase} />
                ) : null}
                {guide.sections.map((section) => (
                    <section key={section.heading} className="space-y-1">
                        <h3 className="text-sm font-semibold text-gray-900">{section.heading}</h3>
                        {section.body ? <p className="text-sm text-gray-700">{section.body}</p> : null}
                        {section.items.length > 0 ? (
                            <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
                                {section.items.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        ) : null}
                    </section>
                ))}
                {!isRole && training.stage ? (
                    <section className="space-y-2 border-l-2 border-[var(--litt-note-rule)] pl-3">
                        <h3 className="text-sm font-semibold text-gray-900">{t("guides.ui.ifTraining")}</h3>
                        <p className="text-sm text-gray-700">{t("guides.ui.ifTrainingBody")}</p>
                        <PillButtonUI
                            tone="white"
                            size="sm"
                            className="min-h-8 pointer-coarse:min-h-11"
                            onClick={() => onSwitch("pupil")}
                        >
                            {t("guides.ui.pupilLink")}
                        </PillButtonUI>
                    </section>
                ) : null}
            </div>
        </div>
    );
}

/**
 * The one guide dialog, fed by the catalog (`guides.<id>.*`): a dialog on a
 * desktop and a bottom sheet on a phone (the shared Modal, as the model
 * guide). It never opens by itself; a trigger, an empty state or /help opens
 * it. A guide with tabs (the pupil's) opens on `initialStage`.
 */
export function FeatureGuideModal({
    id,
    open,
    onClose,
    initialStage,
}: {
    id: GuideId;
    open: boolean;
    onClose: () => void;
    initialStage?: TrainingStage;
}) {
    const [shown, setShown] = useState<GuideId>(id);
    const [lastId, setLastId] = useState(id);
    if (lastId !== id) {
        setLastId(id);
        setShown(id);
    }
    const guide = useGuide(shown);
    return (
        <Modal open={open} onClose={onClose} size="md" breadcrumbs={[guide.title]}>
            <GuideBody key={shown} id={shown} initialStage={shown === "pupil" ? initialStage : undefined} onSwitch={setShown} />
        </Modal>
    );
}
