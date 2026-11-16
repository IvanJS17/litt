"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LANDING_FOCUS } from "./landingStyles";

type Index = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
type Row = 0 | 1 | 2 | 3;

/**
 * Four contracts × three questions. `page` is where the answer is quoted from;
 * a cell without one («No se pactó») has nothing to cite, so it is not a button.
 * `n` is the citation number shown in the cell. The texts are in the catalog (`landing.tab.v.N`, `landing.tab.q.N`).
 */
const ROWS: ReadonlyArray<{
    row: Row;
    cells: ReadonlyArray<{ index: Index; page: number | null; n: number | null }>;
}> = [
    { row: 0, cells: [{ index: 0, page: 3, n: 1 }, { index: 1, page: 7, n: 2 }, { index: 2, page: 11, n: 3 }] },
    { row: 1, cells: [{ index: 3, page: 2, n: 4 }, { index: 4, page: 6, n: 5 }, { index: 5, page: 10, n: 6 }] },
    { row: 2, cells: [{ index: 6, page: 4, n: 7 }, { index: 7, page: 8, n: 8 }, { index: 8, page: 12, n: 9 }] },
    { row: 3, cells: [{ index: 9, page: 2, n: 10 }, { index: 10, page: null, n: null }, { index: 11, page: 9, n: 11 }] },
];

/** The first data column, so a phone (which shows it without scrolling) starts on a real source. */
const FIRST_ACTIVE: Index = 6;

/**
 * The tabular review's example: the same questions asked of four contracts, one
 * answer per cell and, under the table, the source of the cell you point at.
 * Cells are buttons (`aria-pressed`): hover (mouse), focus or tap selects. On a
 * phone the table scrolls sideways inside its sheet, never the page.
 */
export function TabularSpecimen() {
    const t = useTranslations();
    const [active, setActive] = useState<Index>(FIRST_ACTIVE);

    const current = ROWS.flatMap(({ row, cells }) => cells.map((c) => ({ row, ...c }))).find(
        (c) => c.index === active,
    );

    const th = "whitespace-nowrap border-b border-foreground/14 px-3 py-2.5 text-start font-medium text-muted-foreground";

    return (
        <div>
            <div
                role="region"
                tabIndex={0}
                aria-label={t("landing.tab.region")}
                className={`overflow-x-auto overscroll-x-contain rounded-xl bg-surface-desk shadow-elev-sheet ${LANDING_FOCUS}`}
            >
                <table className="w-full min-w-[560px] border-collapse font-sans text-[13px]/[1.35]">
                    <thead>
                        <tr>
                            <th scope="col" className={th}>
                                {t("landing.tab.thDoc")}
                            </th>
                            <th scope="col" className={th}>
                                {t("landing.tab.thTerm")}
                            </th>
                            <th scope="col" className={th}>
                                {t("landing.tab.thInterest")}
                            </th>
                            <th scope="col" className={th}>
                                {t("landing.tab.thCourts")}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {ROWS.map(({ row, cells }) => (
                            <tr key={row} className="border-b border-foreground/14 last:border-b-0">
                                <td lang="es" className="whitespace-nowrap px-3 py-2.5 align-top text-foreground">
                                    {t(`landing.tab.doc.${row}`)}
                                </td>
                                {cells.map(({ index, n: cite }) => (
                                    <td key={index} className="p-0 align-top">
                                        {cite === null ? (
                                            <span className="flex min-h-11 w-full items-start px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                                {t(`landing.tab.v.${index}`)}
                                            </span>
                                        ) : (
                                            <button
                                                type="button"
                                                aria-pressed={active === index}
                                                aria-controls="landing-tab-source"
                                                aria-label={`${t("landing.specimen.cite", { n: cite })}: ${t(`landing.tab.v.${index}`)}`}
                                                onClick={() => setActive(index)}
                                                onFocus={() => setActive(index)}
                                                onPointerEnter={(event) => {
                                                    if (event.pointerType === "mouse") setActive(index);
                                                }}
                                                className={`flex min-h-11 w-full items-start gap-1.5 px-3 py-2.5 text-start whitespace-nowrap text-foreground transition-colors duration-150 aria-pressed:bg-interactive-soft-strong pointer-fine:hover:bg-interactive-soft pointer-fine:aria-pressed:hover:bg-interactive-soft-strong ${LANDING_FOCUS} focus-visible:-outline-offset-2`}
                                            >
                                                {/* The number is drawn by CSS, so the visible text is the answer
                                                    alone and the name (aria-label) contains it. */}
                                                <span
                                                    aria-hidden="true"
                                                    data-n={cite}
                                                    className={`mt-px grid h-4 min-w-[18px] place-items-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums before:content-[attr(data-n)] ${
                                                        active === index
                                                            ? "bg-interactive text-interactive-foreground"
                                                            : "bg-interactive-soft-strong"
                                                    }`}
                                                />
                                                <span>{t(`landing.tab.v.${index}`)}</span>
                                            </button>
                                        )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p
                id="landing-tab-source"
                aria-live="polite"
                className="mt-3 min-h-[3.2em] font-sans text-sm/[1.5] text-muted-foreground"
            >
                {current && current.page !== null ? (
                    <>
                        <strong className="font-medium text-foreground">
                            {t("landing.tab.source", {
                                doc: t(`landing.tab.doc.${current.row}`),
                                page: current.page,
                            })}
                        </strong>
                        <br />
                        <span lang="es" className="font-serif text-[15px] text-foreground">
                            {t(`landing.tab.q.${active as Exclude<Index, 10>}`)}
                        </span>
                    </>
                ) : null}
            </p>
        </div>
    );
}
