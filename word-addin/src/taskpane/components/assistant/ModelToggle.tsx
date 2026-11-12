import { useTranslations } from "use-intl";
import React, { useEffect, useMemo, useState } from "react";
import {
  ModelToggleUI,
  nearestReasoningLevelForModel,
  reasoningLevelsForModel,
  type ReasoningLevel,
} from "@mike/ui";
import { getOllamaModels, type ApiKeyStatus } from "../../api/mikeApi";
import {
  MODELS,
  allRouterModelOptions,
  modelDisplayName,
  type ModelOption,
  type RouterSelections,
} from "@mike/client";
import { isModelAvailable } from "../../lib/modelCatalog";

export function ModelToggle({
  value,
  onChange,
  keyStatus,
  keyStatusLoading = false,
  routerSelections,
  compact = false,
  onNoModelsClick,
  reasoningLevel,
  onReasoningChange,
  open,
  onOpenChange,
  onHasModelsChange,
}: {
  value: string;
  onChange: (model: string) => void;
  keyStatus: ApiKeyStatus | null;
  /** True while the key-status preflight is in flight: render a neutral
   *  disabled trigger instead of flashing "No Models". */
  keyStatusLoading?: boolean;
  /** Each router's saved Model Selections; null before the profile loads. */
  routerSelections: RouterSelections | null;
  compact?: boolean;
  onNoModelsClick?: () => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningChange?: (level: ReasoningLevel) => void;
  /** Lets the composer open the picker, from the "Select a model" warning. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Whether the picker has any model to offer, once the preflight is done. */
  onHasModelsChange?: (hasModels: boolean) => void;
}): React.ReactElement {
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getOllamaModels()
      .then((models) => {
        if (!cancelled) setOllamaModels(models);
      })
      // Local (Ollama) models are an optional extra: when the host is not
      // running there is simply no "Local" group, and nothing the user asked
      // for has failed.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useMemo(() => {
    const routerOptions = allRouterModelOptions(routerSelections ?? {});
    const localOptions = ollamaModels.map((model) => ({
      ...model,
      label: modelDisplayName(model.id),
      source: "Local",
    }));
    return [
      ...MODELS,
      ...routerOptions,
      ...localOptions,
    ].filter(
      (model) =>
        model.group === "Local" || isModelAvailable(model.id, keyStatus),
    );
  }, [keyStatus, ollamaModels, routerSelections]);
  const hasModels = models.length > 0;
  useEffect(() => {
    if (!keyStatusLoading) onHasModelsChange?.(hasModels);
  }, [hasModels, keyStatusLoading, onHasModelsChange]);
  const selected = models.find((model) => model.id === value);
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

  const t = useTranslations();
  return (
    <ModelToggleUI
      value={value}
      onChange={onChange}
      models={models}
      selectedLabel={
        keyStatusLoading
          ? (selected?.label ?? t("word.selectModel2"))
          : (selected?.label ??
            (models.length > 0 ? t("word.selectModel2") : t("word.noModels")))
      }
      selectedAvailable={selected !== undefined}
      loading={keyStatusLoading}
      compact={compact}
      emptyLabel={t("word.noModels")}
      onEmptyClick={onNoModelsClick}
      reasoningLevel={normalizedReasoningLevel}
      onReasoningChange={onReasoningChange}
      reasoningLevels={supportedReasoningLevels}
      open={open}
      onOpenChange={onOpenChange}
    />
  );
}
