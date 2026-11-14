"use client";

import { Fragment, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/app/lib/utils";
import type { DiffLine, DiffSegment, TextChange } from "@/app/lib/textDiff";
import type { CompareBlock } from "@/app/lib/versionCompare";

export type DiffViewMode = "side-by-side" | "unified";

const HAS_DIGIT = /[0-9]/;

/** The tint of a whole removed or added line. */
const REMOVED_ROW = "bg-red-50 dark:bg-red-950/30";
const ADDED_ROW = "bg-emerald-50 dark:bg-emerald-950/30";

function Text({ segments }: { segments: DiffSegment[] }) {
    const t = useTranslations("versionCompare");
    return (
        <>
            {segments.map((segment, index) => {
                if (segment.type === "equal")
                    return <span key={index}>{segment.text}</span>;
                // Changed words are marked by tag and by words for screen
                // readers as well as by colour; digits are stressed too.
                const numeric = HAS_DIGIT.test(segment.text);
                const className = cn(
                    "rounded-sm px-0.5",
                    segment.type === "removed"
                        ? "bg-red-200 text-red-900 line-through decoration-red-500 dark:bg-red-900/60 dark:text-red-100"
                        : "bg-emerald-200 text-emerald-900 no-underline dark:bg-emerald-900/60 dark:text-emerald-100",
                    numeric && "font-semibold underline decoration-dotted decoration-2 underline-offset-2",
                );
                const label = (
                    <span className="sr-only">
                        {segment.type === "removed" ? t("removed") : t("added")}:{" "}
                    </span>
                );
                return segment.type === "removed" ? (
                    <del
                        key={index}
                        className={className}
                        data-numeric={numeric || undefined}
                    >
                        {label}
                        {segment.text}
                    </del>
                ) : (
                    <ins
                        key={index}
                        className={className}
                        data-numeric={numeric || undefined}
                    >
                        {label}
                        {segment.text}
                    </ins>
                );
            })}
        </>
    );
}

const CODE = "whitespace-pre-wrap break-words font-mono text-xs leading-5 align-top";
const NUMBER =
    "w-10 select-none px-2 text-right align-top font-mono text-2xs leading-5 text-gray-400";

function Cell({
    line,
    side,
}: {
    line: DiffLine | undefined;
    side: "removed" | "added";
}) {
    return (
        <td
            className={cn(
                CODE,
                "px-2",
                line && (side === "removed" ? REMOVED_ROW : ADDED_ROW),
            )}
        >
            {line && <Text segments={line.segments} />}
        </td>
    );
}

function ChangeHeader({
    change,
    position,
    total,
    columns,
}: {
    change: TextChange;
    position: number;
    total: number;
    columns: number;
}) {
    const t = useTranslations("versionCompare");
    return (
        <tr>
            <th
                colSpan={columns}
                scope="colgroup"
                className="px-2 pb-0.5 pt-2 text-left text-2xs font-normal text-gray-500"
            >
                {t("changeOf", { current: position, total })}
                {change.numeric && (
                    <span className="ml-2 font-medium text-gray-700">
                        {t("hasNumbers")}
                    </span>
                )}
            </th>
        </tr>
    );
}

export function VersionDiff({
    blocks,
    mode,
    positions,
    activeIndex,
    registerChange,
}: {
    blocks: CompareBlock[];
    mode: DiffViewMode;
    /** The shown changes, as global index -> "change N of M". */
    positions: ReadonlyMap<number, { position: number; total: number }>;
    activeIndex: number | null;
    registerChange: (index: number, element: HTMLElement | null) => void;
}) {
    const t = useTranslations("versionCompare");
    const sideBySide = mode === "side-by-side";
    const columns = sideBySide ? 4 : 3;
    const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
    // The button that opened a gap disappears; focus goes to the first line it revealed.
    const focusKey = useRef<string | null>(null);
    const focusIfFirst = (key: string) => (element: HTMLElement | null) => {
        if (element && focusKey.current === key) {
            focusKey.current = null;
            element.focus();
        }
    };
    const renderBlock = (block: CompareBlock): React.ReactNode => {
                if (block.kind === "gap") {
                    if (open.has(block.key))
                        return <Fragment key={block.key}>{block.hidden.map(renderBlock)}</Fragment>;
                    return (
                        <tbody key={block.key}>
                            <tr>
                                <td colSpan={columns} className="bg-surface-sheet">
                                    <button
                                        type="button"
                                        aria-expanded={false}
                                        onClick={() => {
                                            focusKey.current = block.hidden[0].key;
                                            setOpen((prev) => new Set(prev).add(block.key));
                                        }}
                                        className="w-full px-2 py-1 text-center text-2xs text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                    >
                                        {t(block.withChanges ? "showHiddenLinesWithChanges" : "showHiddenLines", {
                                            count: block.count,
                                        })}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    );
                }
                if (block.kind === "context") {
                    return (
                        <tbody
                            key={block.key}
                            ref={focusIfFirst(block.key)}
                            tabIndex={-1}
                            className="focus-visible:outline-none"
                        >
                            <tr>
                                <td className={NUMBER}>{block.oldNo}</td>
                                {sideBySide ? (
                                    <>
                                        <td className={cn(CODE, "px-2")}>{block.text}</td>
                                        <td className={NUMBER}>{block.newNo}</td>
                                        <td className={cn(CODE, "px-2")}>{block.text}</td>
                                    </>
                                ) : (
                                    <>
                                        <td className={NUMBER}>{block.newNo}</td>
                                        <td className={cn(CODE, "px-2")}>{block.text}</td>
                                    </>
                                )}
                            </tr>
                        </tbody>
                    );
                }
                const { change } = block;
                const place = positions.get(change.index);
                const rows = Math.max(change.removed.length, change.added.length);
                return (
                    <tbody
                        key={block.key}
                        ref={(element) => {
                            registerChange(change.index, element);
                            focusIfFirst(block.key)(element);
                        }}
                        tabIndex={-1}
                        data-change-index={change.index}
                        aria-current={activeIndex === change.index ? "true" : undefined}
                        className={cn(
                            "scroll-mt-2 focus-visible:outline-none",
                            activeIndex === change.index &&
                                "outline outline-2 -outline-offset-2 outline-foreground/60",
                        )}
                    >
                        {place && (
                            <ChangeHeader
                                change={change}
                                position={place.position}
                                total={place.total}
                                columns={columns}
                            />
                        )}
                        {sideBySide
                            ? Array.from({ length: rows }, (_, row) => {
                                  const removed = change.removed[row];
                                  const added = change.added[row];
                                  return (
                                      <tr key={row}>
                                          <td className={NUMBER}>{removed?.no}</td>
                                          <Cell line={removed} side="removed" />
                                          <td className={NUMBER}>{added?.no}</td>
                                          <Cell line={added} side="added" />
                                      </tr>
                                  );
                              })
                            : [
                                  ...change.removed.map((line) => (
                                      <tr key={`r${line.no}`}>
                                          <td className={NUMBER}>
                                              <span className="sr-only">
                                                  {t("lineNumberOld", { number: line.no })}
                                              </span>
                                              <span aria-hidden="true">{line.no}</span>
                                          </td>
                                          <td className={NUMBER} />
                                          <Cell line={line} side="removed" />
                                      </tr>
                                  )),
                                  ...change.added.map((line) => (
                                      <tr key={`a${line.no}`}>
                                          <td className={NUMBER} />
                                          <td className={NUMBER}>
                                              <span className="sr-only">
                                                  {t("lineNumberNew", { number: line.no })}
                                              </span>
                                              <span aria-hidden="true">{line.no}</span>
                                          </td>
                                          <Cell line={line} side="added" />
                                      </tr>
                                  )),
                              ]}
                    </tbody>
                );
    };
    return (
        <table className="w-full table-fixed border-collapse text-gray-900">
            <caption className="sr-only">
                {sideBySide ? t("sideBySide") : t("unified")}
            </caption>
            <colgroup>
                {sideBySide ? (
                    <>
                        <col className="w-10" />
                        <col />
                        <col className="w-10" />
                        <col />
                    </>
                ) : (
                    <>
                        <col className="w-10" />
                        <col className="w-10" />
                        <col />
                    </>
                )}
            </colgroup>
            {blocks.map((block) => renderBlock(block))}
        </table>
    );
}
