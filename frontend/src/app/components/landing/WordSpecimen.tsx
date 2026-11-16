"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LANDING_FOCUS } from "./landingStyles";

/**
 * The Word add-in's example: a clause of a lease with one suggested change and
 * the comment LiTT leaves on it. The page is the one white surface
 * (`--surface-document`, it stays white in the dark theme), so its ink is
 * tinta in both themes. The change is a button (`aria-expanded`) that shows or
 * hides the comment.
 */
export function WordSpecimen() {
    const t = useTranslations();
    const [open, setOpen] = useState(true);
    return (
        <div className="grid gap-3">
            <div className="rounded-md bg-surface-document p-[22px_22px_26px] font-serif text-[15px]/[1.6] text-(--litt-tinta) shadow-elev-document">
                <p>
                    <span className="font-semibold">{t("landing.word.clause0")}</span>{" "}
                    <span>{t("landing.word.text0")}</span>
                </p>
                <p className="mt-[0.8em]">
                    <span className="font-semibold">{t("landing.word.clause1")}</span>{" "}
                    <span>{t("landing.word.text1a")}</span>{" "}
                    <button
                        type="button"
                        aria-expanded={open}
                        aria-controls="landing-word-comment"
                        onClick={() => setOpen((value) => !value)}
                        className={`rounded-[3px] bg-transparent p-0 text-inherit aria-expanded:bg-[color-mix(in_srgb,var(--litt-tinta)_8%,transparent)] ${LANDING_FOCUS}`}
                    >
                        <del className="text-(--color-gray-500) decoration-1">
                            {t("landing.word.old")}
                        </del>{" "}
                        <ins className="underline [text-decoration-style:double] underline-offset-[0.2em]">
                            {t("landing.word.new")}
                        </ins>
                        <span className="sr-only"> {t("landing.word.change")}</span>
                    </button>{" "}
                    <span>{t("landing.word.text1b")}</span>
                </p>
            </div>
            <div
                id="landing-word-comment"
                hidden={!open}
                className="rounded-xl bg-surface-sheet px-3.5 py-3 font-sans text-[13px]/[1.45] text-foreground shadow-elev-sheet"
            >
                <div className="mb-1 flex items-center gap-1.5 font-medium text-muted-foreground">
                    <span className="font-semibold text-foreground">LiTT</span>
                    <span aria-hidden="true">·</span>
                    <span>{t("landing.word.who")}</span>
                </div>
                <span>{t("landing.word.comment")}</span>
            </div>
        </div>
    );
}
