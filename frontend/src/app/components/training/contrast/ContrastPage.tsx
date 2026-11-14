"use client";

import Link from "next/link";
import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import {
    getMyCriteriaContrasts,
    getMyTraining,
    getSubagentRoutes,
    getTrainingStage,
    runCriteriaContrastTurn,
    type TrainingCriteriaContrast,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { LoadFailed, useSupervisionData } from "../supervision/supervisionShared";
import { ComparisonSections, RouteCaption } from "./contrastShared";

// Ajustes → Formación → Contraste de criterios (docs/training.md, layer 3).
// Step 1: the same assignment goes to two subagents (the two routes the person
// picks among their own, or two neutral approaches). Step 2: the two analyses
// side by side, the person's own explanation of why they diverge, written
// BEFORE the AI's, and the comparison. The server decides every step (the
// routes, the exact two subagents, the one explanation); this page offers what
// it allows. A route that can't run is shown as failed, never replaced.

export const CASE_MIN_CHARS = 20;
export const CASE_MAX_CHARS = 6000;
export const EXPLANATION_MIN_CHARS = 60;
export const EXPLANATION_MAX_CHARS = 4000;

type Loaded = {
    orgId: string | null;
    contrasts: TrainingCriteriaContrast[];
    canStart: boolean;
    routes: string[];
    /** How many routes the person configured, usable or not. */
    configured: number;
};

const RUN_STATUSES = ["failed", "incomplete", "needs_input", "cancelled", "not_run"] as const;
const isRunStatus = (status: string): status is (typeof RUN_STATUSES)[number] =>
    (RUN_STATUSES as readonly string[]).includes(status);

const chars = (text: string) => [...text.trim()].length;

export function ContrastPage() {
    const t = useTranslations("training.criterion.contrast");
    const load = useCallback(async (): Promise<Loaded> => {
        const memberships = await getMyTraining();
        const junior = memberships.find((entry) => entry.stages.some((stage) => stage.stage === "junior"));
        if (!junior) return { orgId: null, contrasts: [], canStart: false, routes: [], configured: 0 };
        const [list, stage, routes] = await Promise.all([
            getMyCriteriaContrasts(junior.org_id),
            getTrainingStage({ orgId: junior.org_id }),
            getSubagentRoutes(),
        ]);
        return {
            orgId: junior.org_id,
            contrasts: list.contrasts,
            // The server decides again on every turn; this only offers it.
            canStart: stage.modes?.includes("criteria_contrast") === true,
            routes: routes.routes.filter((route) => !route.unavailable).map((route) => route.name),
            configured: routes.routes.length,
        };
    }, []);
    const { data, failed, reload } = useSupervisionData(load, {
        action: t("actions.load"),
        operation: "training.read",
    });

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Link
                    href="/settings/training"
                    className="inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    {t("page.back")}
                </Link>
                <SettingsHeading id="contraste-de-criterios">{t("page.title")}</SettingsHeading>
                <SettingsDescription>{t("page.intro")}</SettingsDescription>
            </div>
            {failed && !data ? (
                <LoadFailed onRetry={reload} />
            ) : !data ? (
                <ContrastSkeleton />
            ) : data.orgId === null ? (
                <p className="text-sm text-gray-500">{t("page.notJunior")}</p>
            ) : (
                <>
                    {data.canStart ? (
                        <StartContrast orgId={data.orgId} routes={data.routes} configured={data.configured} onDone={reload} />
                    ) : (
                        <p className="text-sm text-gray-500">{t("page.unavailable")}</p>
                    )}
                    <section className="min-w-0 space-y-4" aria-labelledby="contrast-list">
                        <h3 id="contrast-list" className="text-sm font-medium text-gray-900">
                            {t("page.listHeading")}
                        </h3>
                        <p className="text-sm text-gray-500">{t("page.noScore")}</p>
                        {data.contrasts.length === 0 && <p className="text-sm text-gray-500">{t("page.empty")}</p>}
                        <ul className="min-w-0 space-y-6">
                            {data.contrasts.map((contrast) => (
                                <li key={contrast.id} className="min-w-0 border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                                    <ContrastCard contrast={contrast} onDone={reload} />
                                </li>
                            ))}
                        </ul>
                    </section>
                </>
            )}
        </div>
    );
}

