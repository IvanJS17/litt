"use client";

import * as React from "react";
import { ClipboardCheck, Loader2, Waypoints, X } from "lucide-react";
import { useTranslations } from "use-intl";
import { TOUCH_TARGET_CLASS } from "./touchTargetUI.styles";

/**
 * The labels of what travels with a message (owner decision, 2026-11-13,
 * option "C"). What is switched on, a workflow or a playbook, is a pill with
 * a firm outline (3.87:1 in light, 4.46:1 in dark) and its type written in a
 * segment of its own, "Flujo" or "Playbook". What is attached, documents and
 * quoted passages, is the soft sheet with the icon of its file type. Nothing
 * is filled and nothing is amber: the send button stays the only filled thing
 * in the composer. Activated comes first, then attached, with a short rule
 * between the two when they share a line.
 *
 * For a screen reader the row is two named lists, "Active" and "Attached
 * documents". A workflow's or a playbook's × reads "Deactivate …" and a
 * document's reads "Remove …". Switching one on or off is announced in a
 * polite live region, and a summary line ("Active: 1 workflow, 1 playbook ·
 * Attached: 2 documents") is for the screen reader only. The colors are the
 * `--litt-composer-*` tokens in `DesignTokensUI.css`.
 */

/** The soft sheet of an attached document, quote or upload. */
export const COMPOSER_DOC_CHIP_CLASS =
    "inline-flex h-6 min-w-0 max-w-full items-center gap-[5px] rounded-[7px] bg-[var(--litt-composer-chip)] pl-2 text-xs text-gray-900 shadow-[inset_0_0_0_1px_var(--litt-composer-chip-ring)] pointer-coarse:h-8 pointer-coarse:text-[0.8125rem]";

/** The × of a label: 16 px, 4 px corners, a 44 px zone to touch. */
export const COMPOSER_CHIP_REMOVE_CLASS =
    "inline-grid size-4 shrink-0 cursor-pointer place-items-center rounded-[4px] text-gray-500 transition-colors enabled:hover:bg-interactive-soft enabled:hover:text-gray-900 disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-7";

/** The × of a label, with its touch zone. */
export const COMPOSER_CHIP_REMOVE_FULL_CLASS = `${TOUCH_TARGET_CLASS} ${COMPOSER_CHIP_REMOVE_CLASS}`;

/**
 * Something attached to a message, such as a document, a quoted passage or an
 * upload in progress: the soft sheet with its type's icon. The caller words
 * the labels, so each host keeps its own translations.
 */
export function AttachmentChipUI({
    name,
    icon,
    status,
    tone = "default",
    loading = false,
    onOpen,
    openLabel,
    onRemove,
    removeLabel,
    removeDisabled = false,
}: {
    name: string;
    icon: React.ReactNode;
    /** Read after the name by assistive technology, such as "Started". */
    status?: string;
    tone?: "default" | "error";
    /** Uploading: the icon fades and a spinner takes the × 's place. */
    loading?: boolean;
    onOpen?: () => void;
    openLabel?: string;
    onRemove?: () => void;
    removeLabel?: string;
    removeDisabled?: boolean;
}): React.ReactElement {
    const body = (
        <>
            <span
                aria-hidden="true"
                className={`inline-flex shrink-0 items-center text-gray-500 [&>*]:size-[11px] ${loading ? "opacity-40" : ""}`}
            >
                {icon}
            </span>
            <span className="min-w-0 max-w-[180px] truncate pointer-coarse:max-w-[12em]">
                {name}
            </span>
            {status && <span className="sr-only">, {status}</span>}
        </>
    );
    return (
        <span
            title={status ? `${name} · ${status}` : name}
            data-chip="attachment"
            className={`${COMPOSER_DOC_CHIP_CLASS} ${tone === "error" ? "text-red-600" : ""} ${!onRemove && !loading ? "pr-2" : ""}`}
        >
            {onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    aria-label={openLabel}
                    className="inline-flex min-w-0 cursor-pointer items-center gap-[5px] rounded-[5px] transition-colors hover:text-gray-950"
                >
                    {body}
                </button>
            ) : (
                <span className="inline-flex min-w-0 items-center gap-[5px]">{body}</span>
            )}
            {loading ? (
                // The × 's box, so the label keeps its size when it finishes.
                <span
                    aria-hidden="true"
                    className="mr-1 grid size-4 shrink-0 place-items-center text-gray-500 pointer-coarse:size-7"
                >
                    <Loader2 className="size-2.5 animate-spin motion-reduce:animate-none" />
                </span>
            ) : (
                onRemove && (
                    <button
                        type="button"
                        onClick={onRemove}
                        disabled={removeDisabled}
                        aria-label={removeLabel}
                        className={`mr-1 ${COMPOSER_CHIP_REMOVE_FULL_CLASS}`}
                    >
                        <X aria-hidden="true" className="size-2.5" />
                    </button>
                )
            )}
        </span>
    );
}

type ActiveKind = "workflow" | "playbook";

