"use client";

import { useDocumentWorkspace } from "@/app/contexts/WorkspaceContext";
import { useWorkspaceIdentity } from "@/app/hooks/useWorkspaceIdentity";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { QuickAction, Workflow } from "../shared/types";
import { Modal } from "../modals/Modal";
import { ModalSelect } from "../modals/ModalSelect";
import { ModalTextarea } from "../modals/ModalTextarea";
import { FieldLabel, FormTextInput } from "../ui/form-field";
import { ToggleSwitchUI } from "@mike/ui";
import { SearchBar } from "../ui/search-bar";
import { listWorkflows } from "@/app/lib/mikeApi";
import { reportFault, userFacingApiError } from "@/app/lib/userFacingError";
import { LIQUID_GLASS_MODAL_ROW_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import { useTranslations } from "next-intl";

type Screen = "list" | "details" | "create";

interface QuickActionsModalProps {
  open: boolean;
  actions: QuickAction[];
  onSave: (action: QuickAction) => Promise<void>;
  onCreate: (input: {
    workflowId: string;
    name: string;
    prompt: string;
    documentUpload: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

function QuickActionsModalForWorkspace({
  open,
  actions,
  onSave,
  onCreate,
  onClose,
}: QuickActionsModalProps) {
    const t = useTranslations();
    const workspace = useDocumentWorkspace();
  const [screen, setScreen] = useState<Screen>("list");
  const [selected, setSelected] = useState<QuickAction | null>(null);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [documentUpload, setDocumentUpload] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || workflows.length > 0) return;
    void listWorkflows("assistant", workspace ?? "personal")
      .then((rows) => setWorkflows(rows))
      .catch(() => setError(t("assistant.quickActionsModal.couldNotLoadAssistantWorkflows")));
  }, [open, workflows.length, workspace]);

  const availableWorkflows = useMemo(() => {
    const used = new Set(actions.map((action) => action.workflow_id));
    return workflows.filter((workflow) => !used.has(workflow.id));
  }, [actions, workflows]);
  const filteredActions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? actions.filter((action) =>
          `${action.name} ${action.workflow.title}`
            .toLowerCase()
            .includes(query),
        )
      : actions;
  }, [actions, search]);
  const selectedHasChanges = useMemo(() => {
    if (!selected) return false;
    const original = actions.find((action) => action.id === selected.id);
    return (
      !!original &&
      (selected.workflow_id !== original.workflow_id ||
        selected.name !== original.name ||
        selected.prompt !== original.prompt ||
        selected.document_upload !== original.document_upload ||
        selected.enabled !== original.enabled)
    );
  }, [actions, selected]);

  function resetToList() {
    setScreen("list");
    setSelected(null);
    setWorkflowId("");
    setName("");
    setPrompt("");
    setDocumentUpload(false);
    setError(null);
  }

  function close() {
    resetToList();
    onClose();
  }

  async function save() {
    if (!selected || saving || !selectedHasChanges || !selected.name.trim())
      return;
    setSaving(true);
    setError(null);
    try {
      await onSave(selected);
      resetToList();
    } catch (reason) {
      reportFault(reason, {
          operation: "quick_actions.run",
        });
      setError(
        userFacingApiError(reason, t("assistant.quickActionsModal.couldNotSaveQuickAction")),
      );
    } finally {
      setSaving(false);
    }
  }

  async function create() {
    if (!workflowId || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        workflowId,
        name: name.trim(),
        prompt,
        documentUpload,
      });
      resetToList();
    } catch (reason) {
      reportFault(reason, {
          operation: "quick_actions.run",
        });
      setError(
        userFacingApiError(reason, t("assistant.quickActionsModal.couldNotCreateQuickAction")),
      );
    } finally {
      setSaving(false);
    }
  }

  const breadcrumbs =
    screen === "list"
      ? [t("assistant.quickActionsModal.assistant"), t("assistant.quickActionsModal.quickActions")]
      : [
          t("assistant.quickActionsModal.assistant"),
          t("assistant.quickActionsModal.quickActions"),
          screen === "create"
            ? t("assistant.quickActionsModal.newQuickAction")
            : (selected?.name ?? t("assistant.quickActionsModal.quickAction")),
        ];

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      breadcrumbs={breadcrumbs}
      secondaryAction={
        screen !== "list"
          ? {
              label: t("assistant.quickActionsModal.back"),
              variant: "primary",
              onClick: resetToList,
              disabled: saving,
            }
          : undefined
      }
      cancelAction={false}
      primaryAction={
        screen === "list"
          ? {
              label: t("assistant.quickActionsModal.add"),
              icon: <Plus className="h-3.5 w-3.5" />,
              variant: "blue",
              onClick: () => setScreen("create"),
              disabled: availableWorkflows.length === 0,
            }
          : screen === "create"
            ? {
                label: saving ? t("assistant.quickActionsModal.creating") : t("assistant.quickActionsModal.create"),
                variant: "blue",
                disabled: saving || !workflowId || !name.trim(),
                onClick: () => void create(),
              }
            : {
                label: saving ? t("assistant.quickActionsModal.saving") : t("assistant.quickActionsModal.save"),
                variant: "blue",
                disabled:
                  saving || !selectedHasChanges || !selected?.name.trim(),
                onClick: () => void save(),
              }
      }
    >
      {screen === "list" ? (
        <div className="flex min-h-0 flex-1 flex-col pb-5">
          <div className="pt-1 pb-2">
            <SearchBar
              value={search}
              onValueChange={setSearch}
              placeholder={t("assistant.quickActionsModal.searchQuickActions")}
              autoFocus
            />
          </div>
          <div
            data-slot="quick-actions-list"
            data-modal-scroll="vertical"
            className="mt-2 min-h-0 flex-1 overflow-x-hidden overflow-y-auto pt-1"
          >
            {error && (
              <p className="px-3 py-2 text-xs text-red-600" role="alert">
                {error}
              </p>
            )}
            {filteredActions.length === 0 ? (
              <p className="py-10 text-center text-sm text-gray-400">
                {t("assistant.quickActionsModal.noQuickActionsFound")}
              </p>
            ) : (
              filteredActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    setSelected(action);
                    setScreen("details");
                  }}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-gray-700 transition-colors ${LIQUID_GLASS_MODAL_ROW_HOVER_CLASS}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {action.name}
                  </span>
                  <span
                    className={
                      action.enabled
                        ? "text-xs text-green-600"
                        : "text-xs text-gray-400"
                    }
                  >
                    {action.enabled ? t("assistant.quickActionsModal.active") : t("assistant.quickActionsModal.inactive")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : screen === "create" ? (
        <QuickActionForm
          name={name}
          workflowId={workflowId}
          workflowOptions={availableWorkflows.map((workflow) => ({
            value: workflow.id,
            label: workflow.metadata.title,
          }))}
          prompt={prompt}
          documentUpload={documentUpload}
          onNameChange={setName}
          onWorkflowChange={(value) => {
            setWorkflowId(value);
            if (!name.trim()) {
              setName(
                availableWorkflows.find((workflow) => workflow.id === value)
                  ?.metadata.title ?? "",
              );
            }
          }}
          onPromptChange={setPrompt}
          onDocumentUploadChange={setDocumentUpload}
          error={error}
        />
      ) : selected ? (
        <QuickActionForm
          name={selected.name}
          workflowId={selected.workflow_id}
          workflowOptions={[
            {
              value: selected.workflow_id,
              label: selected.workflow.title,
            },
            ...availableWorkflows.map((workflow) => ({
              value: workflow.id,
              label: workflow.metadata.title,
            })),
          ]}
          prompt={selected.prompt}
          documentUpload={selected.document_upload}
          enabled={selected.enabled}
          onNameChange={(value) => setSelected({ ...selected, name: value })}
          onWorkflowChange={(value) => {
            const workflow = workflows.find((item) => item.id === value);
            if (!workflow) return;
            setSelected({
              ...selected,
              workflow_id: workflow.id,
              workflow: { id: workflow.id, title: workflow.metadata.title },
            });
          }}
          onPromptChange={(value) =>
            setSelected({ ...selected, prompt: value })
          }
          onDocumentUploadChange={(value) =>
            setSelected({ ...selected, document_upload: value })
          }
          onEnabledChange={(value) =>
            setSelected({ ...selected, enabled: value })
          }
          error={error}
        />
      ) : null}
    </Modal>
  );
}

