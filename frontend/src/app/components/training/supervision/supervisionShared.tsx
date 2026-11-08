"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import type {
    TrainingReviewGeneration,
    TrainingStage,
    TrainingPromotionTarget,
    TrainingUrgencyPass,
} from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { practiceOptionLabel } from "../trainingShared";

// LiTT training layer 2 «Supervisión» (docs/training.md): pieces shared by
// the mentor panel and the pupil's «Lo que mi mentor ve de mí». Learning
// data is shown as the server sends it: the pupil's attempts, the contrasts
// and the AI's lines are never translated (plan i18n §3.4).

/** Up to this many characters in a defense's or a pass's note (the server's limit). */
const NOTE_MAX_CHARS = 500;

/** An optional free-text note (learning data: never audited, never translated). */
export function NoteField({
    value,
    onChange,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const t = useTranslations("training.notes");
    return (
        <div className="min-w-0 space-y-1">
            <textarea
                aria-label={t("optional")}
                placeholder={t("optional")}
                value={value}
                maxLength={NOTE_MAX_CHARS}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="min-h-20 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
            />
            <p className="text-xs text-gray-500">{t("max", { max: NOTE_MAX_CHARS })}</p>
        </div>
    );
}

export function useStageLabel() {
    const t = useTranslations("training.stage");
    return (stage: TrainingStage | TrainingPromotionTarget) => t(stage);
}

/** A stored (normalized) practice area, as the user picked it. */
export function usePracticeLabel() {
    const t = useTranslations("training");
    return (practice: string | null) => (practice === null ? t("allPractices") : practiceOptionLabel(practice));
}

/** Whether a pass lifts «Tu turno primero» right now. */
export function passInForce(pass: TrainingUrgencyPass, now = Date.now()): boolean {
    return (
        pass.revoked_at === null &&
        Date.parse(pass.starts_at) <= now &&
        now < Date.parse(pass.expires_at)
    );
}

/** A pass's state in one line of plain text. */
export function PassState({ pass }: { pass: TrainingUrgencyPass }) {
    const t = useTranslations("training.passes");
    if (pass.revoked_at) return <>{t("revoked", { date: new Date(pass.revoked_at) })}</>;
    if (passInForce(pass)) return <>{t("inForce", { end: new Date(pass.expires_at) })}</>;
    return <>{t("ended", { end: new Date(pass.expires_at) })}</>;
}

/**
 * Load one piece of supervision data: the latest answer, whether it failed
 * (the toast says why), and a way to read it again.
 */
export function useSupervisionData<T>(
    load: () => Promise<T>,
    failure: { action: string; operation: "training.manage" | "training.read" },
) {
    const [data, setData] = useState<T | null>(null);
    const [failed, setFailed] = useState(false);
    const [generation, setGeneration] = useState(0);
    const reload = useCallback(() => setGeneration((value) => value + 1), []);
    const { action, operation } = failure;

    useEffect(() => {
        let cancelled = false;
        load().then(
            (next) => {
                if (cancelled) return;
                setData(next);
                setFailed(false);
            },
            (error: unknown) => {
                if (cancelled) return;
                setFailed(true);
                notifyError(error, { action, operation });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [load, action, operation, generation]);

    return { data, failed, reload };
}

/** What a list shows when it could not be read: a line and «Retry». */
export function LoadFailed({ onRetry }: { onRetry: () => void }) {
    const t = useTranslations();
    return (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
            <p className="text-sm text-gray-500">{t("training.loadFailed")}</p>
            <PillButtonUI type="button" tone="white" size="sm" onClick={onRetry}>
                {t("common.retry")}
            </PillButtonUI>
        </div>
    );
}

/** The loading state of a list of cards, in the same layout. */
export function CardsSkeleton({ rows = 2 }: { rows?: number }) {
    const t = useTranslations("common");
    return (
        <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="space-y-2 rounded-xl border border-gray-100 p-4">
                    <SkeletonLine className="w-2/3" />
                    <SkeletonLine className="w-1/2" />
                    <SkeletonLine className="w-5/6" />
                </div>
            ))}
        </div>
    );
}

/**
 * The key a generation runs on. Shown only when the mentor has more than one;
 * with no default the mentor must choose (the server never picks another).
 */
export function useCredentialChoice(generation: TrainingReviewGeneration | null | undefined) {
    const [picked, setPicked] = useState<string | null>(null);
    const options = generation?.available ? generation.credential_options : [];
    const fallback = generation?.available
        ? (generation.default_credential_ref ?? (options.length === 1 ? options[0].credential_ref : null))
        : null;
    const value = picked && options.some((option) => option.credential_ref === picked) ? picked : fallback;
    return { options, value, setValue: setPicked, ready: !!generation?.available && value !== null };
}

export function CredentialSelect({
    id,
    choice,
    disabled,
}: {
    id: string;
    choice: ReturnType<typeof useCredentialChoice>;
    disabled?: boolean;
}) {
    const t = useTranslations("training");
    if (choice.options.length < 2) return null;
    return (
        <ModalSelect
            id={id}
            aria-label={t("works.key")}
            value={choice.value ?? ""}
            placeholder={t("works.chooseKey")}
            options={choice.options.map((option) => ({
                value: option.credential_ref,
                label: t(`credentialSource.${option.source}`),
            }))}
            onChange={choice.setValue}
            disabled={disabled}
            wrapLabels
            className="min-w-0 sm:w-56"
        />
    );
}