function StartContrast({
    orgId,
    routes,
    configured,
    onDone,
}: {
    orgId: string;
    routes: string[];
    configured: number;
    onDone: () => void;
}) {
    const t = useTranslations("training.criterion.contrast");
    const id = useId();
    const [text, setText] = useState("");
    const [first, setFirst] = useState("");
    const [second, setSecond] = useState("");
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    // With two or more routes the person picks two of them; with one the server runs both analyses on it; with none, on the conversation's model.
    const picking = routes.length >= 2;
    // Routes configured but none usable: the server fails closed, so the page does not offer to start.
    const blocked = configured > 0 && routes.length === 0;
    const ready = chars(text) >= CASE_MIN_CHARS && !blocked && (!picking || (first !== "" && second !== "" && first !== second));
    const options = (taken: string) =>
        routes.filter((name) => name !== taken).map((name) => ({ value: name, label: name }));

    const start = async () => {
        setBusy(true);
        setFailure(null);
        try {
            const result = await runCriteriaContrastTurn({
                text: text.trim(),
                orgId,
                mode: "criteria_contrast",
                ...(picking ? { routes: [first, second] as [string, string] } : {}),
            });
            if (result.failure !== null)
                setFailure(result.failure ? t("page.startFailed", { reason: result.failure }) : t("page.startFailedGeneric"));
            else setText("");
        } catch (error) {
            notifyError(error, { action: t("actions.start"), operation: "training.read" });
        } finally {
            setBusy(false);
            onDone();
        }
    };

    return (
        <section className="min-w-0 space-y-4" aria-labelledby={`${id}-heading`}>
            <h3 id={`${id}-heading`} className="text-sm font-medium text-gray-900">
                {t("page.startHeading")}
            </h3>
            <div className="min-w-0 space-y-1">
                <label htmlFor={`${id}-case`} className="text-sm font-medium text-gray-900">
                    {t("page.caseLabel")}
                </label>
                <p id={`${id}-case-help`} className="text-sm text-gray-500">
                    {t("page.caseHelp")}
                </p>
                <textarea
                    id={`${id}-case`}
                    aria-describedby={`${id}-case-help ${id}-case-count`}
                    value={text}
                    maxLength={CASE_MAX_CHARS}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                    className="min-h-32 w-full rounded-xl border border-gray-200 bg-surface-field px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
                />
                <p id={`${id}-case-count`} className="text-xs text-gray-500">
                    {chars(text) >= CASE_MIN_CHARS
                        ? t("page.caseCount", { count: [...text].length, max: CASE_MAX_CHARS })
                        : t("page.caseMin", { min: CASE_MIN_CHARS })}
                </p>
            </div>
            <div className="min-w-0 space-y-2">
                <h4 className="text-sm font-medium text-gray-900">{t("page.routesHeading")}</h4>
                {picking ? (
                    <>
                        <p className="text-sm text-gray-500">{t("page.routesHelp")}</p>
                        <div className="flex min-w-0 flex-wrap gap-3">
                            <ModalSelect
                                id={`${id}-first`}
                                aria-label={t("page.routeFirst")}
                                value={first}
                                placeholder={t("page.routeFirst")}
                                options={options(second)}
                                onChange={setFirst}
                                disabled={busy}
                                wrapLabels
                                className="min-w-0 sm:w-56"
                            />
                            <ModalSelect
                                id={`${id}-second`}
                                aria-label={t("page.routeSecond")}
                                value={second}
                                placeholder={t("page.routeSecond")}
                                options={options(first)}
                                onChange={setSecond}
                                disabled={busy}
                                wrapLabels
                                className="min-w-0 sm:w-56"
                            />
                        </div>
                    </>
                ) : (
                    <p className="text-sm text-gray-500">
                        {blocked
                            ? t("page.routesUnavailableNote")
                            : routes.length === 1
                              ? t("page.singleRouteNote", { route: routes[0] })
                              : t("page.approachesNote")}
                    </p>
                )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3" aria-live="polite">
                <PillButtonUI type="button" tone="black" size="sm" disabled={busy || !ready} loading={busy} onClick={() => void start()}>
                    {t("page.start")}
                </PillButtonUI>
                {busy && <span className="text-sm text-gray-700">{t("page.starting")}</span>}
                {failure && <span role="alert" className="text-sm text-gray-700">{failure}</span>}
            </div>
        </section>
    );
}

export function ContrastCard({ contrast, onDone }: { contrast: TrainingCriteriaContrast; onDone: () => void }) {
    const t = useTranslations("training.criterion.contrast.card");
    const id = useId();
    const briefs = contrast.briefs ?? [];
    const columns = Math.max(contrast.routes.length, briefs.length);
    // The status the server recorded, in words; one it does not know is shown as recorded.
    const runStatusLabel = (status: string) => (isRunStatus(status) ? t(`runStatus.${status}`) : status);
    return (
        <article className="min-w-0 space-y-4" aria-labelledby={`${id}-status`}>
            <div className="space-y-0.5 text-sm">
                <h4 id={`${id}-status`} className="font-medium text-gray-900">
                    {t(`status.${contrast.status}`)}
                </h4>
                <p className="text-gray-500">{t("created", { date: new Date(contrast.created_at) })}</p>
            </div>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
                {Array.from({ length: columns }, (_, index) => {
                    const route = contrast.routes[index];
                    const brief = briefs[index] ?? "";
                    return (
                        <section key={index} role="group" className="min-w-0 space-y-2" aria-labelledby={`${id}-analysis-${index}`}>
                            <h5 id={`${id}-analysis-${index}`} className="text-sm font-medium text-gray-900">
                                {t("analysis", { number: index + 1 })}
                            </h5>
                            <RouteCaption route={route} />
                            {route && route.status !== "completed" && (
                                <p className="text-sm text-gray-700">
                                    {t("didNotRun", { status: runStatusLabel(route.status) })}
                                </p>
                            )}
                            {brief && (
                                <div
                                    role="region"
                                    aria-labelledby={`${id}-analysis-${index}`}
                                    tabIndex={0}
                                    className="max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-surface-sheet p-3 text-sm leading-6 text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                >
                                    <p className="whitespace-pre-wrap break-words">{brief}</p>
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
            {contrast.status === "awaiting_person" && <Explain contrast={contrast} onDone={onDone} />}
            {contrast.status === "failed" && (
                <div className="min-w-0 space-y-2">
                    <p className="text-sm text-gray-700">{contrast.person_explanation ? t("failedAfter") : t("failedNote")}</p>
                    {contrast.person_explanation && (
                        <div className="min-w-0 space-y-1">
                            <h5 className="text-sm font-medium text-gray-900">{t("yourExplanation")}</h5>
                            <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{contrast.person_explanation}</p>
                        </div>
                    )}
                </div>
            )}
            {contrast.status === "explained" && contrast.comparison && (
                <div className="min-w-0 space-y-3">
                    <div className="min-w-0 space-y-1">
                        <h5 className="text-sm font-medium text-gray-900">{t("yourExplanation")}</h5>
                        <p className="whitespace-pre-wrap break-words text-sm text-gray-800">{contrast.person_explanation}</p>
                    </div>
                    <h5 className="text-sm font-medium text-gray-900">{t("comparison")}</h5>
                    <ComparisonSections comparison={contrast.comparison} idPrefix={`${id}-cmp`} />
                    <Link
                        href={
                            contrast.project_id
                                ? `/projects/${encodeURIComponent(contrast.project_id)}/assistant/chat/${encodeURIComponent(contrast.chat_id)}`
                                : `/assistant/chat/${encodeURIComponent(contrast.chat_id)}`
                        }
                        className="inline-block rounded text-sm text-gray-900 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                        {t("seeAi")}
                    </Link>
                </div>
            )}
        </article>
    );
}

function Explain({ contrast, onDone }: { contrast: TrainingCriteriaContrast; onDone: () => void }) {
    const t = useTranslations("training.criterion.contrast");
    const id = useId();
    const [value, setValue] = useState("");
    const [busy, setBusy] = useState(false);
    const long = chars(value) >= EXPLANATION_MIN_CHARS;
    const send = async () => {
        setBusy(true);
        try {
            const result = await runCriteriaContrastTurn({ text: value.trim(), chatId: contrast.chat_id, mode: "criteria_explain" });
            if (result.failure !== null)
                notifyError(new Error(result.failure || "criteria explanation failed"), {
                    action: t("actions.send"),
                    operation: "training.read",
                });
        } catch (error) {
            notifyError(error, { action: t("actions.send"), operation: "training.read" });
        } finally {
            setBusy(false);
            onDone();
        }
    };
    return (
        <div className="min-w-0 space-y-2">
            <label htmlFor={`${id}-explain`} className="text-sm font-medium text-gray-900">
                {t("card.explainLabel")}
            </label>
            <p id={`${id}-explain-help`} className="text-sm text-gray-500">
                {t("card.explainHelp")}
            </p>
            <textarea
                id={`${id}-explain`}
                aria-describedby={`${id}-explain-help ${id}-explain-count`}
                value={value}
                maxLength={EXPLANATION_MAX_CHARS}
                disabled={busy}
                onChange={(event) => setValue(event.target.value)}
                className="min-h-32 w-full rounded-xl border border-gray-200 bg-surface-field px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
            />
            <p id={`${id}-explain-count`} className="text-xs text-gray-500">
                {long
                    ? t("card.explainCount", { count: [...value].length, max: EXPLANATION_MAX_CHARS })
                    : t("card.explainMin", { min: EXPLANATION_MIN_CHARS })}
            </p>
            <div className="flex min-w-0 flex-wrap items-center gap-3" aria-live="polite">
                <PillButtonUI type="button" tone="black" size="sm" disabled={busy || !long} loading={busy} onClick={() => void send()}>
                    {t("card.send")}
                </PillButtonUI>
                {busy && <span className="text-sm text-gray-700">{t("card.sending")}</span>}
            </div>
        </div>
    );
}

/** The loading state, in the layout of the page: the form and a list. */
function ContrastSkeleton() {
    const t = useTranslations("common");
    return (
        <div className="space-y-4" aria-busy="true" aria-label={t("loading")}>
            <SkeletonLine className="w-1/3" />
            <div className="h-32 animate-pulse rounded-xl bg-gray-100" />
            <SkeletonLine className="w-1/2" />
        </div>
    );
}