function QuickActionForm({
  name,
  workflowId,
  workflowOptions,
  prompt,
  documentUpload,
  enabled,
  onNameChange,
  onWorkflowChange,
  onPromptChange,
  onDocumentUploadChange,
  onEnabledChange,
  error,
}: {
  name: string;
  workflowId: string;
  workflowOptions: { value: string; label: string }[];
  prompt: string;
  documentUpload: boolean;
  enabled?: boolean;
  onNameChange: (value: string) => void;
  onWorkflowChange: (value: string) => void;
  onPromptChange: (value: string) => void;
  onDocumentUploadChange: (value: boolean) => void;
  onEnabledChange?: (value: boolean) => void;
  error: string | null;
}) {
  const t = useTranslations();
  return (
    <div
      data-slot="quick-action-form"
      className="flex min-h-0 flex-1 flex-col gap-6 px-2 pt-1 pb-5"
    >
      <div>
        <FieldLabel htmlFor="quick-action-name">{t("assistant.quickActionsModal.name")}</FieldLabel>
        <FormTextInput
          id="quick-action-name"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t("assistant.quickActionsModal.quickActionName")}
          variant="minimal"
          autoFocus
        />
      </div>
      <div>
        <FieldLabel htmlFor="quick-action-workflow">{t("assistant.quickActionsModal.workflowUsed")}</FieldLabel>
        <ModalSelect
          id="quick-action-workflow"
          value={workflowId}
          placeholder={t("assistant.quickActionsModal.selectAnAssistantWorkflow")}
          options={workflowOptions}
          onChange={onWorkflowChange}
        />
      </div>
      <div>
        <FieldLabel htmlFor="quick-action-prompt">{t("assistant.quickActionsModal.prompt")}</FieldLabel>
        <ModalTextarea
          id="quick-action-prompt"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          className="h-28 min-h-28"
          placeholder={t("assistant.quickActionsModal.promptPlacedInTheAssistantComposer")}
        />
      </div>
      <ToggleRow
        label={t("assistant.quickActionsModal.requestDocumentUpload")}
        caption={t("assistant.quickActionsModal.askForSourceDocumentsBeforeLaunching")}
        checked={documentUpload}
        onChange={onDocumentUploadChange}
      />
      {enabled !== undefined && onEnabledChange && (
        <ToggleRow
          label={t("assistant.quickActionsModal.active")}
          caption={t("assistant.quickActionsModal.showThisActionInTheAssistant")}
          checked={enabled}
          onChange={onEnabledChange}
        />
      )}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  caption,
  checked,
  onChange,
}: {
  label: string;
  caption: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-700">{label}</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-400">{caption}</p>
      </div>
      <ToggleSwitchUI
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}

export function QuickActionsModal(props: QuickActionsModalProps) {
    const identity = useWorkspaceIdentity();
    return <QuickActionsModalForWorkspace key={identity} {...props} />;
}