export interface ActiveChipProps {
    kind: ActiveKind;
    title: string;
    /** Makes the name a button (the composer reopens its picker). */
    onOpen?: () => void;
    /**
     * Renders the opening control yourself, such as a router link; it must
     * return one element that wraps `children` and wears `className`.
     */
    renderOpen?: (props: {
        children: React.ReactNode;
        className: string;
        ariaLabel: string;
    }) => React.ReactElement;
    /** The ×; leave it out for a message that was sent. */
    onDeactivate?: () => void;
}

const ACTIVE_CHIP_CLASS =
    "inline-flex h-6 min-w-0 max-w-full items-center rounded-full text-xs text-gray-900 shadow-[inset_0_0_0_1px_var(--litt-composer-active-ring)] pointer-coarse:h-8 pointer-coarse:text-[0.8125rem]";
const ACTIVE_BODY_CLASS =
    "inline-flex min-w-0 items-center self-stretch rounded-full";
const ACTIVE_BODY_BUTTON_CLASS = `${ACTIVE_BODY_CLASS} cursor-pointer transition-opacity hover:opacity-80`;
const ACTIVE_KEY_CLASS =
    "my-px ml-px inline-flex shrink-0 items-center gap-1 self-stretch rounded-l-full rounded-r-none bg-[var(--litt-composer-active-key)] px-[7px] font-semibold";
const ACTIVE_NAME_CLASS =
    "min-w-0 max-w-[180px] truncate pl-[7px] pr-0.5 pointer-coarse:max-w-[9.5em]";

/**
 * A workflow or a playbook that is switched on for the next message: an
 * outlined pill with its type in a segment of its own. The type is never
 * cut; the name is, when the line is short.
 */
export function ActiveChipUI({
    kind,
    title,
    onOpen,
    renderOpen,
    onDeactivate,
}: ActiveChipProps): React.ReactElement {
    const t = useTranslations();
    const Icon = kind === "workflow" ? Waypoints : ClipboardCheck;
    const typeLabel =
        kind === "workflow"
            ? t("ui.composerChips.workflowType")
            : t("ui.composerChips.playbookType");
    const openLabel =
        kind === "workflow"
            ? t("ui.composerChips.openWorkflow", { title })
            : t("ui.composerChips.openPlaybook", { title });
    const deactivateLabel =
        kind === "workflow"
            ? t("ui.composerChips.deactivateWorkflow", { title })
            : t("ui.composerChips.deactivatePlaybook", { title });
    const body = (
        <>
            <span className={ACTIVE_KEY_CLASS} aria-hidden="true">
                <Icon className="size-[11px] shrink-0 text-gray-500" />
                {typeLabel}
            </span>
            <span
                className={`${ACTIVE_NAME_CLASS} ${onDeactivate ? "" : "pr-2.5"}`}
                aria-hidden="true"
            >
                {title}
            </span>
        </>
    );
    return (
        <span
            className={ACTIVE_CHIP_CLASS}
            data-chip={kind}
            title={`${typeLabel}: ${title}`}
        >
            {renderOpen ? (
                renderOpen({
                    children: body,
                    className: ACTIVE_BODY_BUTTON_CLASS,
                    ariaLabel: openLabel,
                })
            ) : onOpen ? (
                <button
                    type="button"
                    onClick={onOpen}
                    aria-label={openLabel}
                    className={ACTIVE_BODY_BUTTON_CLASS}
                >
                    {body}
                </button>
            ) : (
                // Not openable: the label still names its type for a reader.
                <span
                    role="img"
                    aria-label={`${typeLabel}: ${title}`}
                    className={ACTIVE_BODY_CLASS}
                >
                    {body}
                </span>
            )}
            {onDeactivate && (
                <button
                    type="button"
                    onClick={onDeactivate}
                    aria-label={deactivateLabel}
                    className={`mr-1 ${COMPOSER_CHIP_REMOVE_FULL_CLASS}`}
                >
                    <X aria-hidden="true" className="size-2.5" />
                </button>
            )}
        </span>
    );
}

interface ActiveItem {
    title: string;
    onOpen?: () => void;
    renderOpen?: ActiveChipProps["renderOpen"];
    onDeactivate?: () => void;
}

/**
 * The announcement of switching a workflow or a playbook on or off. It speaks
 * only for a change after the first render, never for what was already there.
 */
function useActivationAnnouncement(
    workflow: string | null,
    playbook: string | null,
): string {
    const t = useTranslations();
    const [seen, setSeen] = React.useState({ workflow, playbook });
    const [message, setMessage] = React.useState("");
    if (seen.workflow !== workflow || seen.playbook !== playbook) {
        const parts: string[] = [];
        if (seen.workflow !== workflow) {
            parts.push(
                workflow
                    ? t("ui.composerChips.workflowActivated", { title: workflow })
                    : t("ui.composerChips.workflowDeactivated", {
                          title: seen.workflow ?? "",
                      }),
            );
        }
        if (seen.playbook !== playbook) {
            parts.push(
                playbook
                    ? t("ui.composerChips.playbookActivated", { title: playbook })
                    : t("ui.composerChips.playbookDeactivated", {
                          title: seen.playbook ?? "",
                      }),
            );
        }
        setSeen({ workflow, playbook });
        setMessage(parts.join(". "));
    }
    // A stale announcement is not left in the page for a later reader.
    React.useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => setMessage(""), 4000);
        return () => clearTimeout(timer);
    }, [message]);
    return message;
}

