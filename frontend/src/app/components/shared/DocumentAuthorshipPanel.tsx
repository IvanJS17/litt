"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { DocumentAuthorship } from "@mike/contracts";
import { TextButtonUI } from "@mike/ui";
import { getDocumentAuthorship } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { SkeletonLine } from "./TablePrimitive";

type Loaded =
    | { key: string; state: "ready"; authorship: DocumentAuthorship }
    | { key: string; state: "failed" };

type Part = "person" | "ai" | "undetermined";

// The bar is decoration: the figures below it say the same in words. Each part
// has its own fill (solid, light, hatched-by-outline) so no meaning rests on
// colour alone.
const PART_BAR: Record<Part, string> = {
    person: "bg-foreground",
    ai: "bg-foreground/35",
    undetermined: "bg-gray-100 ring-1 ring-inset ring-gray-300",
};

/**
 * LiTT training (docs/training.md, "Authorship of the work"): how much of a
 * version came from the assistant, as an ESTIMATE the server computes when
 * this is opened. It says which rule was applied and shows what LiTT cannot
 * place as «undetermined». Rendered only where the server offered it
 * (`training_authorship` on the version): the person in training, their
 * mentor and whoever may approve the draft. Nothing here is stored.
 */
export function DocumentAuthorshipPanel({
    documentId,
    versionId,
    className,
}: {
    documentId: string;
    versionId: string | null;
    className?: string;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [loaded, setLoaded] = useState<Loaded | null>(null);
    const [generation, setGeneration] = useState(0);
    const panelId = useId();
    const key = `${documentId}:${versionId ?? ""}:${generation}`;
    const retry = useCallback(() => setGeneration((value) => value + 1), []);
    const action = t("training.criterion.authorship.loadFailedAction");

    useEffect(() => {
        if (!open || !versionId) return;
        let cancelled = false;
        getDocumentAuthorship(documentId, versionId).then(
            (authorship) => {
                if (!cancelled) setLoaded({ key, state: "ready", authorship });
            },
            (error: unknown) => {
                if (cancelled) return;
                setLoaded({ key, state: "failed" });
                notifyError(error, {
                    action,
                    operation: "training.read",
                    onRetry: retry,
                    dedupeKey: `authorship:${key}`,
                });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [open, documentId, versionId, key, action, retry]);

    if (!versionId) return null;
    const current = loaded?.key === key ? loaded : null;

    return (
        <section
            aria-label={t("training.criterion.authorship.title")}
            className={`min-w-0 ${className ?? ""}`}
        >
            <TextButtonUI
                size="xs"
                aria-expanded={open}
                aria-controls={panelId}
                onClick={() => setOpen((value) => !value)}
                className="text-foreground"
            >
                <ChevronDown
                    aria-hidden="true"
                    className={`h-3 w-3 transition-transform ${open ? "" : "-rotate-90"}`}
                />
                {open
                    ? t("training.criterion.authorship.hide")
                    : t("training.criterion.authorship.show")}
            </TextButtonUI>
            <div id={panelId} hidden={!open} className="mt-2 min-w-0 space-y-2 text-xs">
                {open &&
                    (current === null ? (
                        <AuthorshipSkeleton label={t("common.loading")} />
                    ) : current.state === "failed" ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                            <p className="text-muted-foreground">
                                {t("training.criterion.authorship.loadFailed")}
                            </p>
                            <TextButtonUI size="xs" onClick={retry} className="text-foreground">
                                {t("common.retry")}
                            </TextButtonUI>
                        </div>
                    ) : (
                        <AuthorshipBody authorship={current.authorship} />
                    ))}
            </div>
        </section>
    );
}

/** Same rows as the loaded panel: a bar, three figures and the rule. */
function AuthorshipSkeleton({ label }: { label: string }) {
    return (
        <div className="space-y-2" aria-busy="true" aria-label={label} role="status">
            <div className="h-2 w-full animate-pulse rounded-full bg-gray-100" />
            <SkeletonLine className="w-2/3" />
            <SkeletonLine className="w-1/2" />
            <SkeletonLine className="w-3/5" />
            <SkeletonLine className="w-5/6" />
        </div>
    );
}

function AuthorshipBody({ authorship }: { authorship: DocumentAuthorship }) {
    const t = useTranslations("training.criterion.authorship");
    const { shares, words, edits } = authorship;
    if (authorship.status !== "ok" || !shares || !words) {
        const message =
            authorship.status === "text_pending"
                ? t("status.textPending")
                : authorship.status === "text_failed"
                  ? t("status.textFailed")
                  : authorship.status === "too_large"
                    ? t("status.tooLarge")
                    : t("status.empty");
        return (
            <p role="status" className="text-muted-foreground [overflow-wrap:anywhere]">
                {message}
            </p>
        );
    }

    const parts: Part[] = ["person", "ai", "undetermined"];
    return (
        <>
            <div aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
                {parts.map((part) =>
                    shares[part] > 0 ? (
                        <div
                            key={part}
                            className={PART_BAR[part]}
                            style={{ width: `${shares[part]}%` }}
                        />
                    ) : null,
                )}
            </div>
            <dl className="space-y-1">
                {parts.map((part) => (
                    <div key={part} className="flex min-w-0 items-baseline justify-between gap-3">
                        <dt className="flex min-w-0 items-center gap-1.5 text-foreground">
                            <span
                                aria-hidden="true"
                                className={`inline-block h-2 w-2 shrink-0 rounded-full ${PART_BAR[part]}`}
                            />
                            <span className="[overflow-wrap:anywhere]">{t(part)}</span>
                        </dt>
                        <dd className="shrink-0 font-medium text-foreground">
                            {t("share", { percent: shares[part] })}
                        </dd>
                    </div>
                ))}
            </dl>
            <p className="text-muted-foreground">
                {t("words", { count: words.total })} {t("estimateNote")}
            </p>
            <p className="text-muted-foreground">
                {t("edits", {
                    accepted: edits.accepted,
                    rejected: edits.rejected,
                    pending: edits.pending,
                })}
            </p>
            {edits.pending > 0 && (
                <p className="text-muted-foreground">{t("pending", { count: edits.pending })}</p>
            )}
            {authorship.baseline === "file" && (
                <p className="text-muted-foreground">{t("baseline.file")}</p>
            )}
            {authorship.baseline === "unknown" && (
                <p className="text-muted-foreground">{t("baseline.unknown")}</p>
            )}
            {authorship.textless_pages > 0 && (
                <p className="text-muted-foreground">
                    {t("textless", { count: authorship.textless_pages })}
                </p>
            )}
            <p className="text-muted-foreground [overflow-wrap:anywhere]">{t("rule")}</p>
        </>
    );
}
