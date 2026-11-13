"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DocumentSplitCreateResult, DocumentSplitProposal, DocumentSplitState } from "@mike/contracts";
import { TABLE_CHECKBOX_CLASS } from "@/app/components/shared/TablePrimitive";
import { FORM_CONTROL_GLASS_CLASS } from "@/app/components/ui/form-field";
import {
    canCreate,
    createBody,
    groupsFromProposal,
    movePage,
    pageRanges,
    setGroupIncluded,
    setGroupName,
    setGroupType,
    splitGroupAt,
    type EditableSplitGroup,
} from "@/app/lib/documentSplit";
import { createSplitDocuments, getDocumentSplitState, proposeDocumentSplit } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { Modal } from "./Modal";
import { ModalTextInput } from "./ModalTextInput";

export interface SplitRequest {
    documentId: string;
    filename: string;
}

interface Props {
    /** The split being offered; null keeps the dialog closed. */
    request: SplitRequest | null;
    onClose: () => void;
    /** The new documents exist. The dialog does not close itself: the owner decides. */
    onCreated: (result: DocumentSplitCreateResult) => void;
}

/** Value of the "no type" option. A type name is data and could be anything, so it is told apart by position, not by text. */
const NO_TYPE = "";
const SELECT_CLASS = `h-9 ${FORM_CONTROL_GLASS_CLASS}`;

/** `0.159` → "0.16"; a price under a cent says so instead of reading as free. */
function dollars(value: number): string {
    return value > 0 && value < 0.01 ? "< 0.01" : value.toFixed(2);
}

/**
 * "Separar expediente" (docs/document-split.md): the notice and the estimated
 * cost first, then the proposal for the person to adjust, then the documents.
 * Text goes to LandingAI only when the person presses the first button, and
 * nothing is created until they press the second.
 */
export function SplitDocumentModal({ request, onClose, onCreated }: Props) {
    // Mounted only while a request is open, so each one starts from its own notice.
    return request ? <SplitDocumentDialog key={request.documentId} request={request} onClose={onClose} onCreated={onCreated} /> : null;
}