/**
 * The labels row of a composer or of a sent message. `attached` holds the
 * ready-made pills of documents, uploads and quoted passages, one per item.
 * A sent message passes no `onDeactivate` and no `announce`: no × and no live
 * region.
 */
export function ComposerChipsUI({
    workflow,
    playbook,
    attached = [],
    className,
    justify = "start",
    announce = false,
}: {
    workflow?: ActiveItem | null;
    playbook?: ActiveItem | null;
    attached?: readonly { key: string; node: React.ReactNode }[];
    className?: string;
    justify?: "start" | "end";
    /**
     * A composer: switching a workflow or a playbook on or off is announced
     * in a polite live region, which stays in the page even with no label.
     */
    announce?: boolean;
}): React.ReactElement | null {
    const t = useTranslations();
    const rowRef = React.useRef<HTMLDivElement>(null);
    const [sameLine, setSameLine] = React.useState(false);
    const announcement = useActivationAnnouncement(
        workflow?.title ?? null,
        playbook?.title ?? null,
    );
    const hasActive = !!workflow || !!playbook;
    const hasAttached = attached.length > 0;

    // The short rule between the two lists only when they share a line.
    React.useLayoutEffect(() => {
        const row = rowRef.current;
        if (!row) return;
        const measure = (): void => {
            const active = row.querySelector<HTMLElement>("[data-chips-active]");
            const docs = row.querySelector<HTMLElement>("[data-chips-attached]");
            if (!active || !docs) {
                setSameLine(false);
                return;
            }
            setSameLine(
                Math.abs(
                    active.getBoundingClientRect().top -
                        docs.getBoundingClientRect().top,
                ) < 4,
            );
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(row);
        return () => observer.disconnect();
    });

    // The live region is the same node whether the row is empty or not: a
    // region that mounts already holding its text is not announced reliably,
    // so it must outlive the first label switched on and the last switched off.
    const liveRegion = announce ? (
        <ActivationLiveRegion message={announcement} />
    ) : null;

    // Same shape (a fragment of row-or-nothing, then the region) both ways.
    if (!hasActive && !hasAttached) return <>{null}{liveRegion}</>;

    const activeParts: string[] = [];
    if (workflow) {
        activeParts.push(t("ui.composerChips.summaryWorkflows", { count: 1 }));
    }
    if (playbook) {
        activeParts.push(t("ui.composerChips.summaryPlaybooks", { count: 1 }));
    }
    const summary = [
        activeParts.length
            ? t("ui.composerChips.summaryActive", { items: activeParts.join(", ") })
            : "",
        hasAttached
            ? t("ui.composerChips.summaryAttached", { count: attached.length })
            : "",
    ]
        .filter(Boolean)
        .join(" · ");

    return (
        <>
            <div
                ref={rowRef}
                data-composer-chips=""
                className={`flex flex-wrap items-center gap-x-2.5 gap-y-1.5 ${justify === "end" ? "justify-end" : ""} ${className ?? ""}`}
            >
                <span className="sr-only">{summary}</span>
                {hasActive && (
                    <ul
                        data-chips-active=""
                        aria-label={t("ui.composerChips.activeList")}
                        className="m-0 flex min-w-0 max-w-full list-none flex-wrap items-center gap-1.5 p-0"
                    >
                        {workflow && (
                            <li className="m-0 flex min-w-0 max-w-full">
                                <ActiveChipUI kind="workflow" {...workflow} title={workflow.title} />
                            </li>
                        )}
                        {playbook && (
                            <li className="m-0 flex min-w-0 max-w-full">
                                <ActiveChipUI kind="playbook" {...playbook} title={playbook.title} />
                            </li>
                        )}
                    </ul>
                )}
                {hasAttached && (
                    <ul
                        data-chips-attached=""
                        data-same-line={hasActive && sameLine ? "true" : undefined}
                        aria-label={t("ui.composerChips.attachedList")}
                        // The rule sits in the gap between the lists, out of the
                        // flow: it must not change where the lists wrap, or the
                        // measure below would flip with it.
                        className={`relative m-0 flex min-w-0 max-w-full list-none flex-wrap items-center gap-1.5 p-0 ${
                            hasActive && sameLine
                                ? "before:absolute before:-left-[6px] before:top-1/2 before:-mt-2 before:h-4 before:w-px before:bg-[var(--litt-composer-chip-ring)] before:content-['']"
                                : ""
                        }`}
                    >
                        {attached.map((item) => (
                            <li key={item.key} className="m-0 flex min-w-0 max-w-full">
                                {item.node}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        {liveRegion}
        </>
    );
}

function ActivationLiveRegion({ message }: { message: string }): React.ReactElement {
    return (
        <div aria-live="polite" aria-atomic="true" data-composer-live="" className="sr-only">
            {message}
        </div>
    );
}
