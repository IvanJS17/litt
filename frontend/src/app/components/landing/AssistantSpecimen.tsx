"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, CircleCheck, FileText, PenLine, Workflow } from "lucide-react";
import {
    CitationPillUI,
    KeyChipUI,
    ModelChipPreviewUI,
    ModelMenuPreviewUI,
    reasoningLevelsForModel,
} from "@mike/ui";
import { PICKER_MODELS, PICKER_SELECTED_ID } from "./landingModels";
import { LANDING_FOCUS } from "./landingStyles";

/** The steps come in once per browser session (SPEC v2 §3.4). */
export const INTRO_SESSION_KEY = "litt:landing-intro";

/** First step at 250 ms, then one every 260 ms: four steps, the answer, the document. */
const INTRO_START_MS = 250;
const INTRO_STEP_MS = 260;
const INTRO_ITEMS = 6;

/** The menu's chosen model and its reasoning: "Alto", three steps of four. */
const PICKER_LEVELS = reasoningLevelsForModel(PICKER_SELECTED_ID);
const PICKER_LEVEL = "high";
const PICKER_CHOSEN = PICKER_MODELS.find((model) => model.id === PICKER_SELECTED_ID);
const pickerLabel = PICKER_CHOSEN?.label ?? PICKER_SELECTED_ID;

type Source = 1 | 2 | 3;
const PAGES: Record<Source, number> = { 1: 2, 2: 7, 3: 9 };

/**
 * The citation pill of the app (`CitationPillUI`) at the size the page draws it:
 * 22 × 20 px to the eye, 44 px tall to the finger (the pseudo-element).
 */
const PILL_CLASS = `relative mx-0.5 inline-grid h-5 w-auto min-w-[22px] place-items-center px-[5px] align-[0.12em] font-sans text-[11px] font-semibold leading-none tabular-nums bg-interactive-soft-strong text-foreground hover:bg-interactive-soft-strong hover:text-foreground before:absolute before:-inset-x-1.5 before:-inset-y-3 before:content-[''] ${LANDING_FOCUS}`;

/** The active citation is filled (tinta / papel), as `aria-pressed` says. */
const PILL_ACTIVE_CLASS =
    "!bg-interactive !text-interactive-foreground hover:!bg-interactive-hover hover:!text-interactive-foreground dark:!bg-interactive dark:!text-interactive-foreground dark:hover:!bg-interactive-hover dark:hover:!text-interactive-foreground";

const MARK = "rounded-[3px] bg-interactive-soft-strong px-0.5 text-inherit";

/** A page of a document (a DOCX or PDF of the user's), drawn small. It is white in both themes. */
export function FileGlyph({ label, className = "" }: { label: string; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={`grid shrink-0 place-items-center rounded-[4px] bg-surface-document font-sans font-bold text-(--litt-tinta) shadow-elev-document ${className}`}
        >
            {label}
        </span>
    );
}

/**
 * The hero's example: the assistant at work in a project. It reads two
 * documents, uses a workflow, drafts a letter and answers with three
 * citations; the source of the citation you point at is the panel beside it.
 * Fictitious data, fixed text, no request (SPEC v2 §3.3). Hovering (a fine
 * pointer only), focusing or tapping a citation shows its source; the active
 * one is `aria-pressed`. Without JavaScript the first source is already there.
 */