function SplitDocumentDialog({ request, onClose, onCreated }: Props & { request: SplitRequest }) {
    const t = useTranslations();
    const { documentId, filename } = request;
    const [state, setState] = useState<DocumentSplitState | null>(null);
    const [proposal, setProposal] = useState<DocumentSplitProposal | null>(null);
    const [groups, setGroups] = useState<EditableSplitGroup[]>([]);
    const [proposing, setProposing] = useState(false);
    const [creating, setCreating] = useState(false);
    const closed = useRef(false);
    const busy = proposing || creating;
    const fallbackName = t("documents.split.untitled");

    useEffect(() => {
        closed.current = false;
        const controller = new AbortController();
        // The dialog closes on failure, so there is nothing to retry in place: opening it again loads the notice again.
        getDocumentSplitState(documentId, controller.signal).then(
            (next) => {
                if (!controller.signal.aborted) setState(next);
            },
            (error) => {
                if (controller.signal.aborted) return;
                notifyError(error, { action: t("documents.split.actionEstimate") });
                onClose();
            },
        );
        return () => {
            closed.current = true;
            controller.abort();
        };
        // The notice belongs to this document only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId]);

    async function propose() {
        if (!state || busy) return;
        setProposing(true);
        try {
            const next = await proposeDocumentSplit(documentId);
            if (closed.current) return;
            setProposal(next);
            setGroups(groupsFromProposal(next.groups, fallbackName));
            setProposing(false);
        } catch (error) {
            if (closed.current) return;
            setProposing(false);
            notifyError(error, { action: t("documents.split.actionPropose"), onRetry: propose });
        }
    }

    async function create() {
        if (!proposal || busy || !canCreate(groups)) return;
        setCreating(true);
        try {
            const result = await createSplitDocuments(documentId, proposal.version_id, createBody(groups));
            if (!closed.current) onCreated(result);
        } catch (error) {
            if (closed.current) return;
            setCreating(false);
            notifyError(error, { action: t("documents.split.actionCreate"), onRetry: create });
        }
    }

    const ready = !!state && state.key_available && state.can_edit && !state.needs_scan_reading && !state.too_large;
    const chosen = groups.filter((g) => g.include).length;

    return (
        <Modal
            open
            onClose={() => {
                if (!busy) onClose();
            }}
            size="lg"
            className="h-auto"
            breadcrumbs={[t("documents.split.title")]}
            cancelAction={{ label: t("modals.cancel"), onClick: onClose, disabled: busy }}
            primaryAction={
                proposal
                    ? {
                          label: creating ? t("documents.split.creating") : t("documents.split.create", { count: chosen }),
                          onClick: () => void create(),
                          disabled: !canCreate(groups) || busy,
                      }
                    : {
                          label: proposing ? t("documents.split.proposing") : t("documents.split.propose"),
                          onClick: () => void propose(),
                          disabled: !ready || busy,
                      }
            }
        >
            <div className="space-y-4 text-sm text-gray-700">
                <p className="[overflow-wrap:anywhere]">{t("documents.split.heading", { filename })}</p>
                {!state ? (
                    <p role="status" className="flex items-center gap-2 text-xs text-gray-500">
                        <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                        {t("documents.split.checking")}
                    </p>
                ) : proposal ? (
                    <Preview
                        proposal={proposal}
                        groups={groups}
                        classes={proposal.classes.map((c) => c.name)}
                        disabled={creating}
                        fallbackName={fallbackName}
                        onChange={setGroups}
                    />
                ) : (
                    <Notice state={state} proposing={proposing} />
                )}
            </div>
        </Modal>
    );
}

function Notice({ state, proposing }: { state: DocumentSplitState; proposing: boolean }) {
    const t = useTranslations();
    return (
        <>
            {state.needs_scan_reading && (
                <p role="alert" className="font-medium text-gray-900">
                    {t("documents.split.needsScanReading", { count: state.unread_pages })}
                </p>
            )}
            {state.too_large && (
                <p role="alert" className="text-red-700">
                    {t("documents.split.tooLarge")}
                </p>
            )}
            <p className="text-xs text-gray-600">
                {t("documents.split.facts", {
                    pages: state.page_count,
                    credits: state.estimated_credits,
                    cost: dollars(state.estimated_cost_usd),
                })}
            </p>
            {/* The legal notice. Its final text lives in these two catalog keys. */}
            <div className="space-y-2 rounded-lg bg-app-surface px-3 py-2 text-xs text-gray-700">
                <p className="font-medium text-gray-900">{t("documents.split.notice")}</p>
                <p>{t("documents.split.noticeDetail")}</p>
            </div>
            <p className="text-xs text-gray-500">{t("documents.split.nothingYet")}</p>
            {proposing && (
                <p role="status" className="flex items-center gap-2 text-xs text-gray-500">
                    <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
                    {t("documents.split.waiting")}
                </p>
            )}
        </>
    );
}

function Preview({
    proposal,
    groups,
    classes,
    disabled,
    fallbackName,
    onChange,
}: {
    proposal: DocumentSplitProposal;
    groups: EditableSplitGroup[];
    classes: string[];
    disabled: boolean;
    fallbackName: string;
    onChange: (next: EditableSplitGroup[]) => void;
}) {
    const t = useTranslations();
    return (
        <>
            <p className="text-xs text-gray-600">{t("documents.split.previewIntro", { pages: proposal.page_count })}</p>
            <ul className="max-h-[50vh] space-y-3 overflow-y-auto pr-1" aria-label={t("documents.split.groupsLabel")}>
                {groups.map((group, index) => {
                    const prefix = `split-${group.id}`;
                    const others = groups.filter((g) => g.id !== group.id);
                    return (
                        <li key={group.id} className="rounded-xl bg-app-surface px-3 py-3">
                            <fieldset disabled={disabled} className="space-y-2 border-0 p-0">
                                <legend className="sr-only">{t("documents.split.groupTitle", { number: index + 1 })}</legend>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <label className="flex items-center text-xs font-medium text-gray-900">
                                        <input
                                            type="checkbox"
                                            className={TABLE_CHECKBOX_CLASS}
                                            checked={group.include}
                                            onChange={(event) => onChange(setGroupIncluded(groups, group.id, event.target.checked))}
                                        />
                                        {t("documents.split.include", { number: index + 1 })}
                                    </label>
                                    <span className="text-xs text-gray-600">
                                        {t("documents.split.pages", { count: group.pages.length, range: pageRanges(group.pages) })}
                                    </span>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                        <label htmlFor={`${prefix}-type`} className="text-xs font-medium text-gray-900">
                                            {t("documents.split.type")}
                                        </label>
                                        <select
                                            id={`${prefix}-type`}
                                            className={SELECT_CLASS}
                                            value={group.type ?? NO_TYPE}
                                            onChange={(event) =>
                                                onChange(setGroupType(groups, group.id, event.target.value === NO_TYPE ? null : event.target.value, fallbackName))
                                            }
                                        >
                                            <option value={NO_TYPE}>{t("documents.split.noType")}</option>
                                            {classes.map((name) => (
                                                <option key={name} value={name}>
                                                    {name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-1">
                                        <label htmlFor={`${prefix}-name`} className="text-xs font-medium text-gray-900">
                                            {t("documents.split.name")}
                                        </label>
                                        <ModalTextInput
                                            id={`${prefix}-name`}
                                            className="h-9"
                                            value={group.name}
                                            maxLength={150}
                                            aria-invalid={group.include && group.name.trim() === ""}
                                            onChange={(event) => onChange(setGroupName(groups, group.id, event.target.value))}
                                        />
                                    </div>
                                </div>
                                <details className="text-xs">
                                    <summary className="cursor-pointer rounded font-medium text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
                                        {t("documents.split.adjustPages")}
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        {group.pages.length > 1 && (
                                            <div className="flex flex-wrap items-center gap-2">
                                                <label htmlFor={`${prefix}-cut`} className="font-medium text-gray-900">
                                                    {t("documents.split.splitBefore")}
                                                </label>
                                                <select
                                                    id={`${prefix}-cut`}
                                                    className={`${SELECT_CLASS} w-auto`}
                                                    value=""
                                                    onChange={(event) => onChange(splitGroupAt(groups, group.id, Number(event.target.value), fallbackName))}
                                                >
                                                    <option value="">{t("documents.split.choosePage")}</option>
                                                    {group.pages.slice(1).map((page) => (
                                                        <option key={page} value={page}>
                                                            {t("documents.split.pageNumber", { page })}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <ul className="flex flex-wrap gap-x-4 gap-y-2">
                                            {group.pages.map((page) => (
                                                <li key={page} className="flex items-center gap-1.5">
                                                    <label htmlFor={`${prefix}-move-${page}`} className="text-gray-700">
                                                        {t("documents.split.movePage", { page })}
                                                    </label>
                                                    <select
                                                        id={`${prefix}-move-${page}`}
                                                        className={`${SELECT_CLASS} w-auto`}
                                                        value=""
                                                        onChange={(event) =>
                                                            onChange(
                                                                movePage(groups, page, event.target.value === "new" ? null : Number(event.target.value), fallbackName),
                                                            )
                                                        }
                                                    >
                                                        <option value="">{t("documents.split.chooseDocument")}</option>
                                                        {others.map((other) => (
                                                            <option key={other.id} value={other.id}>
                                                                {t("documents.split.moveTarget", {
                                                                    number: groups.indexOf(other) + 1,
                                                                    range: pageRanges(other.pages),
                                                                })}
                                                            </option>
                                                        ))}
                                                        {group.pages.length > 1 && <option value="new">{t("documents.split.newDocument")}</option>}
                                                    </select>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </details>
                            </fieldset>
                        </li>
                    );
                })}
            </ul>
            <p className="text-xs text-gray-500">{t("documents.split.freeToAdjust", { credits: proposal.credits })}</p>
            <p className="text-xs font-medium text-gray-900">{t("documents.split.originalUnchanged")}</p>
        </>
    );
}
