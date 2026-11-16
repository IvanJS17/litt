"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { CitationPillUI } from "@mike/ui";
import { LANDING_FOCUS } from "./landingStyles";

/** The verification plays once per browser session (SPEC §9). */
export const VERIFY_SESSION_KEY = "litt:landing-intro";
const CHECKING_MS = 900;

type Source = 1 | 2;
const PAGES: Record<Source, number> = { 1: 7, 2: 9 };

/**
 * The citation pill of the app (`CitationPillUI`) at the size the page draws it:
 * 22 × 20 px to the eye, 44 px tall to the finger (the pseudo-element).
 */
const PILL_CLASS = `relative mx-0.5 inline-grid h-5 w-auto min-w-[22px] place-items-center px-[5px] align-[0.12em] font-sans text-[11px] font-semibold leading-none tabular-nums bg-interactive-soft-strong text-foreground hover:bg-interactive-soft-strong hover:text-foreground before:absolute before:-inset-x-1.5 before:-inset-y-3 before:content-[''] ${LANDING_FOCUS}`;

/** The active citation is filled (tinta / papel), as `aria-pressed` says. */
const PILL_ACTIVE_CLASS =
    "!bg-interactive !text-interactive-foreground hover:!bg-interactive-hover hover:!text-interactive-foreground dark:!bg-interactive dark:!text-interactive-foreground dark:hover:!bg-interactive-hover dark:hover:!text-interactive-foreground";

function Tick({ drawn }: { drawn: boolean }) {
    return (
        <svg
            viewBox="0 0 18 18"
            aria-hidden="true"
            focusable="false"
            className={`landing-tick size-[18px] shrink-0 ${drawn ? "landing-tick-draw" : ""}`}
        >
            <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeOpacity="0.35" />
            <path
                d="M5.2 9.3l2.5 2.4 5-5.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Spinner() {
    return (
        <svg
            viewBox="0 0 18 18"
            aria-hidden="true"
            focusable="false"
            className="landing-spinner size-[18px] shrink-0"
        >
            <circle
                cx="9"
                cy="9"
                r="7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeDasharray="30 14"
                strokeLinecap="round"
            />
        </svg>
    );
}

/**
 * The hero's example: an answer of the assistant with its two citations and the
 * source panel they open. Fictitious data, fixed text, no request (SPEC §5.1).
 * Hovering (a fine pointer only), focusing or tapping a citation shows its
 * source; the active one is `aria-pressed`. Without JavaScript the first source
 * is already there.
 */
export function CitationSpecimen() {
    const t = useTranslations();
    const [active, setActive] = useState<Source>(1);
    // Bumped by a person's choice, so the first paint does not fade.
    const [swaps, setSwaps] = useState(0);
    // "done": the tick is there (the server's version, reduced motion, a repeat
    // visit). "checking": the spinner. "drawn": the tick draws itself.
    const [phase, setPhase] = useState<"done" | "checking" | "drawn">("done");
    const started = useRef(false);

    useEffect(() => {
        // Once per browser session; the ref also covers React's double effect in dev.
        if (started.current) return;
        started.current = true;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
        try {
            if (window.sessionStorage.getItem(VERIFY_SESSION_KEY)) return;
            window.sessionStorage.setItem(VERIFY_SESSION_KEY, "1");
        } catch {
            return; // storage blocked: show the finished state, never loop
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the one animation of the page starts after mount, from the session flag
        setPhase("checking");
        window.setTimeout(() => setPhase("drawn"), CHECKING_MS);
    }, []);

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
    const clause =
        active === 1 ? t("landing.specimen.src1.clause") : t("landing.specimen.src2.clause");
    const quote = (
        active === 1
            ? t.rich("landing.specimen.src1.quote", {
                  mark: (chunks) => <mark className="rounded-[3px] bg-interactive-soft-strong px-0.5 text-inherit">{chunks}</mark>,
              })
            : t.rich("landing.specimen.src2.quote", {
                  mark: (chunks) => <mark className="rounded-[3px] bg-interactive-soft-strong px-0.5 text-inherit">{chunks}</mark>,
              })
    );

    return (
        <figure aria-labelledby="landing-specimen-caption" className="m-0">
            <div className="rounded-[20px] bg-surface-sheet p-2 font-sans shadow-elev-float">
                <div className="rounded-xl bg-surface-desk p-[clamp(16px,3vw,24px)]">
                    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface-sheet py-1.5 pr-3 pl-2 text-xs/[1.3] font-medium text-muted-foreground shadow-elev-sheet">
                        <FileText aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.5} />
                        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                            {t("landing.specimen.doc")}
                        </span>
                    </span>
                    <p className="mt-4 ml-auto w-fit max-w-[88%] rounded-[14px_14px_4px_14px] bg-interactive-soft-strong px-3.5 py-2.5 text-sm/[1.45] text-foreground">
                        {t("landing.specimen.question")}
                    </p>
                    <p className="landing-pretty mt-[18px] font-serif text-[1.0625rem]/[1.6] text-foreground">
                        {t("landing.specimen.answer1")}
                        {pill(1)}
                        {". "}
                        {t("landing.specimen.answer2")}
                        {pill(2)}
                        {"."}
                    </p>
                    <div
                        id="landing-source"
                        aria-live="polite"
                        className="mt-[18px] rounded-xl bg-surface-sheet px-4 py-3.5 shadow-elev-sheet"
                    >
                        <div
                            key={swaps}
                            className={swaps > 0 ? "landing-swap" : undefined}
                        >
                            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs/[1.4] font-medium text-muted-foreground">
                                <span className="font-semibold text-foreground tabular-nums">
                                    {t("landing.specimen.page", { page })}
                                </span>
                                <span>
                                    {clause} · {t("landing.specimen.doc")}
                                </span>
                            </div>
                            <blockquote
                                lang="es"
                                className="landing-pretty mt-2 font-serif text-[15px]/[1.5] text-foreground"
                            >
                                {quote}
                            </blockquote>
                        </div>
                        <p
                            className={`mt-3 flex min-h-8 items-center gap-2 border-t border-foreground/14 pt-2.5 text-[13px]/[1.4] font-medium ${
                                phase === "checking" ? "text-muted-foreground" : "text-foreground"
                            }`}
                        >
                            {phase === "checking" ? <Spinner /> : <Tick drawn={phase === "drawn"} />}
                            <span>
                                {phase === "checking"
                                    ? t("landing.specimen.checking")
                                    : t("landing.specimen.verified", { page })}
                            </span>
                        </p>
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