export function AssistantSpecimen() {
    const t = useTranslations();
    const [active, setActive] = useState<Source>(1);
    // Bumped by a person's choice, so the first paint does not fade.
    const [swaps, setSwaps] = useState(0);
    // How many of the six items the intro has brought in; null: not playing, all there.
    const [shown, setShown] = useState<number | null>(null);
    const started = useRef(false);

    useEffect(() => {
        // Once per browser session; the ref also covers React's double effect in dev.
        if (started.current) return;
        started.current = true;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        try {
            if (window.sessionStorage.getItem(INTRO_SESSION_KEY)) return;
            window.sessionStorage.setItem(INTRO_SESSION_KEY, "1");
        } catch {
            return; // storage blocked: show the finished page, never loop
        }
        // The one motion of the page starts after mount, from the session flag.
        setShown(0);
        for (let i = 1; i <= INTRO_ITEMS; i += 1) {
            window.setTimeout(() => setShown(i), INTRO_START_MS + (i - 1) * INTRO_STEP_MS);
        }
        window.setTimeout(() => setShown(null), INTRO_START_MS + INTRO_ITEMS * INTRO_STEP_MS + 300);
    }, []);

    /** Props of the n-th item that comes in (0-based): hidden until its turn. */
    function intro(n: number) {
        if (shown === null) return {};
        return { "data-intro": n < shown ? "in" : "out" };
    }

    function show(source: Source) {
        if (source === active) return;
        setActive(source);
        setSwaps((n) => n + 1);
    }

    function pill(source: Source) {
        return (
            <CitationPillUI
                active={active === source}
                aria-controls="landing-source"
                aria-label={t("landing.specimen.cite", { n: source })}
                className={`${PILL_CLASS} ${active === source ? PILL_ACTIVE_CLASS : ""}`}
                onClick={() => show(source)}
                onFocus={() => show(source)}
                onPointerEnter={(event) => {
                    // Only a mouse hovers; a finger taps (the click above).
                    if (event.pointerType === "mouse") show(source);
                }}
            >
                {source}
            </CitationPillUI>
        );
    }

    const page = PAGES[active];
    const where =
        active === 1
            ? t("landing.specimen.src1.where")
            : active === 2
              ? t("landing.specimen.src2.where")
              : t("landing.specimen.src3.where");
    const mark = (chunks: React.ReactNode) => <mark className={MARK}>{chunks}</mark>;
    const quote =
        active === 1
            ? t.rich("landing.specimen.src1.quote", { mark })
            : active === 2
              ? t.rich("landing.specimen.src2.quote", { mark })
              : t.rich("landing.specimen.src3.quote", { mark });
    const name = (chunks: React.ReactNode) => (
        <b className="font-medium text-foreground">{chunks}</b>
    );

    const steps = [
        { icon: FileText, text: t.rich("landing.specimen.step1", { name }) },
        { icon: FileText, text: t.rich("landing.specimen.step2", { name }) },
        { icon: Workflow, text: t.rich("landing.specimen.step3", { name }) },
        { icon: PenLine, text: t.rich("landing.specimen.step4", { name }) },
    ];

    return (
        <figure aria-labelledby="landing-specimen-caption" className="m-0">
            <div className="rounded-[20px] bg-surface-sheet p-2 font-sans shadow-elev-float">
                <div
                    aria-hidden="true"
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 pt-2 pb-3 text-xs/[1.3] font-medium text-muted-foreground"
                >
                    <span>
                        {t("landing.specimen.crumbRoot")} › <b className="font-semibold text-foreground">{t("landing.specimen.crumbProject")}</b>
                        {" · "}
                        {t("landing.specimen.crumbDocs")}
                    </span>
                    <span className="flex gap-3.5">
                        <span className="pb-0.5 text-foreground shadow-[0_1.5px_0_0_var(--foreground)]">
                            {t("landing.specimen.tabChat")}
                        </span>
                        <span>{t("landing.specimen.tabDocs")}</span>
                        <span>{t("landing.specimen.tabTables")}</span>
                    </span>
                </div>
                <div className="grid gap-2 min-[960px]:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                    <div className="flex min-w-0 flex-col rounded-xl bg-surface-desk p-[clamp(16px,3vw,28px)] min-[960px]:row-span-2">
                        <p className="ml-auto w-fit max-w-[88%] rounded-[14px_14px_4px_14px] bg-interactive-soft-strong px-3.5 py-2.5 text-sm/[1.45] text-foreground">
                            {t("landing.specimen.question")}
                        </p>
                        <div className="mt-[18px] text-[13px]/[1.4] text-muted-foreground">
                            <p
                                {...intro(0)}
                                className="landing-intro-item mb-1.5 flex items-center gap-2 text-xs/[1.3] font-medium text-foreground"
                            >
                                <CircleCheck aria-hidden="true" className="size-3.5" strokeWidth={1.5} />
                                {t("landing.specimen.stepsHead")}
                            </p>
                            <ol className="grid gap-0.5">
                                {steps.map(({ icon: Icon, text }, index) => (
                                    <li
                                        key={index}
                                        {...intro(index)}
                                        className="landing-intro-item grid grid-cols-[14px_1fr] items-start gap-2 py-[3px]"
                                    >
                                        <Icon aria-hidden="true" className="mt-0.5 size-3.5" strokeWidth={1.5} />
                                        <span>{text}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                        <p
                            {...intro(4)}
                            className="landing-intro-item landing-pretty mt-[18px] font-serif text-[1.0625rem]/[1.6] text-foreground"
                        >
                            {t("landing.specimen.answer1")}
                            {pill(1)}
                            {". "}
                            {t("landing.specimen.answer2")}
                            {pill(2)}{" "}
                            {t("landing.specimen.answer3")}
                            {pill(3)}
                            {". "}
                            {t("landing.specimen.answer4")}
                        </p>
                        <div
                            {...intro(5)}
                            className="landing-intro-item mt-4 flex items-center gap-3 rounded-xl bg-surface-sheet px-3 py-2.5 text-[13px]/[1.35] shadow-elev-sheet"
                        >
                            <FileGlyph label="DOCX" className="h-[38px] w-8 text-[8px]/none tracking-[0.04em]" />
                            <span className="min-w-0">
                                <span className="block font-medium text-foreground">{t("landing.specimen.docName")}</span>
                                <span className="block text-muted-foreground">{t("landing.specimen.docMeta")}</span>
                            </span>
                            <span
                                aria-hidden="true"
                                className="ml-auto rounded-full px-2.5 py-1.5 font-medium whitespace-nowrap text-foreground ring-1 ring-inset ring-interactive-border"
                            >
                                {t("landing.specimen.openWord")}
                            </span>
                        </div>
                    </div>
                    <div
                        id="landing-source"
                        aria-live="polite"
                        className="min-w-0 self-stretch rounded-xl bg-surface-desk p-[clamp(16px,2.4vw,22px)] min-[960px]:col-start-2 min-[960px]:row-start-1"
                    >
                        <p className="mb-2.5 text-xs/[1.3] font-medium text-muted-foreground">
                            {t("landing.specimen.sourceLabel")}
                        </p>
                        <div className="rounded-xl bg-surface-sheet px-4 py-3.5 shadow-elev-sheet">
                            <div
                                key={swaps}
                                className={swaps > 0 ? "landing-swap" : undefined}
                            >
                                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs/[1.4] font-medium text-muted-foreground">
                                    <span className="font-semibold text-foreground tabular-nums">
                                        {t("landing.specimen.page", { page })}
                                    </span>
                                    <span>{where}</span>
                                </div>
                                <blockquote
                                    lang="es"
                                    className="landing-pretty mt-2 font-serif text-[15px]/[1.5] text-foreground"
                                >
                                    {quote}
                                </blockquote>
                            </div>
                            <p className="mt-3 flex min-h-8 items-center gap-2 border-t border-foreground/14 pt-2.5 text-[13px]/[1.4] font-medium text-foreground">
                                <CircleCheck aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={1.5} />
                                <span>{t("landing.specimen.verified", { page })}</span>
                            </p>
                        </div>
                    </div>
                    {/* Drawn for the look of the product, with the app's own pieces (the model menu, its reasoning ladder and the key chip) in a still picture. After the source in the DOM, so a phone keeps the source next to the citation you tap; on a desktop it sits under the source, beside the chat. */}
                    <div
                        aria-hidden="true"
                        inert
                        data-landing-composer=""
                        className="flex min-w-0 flex-col justify-end rounded-xl bg-surface-desk p-[clamp(16px,2.4vw,22px)] min-[960px]:col-start-2 min-[960px]:row-start-2"
                    >
                        <ModelMenuPreviewUI
                            models={PICKER_MODELS}
                            value={PICKER_SELECTED_ID}
                            expandedGroup={PICKER_CHOSEN?.group ?? null}
                            reasoningLevel={PICKER_LEVEL}
                            reasoningLevels={PICKER_LEVELS}
                            className="ml-auto max-w-full"
                        />
                        <div className="mt-2 rounded-2xl bg-surface-sheet py-2 pr-2 pl-3.5 text-sm/[1.3] text-muted-foreground shadow-elev-sheet">
                            <p className="min-h-6 py-1">{t("landing.specimen.composer")}</p>
                            <div className="flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
                                <ModelChipPreviewUI
                                    label={pickerLabel}
                                    reasoningLevel={PICKER_LEVEL}
                                    reasoningLevels={PICKER_LEVELS}
                                />
                                <KeyChipUI preview label={t("assistant.chatCredentialPicker.organizationKey")} />
                                <span className="grid size-[34px] shrink-0 place-items-center rounded-full bg-interactive text-interactive-foreground">
                                    <ArrowUp className="size-4" strokeWidth={1.6} />
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <figcaption
                id="landing-specimen-caption"
                className="mt-3 text-end text-[0.9375rem] text-muted-foreground"
            >
                {t("landing.hero.caption")}
            </figcaption>
        </figure>
    );
}
