"use client";

import { useEffect, useRef, useState } from "react";
import { Check, EyeOff, User } from "lucide-react";
import { openSourceWorkflow } from "@/app/lib/mikeApi";
import type { WorkflowOpenSourceSubmission } from "@/app/components/shared/types";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSegmentedToggle } from "@/app/components/modals/ModalSegmentedToggle";
import {
    FieldLabel,
    FormTextInput,
} from "@/app/components/ui/form-field";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { LIQUID_GLASS_FLAT_CLASS } from "@mike/ui";
import { useTranslations } from "next-intl";

type OpenSourceContributorMode = "named" | "anonymous";
type OpenSourceStatus = "idle" | "loading" | "complete";

const WORKFLOWS_REPO_URL =
    "https://github.com/Open-Legal-Products/mike-workflows";

interface OpenSourceWorkflowModalProps {
    open: boolean;
    onClose: () => void;
    workflowId: string;
    defaultContributorName: string;
    pending: boolean;
    onSubmitted: (submission: WorkflowOpenSourceSubmission) => void;
}

export function OpenSourceWorkflowModal({
    open,
    onClose,
    workflowId,
    defaultContributorName,
    pending,
    onSubmitted,
}: OpenSourceWorkflowModalProps) {
    const t = useTranslations();
    const [status, setStatus] = useState<OpenSourceStatus>("idle");
    const [error, setError] = useState<string | null>(null);
    const [contributorMode, setContributorMode] =
        useState<OpenSourceContributorMode>("anonymous");
    const [contributorName, setContributorName] = useState("");
    const [contributorOrganisation, setContributorOrganisation] = useState("");
    const [contributorRole, setContributorRole] = useState("");
    const [contributorLinkedin, setContributorLinkedin] = useState("");
    const [disclosureConsent, setDisclosureConsent] = useState(false);
    const [closeCountdown, setCloseCountdown] = useState(3);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    function resetModalState() {
        setStatus("idle");
        setError(null);
        setContributorMode("anonymous");
        setContributorName("");
        setContributorOrganisation("");
        setContributorRole("");
        setContributorLinkedin("");
        setDisclosureConsent(false);
        setCloseCountdown(3);
    }

    useEffect(() => {
        if (status !== "complete") return;

        const countdownTimer = window.setInterval(() => {
            setCloseCountdown((current) => Math.max(current - 1, 1));
        }, 1000);
        const closeTimer = window.setTimeout(() => {
            onCloseRef.current();
            resetModalState();
        }, 3000);

        return () => {
            window.clearInterval(countdownTimer);
            window.clearTimeout(closeTimer);
        };
    }, [status]);

    const loading = status === "loading";
    const submitted = status === "complete";
    const needsConsent = contributorMode === "named" && !disclosureConsent;

    async function handleSubmit() {
        setStatus("loading");
        setError(null);
        try {
            const response = await openSourceWorkflow(workflowId, {
                contributor_mode: contributorMode,
                contributor:
                    contributorMode === "named"
                        ? {
                              name:
                                  contributorName.trim() ||
                                  defaultContributorName,
                              organisation:
                                  contributorOrganisation.trim() || null,
                              role: contributorRole.trim() || null,
                              linkedin: contributorLinkedin.trim() || null,
                          }
                        : null,
            });
            onSubmitted({
                id: response.id,
                status: response.status,
                submitted_at: response.submitted_at,
                updated_at: response.updated_at,
                reviewed_at: response.reviewed_at ?? null,
            });
            setCloseCountdown(3);
            setStatus("complete");
        } catch (err) {
            setStatus("idle");
            setError(
                userFacingApiError(
                    err,
                    t("workflows.failedToSubmitWorkflowFor"),
                ),
            );
        }
    }

    return (
        <Modal
            open={open}
            onClose={() => {
                if (loading) return;
                onClose();
                resetModalState();
            }}
            breadcrumbs={[
                "Workflows",
                submitted
                    ? t("workflows.submitted")
                    : pending
                      ? t("workflows.updateOpenSourceSubmission")
                      : t("workflows.openSource"),
            ]}
            primaryAction={
                submitted
                    ? undefined
                    : {
                          label: loading
                              ? pending
                                  ? t("workflows.updating")
                                  : t("workflows.submitting")
                              : pending
                                ? t("workflows.updateSubmission")
                                : t("workflows.submitForReview"),
                          onClick: () => void handleSubmit(),
                          disabled: loading || needsConsent,
                      }
            }
        >
            {submitted ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center pb-10 text-center">
                    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50/55 text-emerald-700 shadow-[0_10px_28px_rgba(16,185,129,0.16),inset_0_-1px_0_rgba(16,185,129,0.12)]">
                        <Check className="h-6 w-6" />
                    </div>
                    <h3 className="text-2xl font-serif text-gray-950">
                        {t("workflows.workflowSubmitted")}
                    </h3>
                    <p className="mt-3 max-w-sm text-xs leading-6 text-gray-600">
                        {t("workflows.yourWorkflowSnapshotHasBeenSubmitted")}
                    </p>
                    <p className="mt-6 text-xs font-medium text-gray-500">
                        {t("workflows.closingInClosecountdown", { closeCountdown })}
                    </p>
                </div>
            ) : (
                <div className="space-y-4 pb-2 text-sm text-gray-700">
                    <h3 className="text-2xl font-serif text-gray-950">
                        {t("workflows.contributeToOpenSourceLegal")}
                    </h3>
                    <p className="leading-6 text-xs text-gray-600">
                        {t("workflows.submitASnapshotOfThisWorkflow")}{" "}
                        <a
                            href={WORKFLOWS_REPO_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium text-gray-950 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-600"
                        >
                            {t("workflows.openLegalProductsMikeWorkflows")}
                        </a>{" "}
                        {t("workflows.repoYoullBeNotifiedByEmail")}
                    </p>
                    {pending && (
                        <p className={`rounded-xl px-3 py-2 text-xs leading-5 text-gray-600 ${LIQUID_GLASS_FLAT_CLASS}`}>
                            {t("workflows.youAlreadyHaveAPendingSubmission")}
                        </p>
                    )}

                    <div className="space-y-2 pt-2">
                        <FieldLabel as="p">
                            {t("workflows.contributorAttribution")}
                        </FieldLabel>
                        <ModalSegmentedToggle
                            value={contributorMode}
                            onChange={setContributorMode}
                            disabled={loading}
                            options={[
                                {
                                    value: "anonymous",
                                    label: t("workflows.anonymous"),
                                    icon: EyeOff,
                                },
                                {
                                    value: "named",
                                    label: t("workflows.discloseDetails"),
                                    icon: User,
                                },
                            ]}
                        />
                        {contributorMode === "named" && (
                            <div className="grid gap-x-4 gap-y-5 pt-4 sm:grid-cols-2">
                                <div>
                                    <FieldLabel htmlFor="open-source-contributor-name">
                                        {t("workflows.fullName")}
                                    </FieldLabel>
                                    <FormTextInput
                                        id="open-source-contributor-name"
                                        value={contributorName}
                                        onChange={(event) =>
                                            setContributorName(
                                                event.target.value,
                                            )
                                        }
                                        placeholder={t("workflows.janeDoe")}
                                        disabled={loading}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="open-source-contributor-organisation">
                                        {t("workflows.organisation")}
                                    </FieldLabel>
                                    <FormTextInput
                                        id="open-source-contributor-organisation"
                                        value={contributorOrganisation}
                                        onChange={(event) =>
                                            setContributorOrganisation(
                                                event.target.value,
                                            )
                                        }
                                        placeholder={t("workflows.acmeLlp")}
                                        disabled={loading}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="open-source-contributor-role">
                                        {t("workflows.role")}
                                    </FieldLabel>
                                    <FormTextInput
                                        id="open-source-contributor-role"
                                        value={contributorRole}
                                        onChange={(event) =>
                                            setContributorRole(
                                                event.target.value,
                                            )
                                        }
                                        placeholder={t("workflows.seniorAssociate")}
                                        disabled={loading}
                                    />
                                </div>
                                <div>
                                    <FieldLabel htmlFor="open-source-contributor-linkedin">
                                        {t("workflows.linkedin")}
                                    </FieldLabel>
                                    <FormTextInput
                                        id="open-source-contributor-linkedin"
                                        type="url"
                                        value={contributorLinkedin}
                                        onChange={(event) =>
                                            setContributorLinkedin(
                                                event.target.value,
                                            )
                                        }
                                        placeholder="https://linkedin.com/in/janedoe"
                                        disabled={loading}
                                    />
                                </div>
                                <div className="flex items-start gap-2 pt-1 sm:col-span-2">
                                    <input
                                        id="open-source-disclosure-consent"
                                        type="checkbox"
                                        checked={disclosureConsent}
                                        onChange={(event) =>
                                            setDisclosureConsent(
                                                event.target.checked,
                                            )
                                        }
                                        disabled={loading}
                                        className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-black accent-black focus:ring-gray-400 disabled:cursor-not-allowed"
                                    />
                                    <p className="text-xs leading-5 text-gray-600">
                                        <label
                                            htmlFor="open-source-disclosure-consent"
                                            className="cursor-pointer"
                                        >
                                            {t("workflows.iConsentToDisclosingThePersonal")}
                                        </label>{" "}
                                        <a
                                            href={WORKFLOWS_REPO_URL}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-medium text-gray-900 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-gray-600"
                                        >
                                            {t("workflows.openLegalProductsMikeWorkflows")}
                                        </a>{" "}
                                        <label
                                            htmlFor="open-source-disclosure-consent"
                                            className="cursor-pointer"
                                        >
                                            {t("workflows.githubRepositoryAndOnTheMikeoss")}
                                        </label>
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                            {error}
                        </p>
                    )}
                </div>
            )}
        </Modal>
    );
}
