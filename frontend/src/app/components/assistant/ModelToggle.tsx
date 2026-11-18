"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  ModelToggleUI,
  nearestReasoningLevelForModel,
  reasoningLevelsForModel,
  type ReasoningLevel,
} from "@mike/ui";
import { isModelAvailable } from "@/app/lib/modelAvailability";
import {
  MODELS,
  allRouterModelOptions,
  modelDisplayName,
  noModelsReason,
  type ModelOption,
  type NoModelsReason,
  type RouterSelections,
} from "@mike/client";
import type { ApiKeyState } from "@/app/lib/mikeApi";
import {
  PERSONAL_WORKSPACE,
  useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { useOllamaModels } from "@/app/hooks/useOllamaModels";
import { useConfiguredModels } from "@/app/hooks/useConfiguredModels";
import { useModelGuide } from "@/app/hooks/useModelGuide";
import { ModelGuideModal } from "./ModelGuideModal";

export type { ReasoningLevel };

/** Deployment declarations override any static or router entry with the same id. */
export function mergeConfiguredModelOptions(
  configured: readonly ModelOption[],
  other: readonly ModelOption[],
): ModelOption[] {
  const configuredIds = new Set(configured.map((model) => model.id));
  return [
    ...other.filter((model) => !configuredIds.has(model.id)),
    ...configured,
  ];
}

interface Props {
  value: string;
  onChange: (id: string) => void;
  /**
   * Loaded key state, or undefined when it is UNKNOWN (profile still
   * loading, or the fetch failed and the app degrades). Unknown state fails
   * open — the backend authoritatively rejects models it cannot serve.
   */
  apiKeys?: ApiKeyState;
  /** True while the profile is still loading: render a neutral disabled
   *  trigger instead of flashing "No Models" on every page load. */
  apiKeysLoading?: boolean;
  /** Each router's saved Model Selections; omitted while none are known. */
  routerSelections?: Partial<RouterSelections>;
  compact?: boolean;
  /** A compact host with room (the phone's composer) names the model, not an icon. */
  compactShowsName?: boolean;
  tone?: "muted" | "default";
  /** A full-width form field: liquid glass, or "flat" grey like a flat select. */
  modalInput?: boolean | "flat";
  toolbar?: boolean;
  /** Extra classes for the compact trigger button, for a host row's sizing. */
  triggerClassName?: string;
  onNoModelsClick?: (reason: NoModelsReason) => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningChange?: (level: ReasoningLevel) => void;
  /** LiTT is answering: the level's thumbnail then changes without motion. */
  working?: boolean;
  /**
   * LiTT governed BYOK: the conversation is fixed to `value`, so no other
   * model is offered. The reasoning level can still change.
   */
  locked?: boolean;
  /**
   * The composer needs a model before it can send: with none chosen the
   * trigger asks for one and the menu offers the guide.
   */
  askForChoice?: boolean;
  /**
   * A request from the host to open the picker to make a choice (the person
   * tried to send with no model). A new object is a new request; the toggle
   * calls `onChoiceHandled` when the menu closes or cannot open.
   */
  choiceRequest?: object | null;
  onChoiceHandled?: () => void;
  /**
   * The id of the model the person used last when it can no longer be used
   * (`unavailablePreviousModel`). With no model chosen the menu names it.
   */
  previousModelId?: string | null;
}

export function ModelToggle({
  value,
  onChange,
  apiKeys,
  apiKeysLoading = false,
  routerSelections = {},
  compact = false,
  compactShowsName = false,
  tone,
  modalInput = false,
  toolbar = false,
  triggerClassName,
  onNoModelsClick,
  reasoningLevel,
  onReasoningChange,
  working = false,
  locked = false,
  askForChoice = false,
  choiceRequest = null,
  onChoiceHandled,
  previousModelId = null,
}: Props) {
  const t = useTranslations();
  const guide = useModelGuide();
  const [open, setOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openReason, setOpenReason] = useState<"send" | null>(null);
  const ollamaModels = useOllamaModels();
  const configuredModels = useConfiguredModels();
  const models = mergeConfiguredModelOptions(configuredModels, [
    ...MODELS,
    ...allRouterModelOptions(routerSelections),
    ...ollamaModels.map((model) => ({
      ...model,
      label: modelDisplayName(model.id),
      source: "Local",
    })),
  ]);
  const availableModels = models.filter((model) => {
    if (locked) return model.id === value;
    if (model.source === "Configured") return true;
    if (model.group === "Local") return true;
    if (apiKeysLoading) return false; // nothing offered until known
    if (!apiKeys) return true; // unknown after a failed load → fail open
    return isModelAvailable(model.id, apiKeys);
  });
  const selected = availableModels.find((model) => model.id === value);
  const showGuide = askForChoice && !modalInput && !toolbar && !locked;
  const guidedModels = showGuide
    ? availableModels.map((model) => {
        const hint = guide.entryFor(model.id)?.hint;
        return hint ? { ...model, hint } : model;
      })
    : availableModels;
  // A request to choose opens the menu on the next render, or, with no
  // model to choose from, says why (the same warning as the empty button).
  // While the keys load nothing is offered yet, so a request to choose stays
  // queued (not handled, not dropped) and acts once they are known.
  const actionableRequest = apiKeysLoading ? null : choiceRequest;
  const [seenRequest, setSeenRequest] = useState(actionableRequest);
  if (actionableRequest !== seenRequest) {
    setSeenRequest(actionableRequest);
    if (actionableRequest && availableModels.length > 0) {
      setOpenReason("send");
      setOpen(true);
    }
  }
  const supportedReasoningLevels = reasoningLevelsForModel(value);
  const normalizedReasoningLevel = reasoningLevel
    ? nearestReasoningLevelForModel(value, reasoningLevel)
    : undefined;
  useEffect(() => {
    if (
      reasoningLevel &&
      normalizedReasoningLevel &&
      normalizedReasoningLevel !== reasoningLevel &&
      onReasoningChange
    ) {
      onReasoningChange(normalizedReasoningLevel);
    }
  }, [normalizedReasoningLevel, onReasoningChange, reasoningLevel]);
  const selectedLabel = apiKeysLoading
    ? (models.find((model) => model.id === value)?.label ?? t("assistant.modelToggle.selectModel"))
    : (selected?.label ??
      (availableModels.length > 0
        ? t("assistant.modelToggle.selectModel")
        : t("assistant.modelToggle.noModels")));
  // In an organization workspace the keys and model lists are its admins'
  // to set, so an empty picker says who can fix it.
  const { workspaceId, orgApiKeys } = useWorkspace();
  const organization =
    workspaceId !== null && workspaceId !== PERSONAL_WORKSPACE && orgApiKeys
      ? { allowPersonalKeys: orgApiKeys.allow_personal_keys.ai }
      : null;
  const emptyReason = noModelsReason(apiKeys, routerSelections, organization);
  const choiceHandledRef = useRef(onChoiceHandled);
  const noModelsClickRef = useRef(onNoModelsClick);
  const emptyReasonRef = useRef(emptyReason);
  useEffect(() => {
    choiceHandledRef.current = onChoiceHandled;
    noModelsClickRef.current = onNoModelsClick;
    emptyReasonRef.current = emptyReason;
  });
  const cannotOpen = actionableRequest !== null && availableModels.length === 0;
  useEffect(() => {
    if (!cannotOpen) return;
    noModelsClickRef.current?.(emptyReasonRef.current);
    choiceHandledRef.current?.();
  }, [cannotOpen, actionableRequest]);
  return (
    <>
    <ModelToggleUI
      value={value}
      onChange={onChange}
      models={guidedModels}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setOpenReason(null);
          onChoiceHandled?.();
        }
      }}
      needsChoice={
        askForChoice && value === "" && availableModels.length > 0 && !locked
      }
      openReason={openReason}
      previousGone={
        previousModelId && value === ""
          ? t(
              organization
                ? "ui.modelToggle.previousGone"
                : "ui.modelToggle.previousGonePersonal",
              {
                model:
                  models.find((model) => model.id === previousModelId)?.label ??
                  modelDisplayName(previousModelId),
              },
            )
          : undefined
      }
      levelHints={showGuide ? guide.levelHints : undefined}
      onOpenGuide={showGuide ? () => setGuideOpen(true) : undefined}
      selectedLabel={selectedLabel}
      // No model chosen yet is not a missing key: the label says "Select
      // model" and nothing is flagged until a chosen model lacks its key.
      selectedAvailable={selected !== undefined || value === ""}
      loading={apiKeysLoading}
      compact={compact}
      compactShowsName={compactShowsName}
      tone={tone}
      modalInput={modalInput}
      toolbar={toolbar}
      triggerClassName={triggerClassName}
      emptyLabel={t("assistant.modelToggle.noModels")}
      onEmptyClick={
        onNoModelsClick ? () => onNoModelsClick(emptyReason) : undefined
      }
      reasoningLevel={normalizedReasoningLevel}
      onReasoningChange={onReasoningChange}
      reasoningLevels={supportedReasoningLevels}
      working={working}
    />
    {showGuide && (
      <ModelGuideModal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        models={availableModels}
        value={value}
        onSelect={onChange}
      />
    )}
    </>
  );
}
