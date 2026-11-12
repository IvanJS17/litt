"use client";

import type { Workflow } from "../shared/types";
import { WorkflowPickerModal } from "../workflows/WorkflowPickerModal";
import { useTranslations } from "next-intl";

interface Props {
    open: boolean;
    onClose: () => void;
    onSelect: (workflow: Workflow) => Promise<void> | void;
    projectName?: string;
    projectCmNumber?: string | null;
    initialWorkflowId?: string;
}

export function AssistantWorkflowModal({
    open,
    onClose,
    onSelect,
    projectName,
    projectCmNumber,
    initialWorkflowId,
}: Props) {
    const t = useTranslations();
    const breadcrumbs = projectName
        ? [
              t("assistant.assistantWorkflowModal.projects"),
              `${projectName}${projectCmNumber ? ` (#${projectCmNumber})` : ""}`,
              t("assistant.assistantWorkflowModal.assistant"),
              t("assistant.assistantWorkflowModal.addWorkflow"),
          ]
        : [t("assistant.assistantWorkflowModal.assistant"), t("assistant.assistantWorkflowModal.addWorkflow")];

    return (
        <WorkflowPickerModal
            open={open}
            onClose={onClose}
            onSelect={onSelect}
            workflowType="assistant"
            breadcrumbs={breadcrumbs}
            primaryLabel={t("assistant.assistantWorkflowModal.use")}
            initialWorkflowId={initialWorkflowId}
        />
    );
}
