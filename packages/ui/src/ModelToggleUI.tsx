"use client";

import * as React from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  LoaderCircle,
  Settings2,
} from "lucide-react";
import { twMerge } from "tailwind-merge";
import { TabPillButtonUI } from "./TabPillButtonUI";
import { textButtonUIClassName } from "./TextButtonUI.styles";
import {
  DROPDOWN_ROWS_CLASS,
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "./dropdown";
import {
  LIQUID_GLASS_FLOAT_CLASS,
  LIQUID_GLASS_HOVER_CLASS,
  LIQUID_GLASS_SELECTED_CLASS,
  LIQUID_GLASS_SUBTLE_CLASS,
} from "./LiquidGlassUI";

import type { ModelToggleGroup, ModelToggleOption } from "@mike/client";
import { useTranslations } from "use-intl";

export type { ModelToggleGroup, ModelToggleOption };

export const REASONING_LEVELS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** The catalog key of each level's name; read it with the caller's `t`. */
export const REASONING_LEVEL_LABEL_KEYS = {
  none: "ui.modelToggle.levelNone",
  low: "ui.modelToggle.levelLow",
  medium: "ui.modelToggle.levelMedium",
  high: "ui.modelToggle.levelHigh",
  xhigh: "ui.modelToggle.levelXhigh",
  max: "ui.modelToggle.levelMax",
} as const satisfies Record<ReasoningLevel, string>;

/**
 * The catalog key of the names a route group or source is shown under when
 * they are words and not a provider. The stored value stays "Local" or
 * "Configured"; only its label follows the language.
 */
const ROUTE_LABEL_KEYS = {
  Direct: "ui.modelToggle.routeDirect",
  Local: "ui.modelToggle.routeLocal",
  Configured: "ui.modelToggle.routeConfigured",
} as const;

function routeLabel(
  t: (key: (typeof ROUTE_LABEL_KEYS)[keyof typeof ROUTE_LABEL_KEYS]) => string,
  value: string,
): string {
  return Object.hasOwn(ROUTE_LABEL_KEYS, value)
    ? t(ROUTE_LABEL_KEYS[value as keyof typeof ROUTE_LABEL_KEYS])
    : value;
}

const STANDARD_REASONING_LEVELS: readonly ReasoningLevel[] =
  REASONING_LEVELS.filter((level) => level !== "max");
const ALWAYS_REASONING_LEVELS: readonly ReasoningLevel[] =
  REASONING_LEVELS.filter((level) => level !== "none");

/** Explicit AI SDK reasoning levels supported by the selected model family. */
export function reasoningLevelsForModel(
  modelId: string,
): readonly ReasoningLevel[] {
  const catalogId = modelId.startsWith("bedrock/")
    ? // Bedrock names Claude "anthropic.claude-…", optionally behind a
      // cross-region inference-profile prefix ("us.", "us-gov.") or at the
      // end of an inference-profile ARN, after its last "/".
      modelId
        .split("/")
        .at(-1)!
        .replace(/^(?:[a-z]+(?:-[a-z]+)*\.)?anthropic\./, "")
    : modelId
        .replace(/^(?:openrouter|vercel)\//, "")
        // An explicit protocol is not part of the model name.
        .replace(
          /^((?:vertex|azure-foundry)\/)(?:anthropic|openai|gemini):/,
          "$1",
        )
        // Vertex pins Claude versions as "claude-opus-5-5@20260101".
        .replace(/^(vertex\/[^@]+)@/, "$1-");
  // Astra, Sol 6.1, and current Fable/Opus cannot disable thinking.
  if (
    /(?:^|\/)(?:gpt-6-astra|gpt-6\.1-sol|claude-fable-5-[12]|claude-opus-5-5)(?:$|-)/.test(
      catalogId,
    )
  ) {
    return catalogId.includes("claude-")
      ? STANDARD_REASONING_LEVELS.filter((level) => level !== "none")
      : ALWAYS_REASONING_LEVELS;
  }
  if (/(?:^|\/)gpt-(?:5\.6|6(?:\.1)?)(?:-|$)/.test(catalogId)) {
    return REASONING_LEVELS;
  }
  if (/(?:^|\/)mistral-(?:large-4|medium-3-5|small-2603)$/.test(catalogId)) {
    return ["none", "high"];
  }
  return STANDARD_REASONING_LEVELS;
}

/** Move a stale saved level to the nearest level supported by the model. */
export function nearestReasoningLevelForModel(
  modelId: string,
  level: ReasoningLevel,
): ReasoningLevel {
  const supported = reasoningLevelsForModel(modelId);
  if (supported.includes(level)) return level;
  const requestedIndex = REASONING_LEVELS.indexOf(level);
  return supported.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(
      REASONING_LEVELS.indexOf(nearest) - requestedIndex,
    );
    const candidateDistance = Math.abs(
      REASONING_LEVELS.indexOf(candidate) - requestedIndex,
    );
    return candidateDistance <= nearestDistance ? candidate : nearest;
  }, supported[0] ?? "high");
}

export const MODEL_TOGGLE_GROUPS: readonly ModelToggleGroup[] = [
  "Anthropic",
  "Google",
  "OpenAI",
  "Mistral AI",
  "OpenCode Go",
  "OpenRouter",
  "Vercel AI Gateway",
  "Amazon Bedrock",
  "Azure OpenAI",
  "Azure AI Foundry",
  "Google Vertex AI",
  "xAI",
  "OpenAI-compatible endpoint",
  "Configured",
  "Local",
];

export function orderedModelGroups(
  models: readonly ModelToggleOption[],
): ModelToggleGroup[] {
  const present = new Set(models.map((model) => model.group));
  const known = MODEL_TOGGLE_GROUPS.filter((group) => present.delete(group));
  return [...known, ...[...present].sort((a, b) => a.localeCompare(b))];
}

/**
 * The short name for a narrow trigger: "Claude Fable 5.2" → "Fable 5.2",
 * "Mistral Large 4 (Preview)" → "Mistral Large 4". The full name stays in the
 * list and in the trigger's title.
 */
export function shortModelLabel(label: string): string {
  const short = label
    .replace(/^Claude\s+/, "")
    .replace(/\s*\((?:Preview|Vista previa)\)\s*$/i, "")
    .trim();
  return short || label;
}

export interface ModelToggleUIProps {
  value: string;
  onChange: (id: string) => void;
  models: readonly ModelToggleOption[];
  selectedLabel?: string;
  selectedAvailable?: boolean;
  loading?: boolean;
  compact?: boolean;
  /**
   * In a compact host, name the model (short, with a chevron) instead of
   * showing a bare icon. For a host with the room, such as a phone's chat
   * composer; a narrow task pane keeps the icon.
   */
  compactShowsName?: boolean;
  /** `default` matches the toolbar's other buttons; `muted` is the lighter chat-composer look. */
  tone?: "muted" | "default";
  /** A full-width form field: liquid glass, or "flat" grey like a flat select. */
  modalInput?: boolean | "flat";
  /** Use the shared table-toolbar pill for the picker trigger. */
  toolbar?: boolean;
  /** Extra classes for the compact trigger button, for a host row's sizing. */
  triggerClassName?: string;
  emptyLabel?: string;
  onEmptyClick?: () => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningChange?: (level: ReasoningLevel) => void;
  reasoningLevels?: readonly ReasoningLevel[];
  /** Open state, for a host that opens the picker itself; uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// The grey filled field of ModalSelect's flat variant, so the two can sit
// side by side in a pane's form.
const FLAT_INPUT_CLASS = textButtonUIClassName({
  className:
    "flex h-10 w-full items-center justify-between gap-2 rounded-xl bg-app-surface-active px-3 text-sm text-gray-700",
});

const itemClassName =
  "theme-dropdown-item flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-gray-700 outline-none transition-colors focus:text-gray-900 data-[highlighted]:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>*]:pointer-events-none";

/**
 * Platform-neutral model-picker presentation. Hosts own model discovery and
 * availability; this component owns the responsive trigger and dropdown UI.
 */
export function ModelToggleUI({
  value,
  onChange,
  models,
  selectedLabel,
  selectedAvailable = true,
  loading = false,
  compact = false,
  compactShowsName = false,
  tone = "muted",
  modalInput = false,
  toolbar = false,
  triggerClassName,
  emptyLabel,
  onEmptyClick,
  reasoningLevel,
  onReasoningChange,
  reasoningLevels = REASONING_LEVELS,
  open: openProp,
  onOpenChange,
}: ModelToggleUIProps) {
  const t = useTranslations();
  const TriggerButton = toolbar ? TabPillButtonUI : "button";
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = openProp ?? uncontrolledOpen;
  const reasoningInputRef = React.useRef<HTMLInputElement>(null);
  const selected = models.find((model) => model.id === value);
  const [expandedGroup, setExpandedGroup] =
    React.useState<ModelToggleGroup | null>(null);
  const availableGroups = orderedModelGroups(models).flatMap((group) => {
    const items = models.filter((model) => model.group === group);
    return items.length ? [{ group, items }] : [];
  });
  const routeCounts = models.reduce((counts, model) => {
    const key = `${model.group}\u0000${model.label.toLocaleLowerCase()}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const label =
    selectedLabel ??
    selected?.label ??
    (models.length > 0
      ? t("ui.modelToggle.selectModel")
      : (emptyLabel ?? t("ui.modelToggle.noModels")));
  const reasoningIndex = reasoningLevel
    ? Math.max(0, reasoningLevels.indexOf(reasoningLevel))
    : 0;
  const reasoningProgress =
    (reasoningIndex / Math.max(1, reasoningLevels.length - 1)) * 100;

  // Every opening, by the trigger or by the host, starts on the selected
  // model's group. Set while rendering, so the menu never paints collapsed.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setExpandedGroup(selected?.group ?? availableGroups[0]?.group ?? null);
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  if (!loading && models.length === 0) {
    return (
      <TriggerButton
        type="button"
        aria-label={t("ui.modelToggle.noModelsAvailable")}
        title={t("ui.modelToggle.configureModels")}
        onClick={onEmptyClick}
        disabled={!onEmptyClick}
        className={
          toolbar
            ? twMerge("min-w-0 max-w-full", triggerClassName)
            : modalInput === "flat"
            ? twMerge(FLAT_INPUT_CLASS, "justify-start text-gray-400")
            : modalInput
            ? `flex h-10 w-full items-center rounded-xl px-3 text-sm text-gray-400 ${LIQUID_GLASS_SUBTLE_CLASS} ${LIQUID_GLASS_HOVER_CLASS} transition-colors enabled:cursor-pointer enabled:hover:text-gray-700 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2`
            : twMerge(
                "flex h-8 shrink-0 items-center rounded-lg px-2 text-sm text-gray-400 transition-colors enabled:cursor-pointer enabled:hover:text-gray-700 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
                triggerClassName,
                // The words are the control: a host's icon-square width
                // (compact composer) would cut them down to "N…".
                "w-auto",
              )
        }
      >
        <span className="max-w-[200px] truncate">{emptyLabel ?? t("ui.modelToggle.noModels")}</span>
      </TriggerButton>
    );
  }

  return (
    <Dropdown open={open} onOpenChange={handleOpenChange}>
      <DropdownTrigger asChild>
        <TriggerButton
          type="button"
          aria-label={t("ui.modelToggle.chooseModel")}
          title={
            loading
              ? t("ui.modelToggle.checkingApiKeys")
              : models.length === 0
                ? t("ui.modelToggle.noApiKeyConfigured")
                : selectedAvailable
                  ? t("ui.modelToggle.chooseModelLabel", { label })
                  : t("ui.modelToggle.apiKeyMissingForSelectedModel")
          }
          disabled={loading}
          className={
            toolbar
              ? twMerge("min-w-0 max-w-full", triggerClassName)
              : modalInput === "flat"
              ? FLAT_INPUT_CLASS
              : modalInput
              ? `keyboard-focus-ring flex h-10 w-full items-center justify-between gap-2 rounded-xl px-3 text-sm text-gray-700 ${LIQUID_GLASS_SUBTLE_CLASS} ${LIQUID_GLASS_HOVER_CLASS} transition-colors enabled:cursor-pointer disabled:cursor-default disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${open ? LIQUID_GLASS_SELECTED_CLASS : ""}`
              : twMerge(
                  `keyboard-focus-ring flex h-8 shrink-0 items-center rounded-lg text-sm ${tone === "default" || selected ? "text-gray-700 enabled:hover:text-gray-900 disabled:hover:text-gray-700" : "text-gray-400 enabled:hover:text-gray-700 disabled:hover:text-gray-400"} transition-colors enabled:cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ${compact ? (compactShowsName ? "gap-1 px-2" : "w-8 justify-center px-0") : "gap-1.5 px-2"} ${open ? "text-gray-700" : ""}`,
                  triggerClassName,
                )
          }
        >
          {compact && !compactShowsName ? (
            loading ? (
              <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
            ) : selectedAvailable ? (
              <Settings2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
            )
          ) : compact && loading ? (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <>
              {compact && !selectedAvailable && (
                <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
              )}
              <span
                className={`${modalInput ? "min-w-0 flex-1 text-left" : compact ? "min-w-0 max-w-[7.5rem]" : "min-w-0 max-w-[200px]"} truncate`}
              >
                {compact ? shortModelLabel(label) : label}
              </span>
              <ChevronDown
                className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
              />
            </>
          )}
        </TriggerButton>
      </DropdownTrigger>
      <DropdownContent
        side={modalInput || toolbar ? "bottom" : "top"}
        align={modalInput || toolbar ? "start" : "end"}
        sideOffset={modalInput ? 4 : 8}
        className={`flex max-h-[min(320px,60vh)] flex-col overflow-hidden rounded-2xl text-gray-700 ${modalInput ? "w-[var(--radix-dropdown-menu-trigger-width)]" : "w-56"}`}
      >
        <div
          className={`-mr-1.5 min-h-0 flex-1 overflow-y-auto pr-1.5 ${DROPDOWN_ROWS_CLASS}`}
        >
          {availableGroups.map(({ group, items }) => {
            const expanded = expandedGroup === group;
            return (
              <React.Fragment key={group}>
                <DropdownItem
                  aria-expanded={expanded}
                  className={`${itemClassName} py-2 font-medium`}
                  onSelect={(event) => {
                    event.preventDefault();
                    setExpandedGroup(expanded ? null : group);
                  }}
                >
                  <span className="flex-1">{routeLabel(t, group)}</span>
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-gray-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
                  />
                </DropdownItem>
                {expanded &&
                  items.map((model) => (
                    <DropdownItem
                      key={model.id}
                      selected={model.id === value}
                      className={`${itemClassName} ${model.id === value ? "text-gray-900" : ""}`}
                      onSelect={() => onChange(model.id)}
                    >
                      <span
                        aria-hidden="true"
                        className="h-1 w-1 shrink-0 rounded-full bg-gray-400/80"
                      />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        {model.label}
                      </span>
                      {model.id === value && (
                        <Check
                          aria-hidden="true"
                          className="ml-1 h-3.5 w-3.5 shrink-0 text-gray-600"
                        />
                      )}
                      {model.source &&
                        (!["Direct", "Local", "Configured"].includes(model.source) ||
                          (routeCounts.get(
                            `${model.group}\u0000${model.label.toLocaleLowerCase()}`,
                          ) ?? 0) > 1) && (
                          <span className="shrink-0 text-right text-[10px] font-medium text-gray-400">
                            {routeLabel(t, model.source)}
                          </span>
                        )}
                    </DropdownItem>
                  ))}
              </React.Fragment>
            );
          })}
        </div>
        {reasoningLevel !== undefined && onReasoningChange && (
          <div className="shrink-0">
            <DropdownSeparator />
            <DropdownItem
              aria-label={t("ui.modelToggle.reasoningLevelValue", { level: t(REASONING_LEVEL_LABEL_KEYS[reasoningLevel]) })}
              onSelect={(event) => event.preventDefault()}
              onFocus={(event) => {
                if (event.target === event.currentTarget) {
                  reasoningInputRef.current?.focus();
                }
              }}
              className="block cursor-default rounded-md px-2.5 py-2 [&>*]:pointer-events-auto"
            >
              <div>
                <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-700">
                  <span className="font-medium">{t("ui.modelToggle.reasoning")}</span>
                  <span className="ml-auto text-[10px] text-gray-500">
                    {t(REASONING_LEVEL_LABEL_KEYS[reasoningLevel])}
                  </span>
                </div>
                <div className="relative h-4 w-full rounded-full bg-gray-200/80 transition-shadow duration-150 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus has-[input:focus-visible]:ring-offset-2">
                  <span aria-hidden="true" className="absolute inset-0">
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-interactive/60 via-interactive to-interactive transition-[width] duration-150 ease-out"
                      style={{
                        width: `calc(${reasoningProgress}% + ${1 - reasoningProgress / 100}rem)`,
                      }}
                    />
                    <span
                      className={`absolute top-1/2 h-3 w-3 rounded-full bg-white transition-[left,transform] duration-150 ease-out ${LIQUID_GLASS_FLOAT_CLASS}`}
                      style={{
                        left: `calc(${reasoningProgress}% + ${0.125 - reasoningProgress / 100}rem)`,
                        transform: "translateY(-50%)",
                      }}
                    />
                  </span>
                  <input
                    ref={reasoningInputRef}
                    type="range"
                    aria-label={t("ui.modelToggle.reasoningLevel")}
                    aria-valuetext={t(REASONING_LEVEL_LABEL_KEYS[reasoningLevel])}
                    min={0}
                    max={reasoningLevels.length - 1}
                    step={1}
                    value={reasoningIndex}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      const offsets: Partial<Record<string, number>> = {
                        ArrowLeft: -1,
                        ArrowDown: -1,
                        ArrowRight: 1,
                        ArrowUp: 1,
                        PageDown: -1,
                        PageUp: 1,
                      };
                      const offset = offsets[event.key];
                      const nextIndex =
                        event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? reasoningLevels.length - 1
                            : offset
                              ? Math.min(
                                  reasoningLevels.length - 1,
                                  Math.max(0, reasoningIndex + offset),
                                )
                              : null;
                      if (nextIndex === null) return;
                      event.preventDefault();
                      event.stopPropagation();
                      onReasoningChange(
                        reasoningLevels[nextIndex] ?? reasoningLevel,
                      );
                    }}
                    onChange={(event) =>
                      onReasoningChange(
                        reasoningLevels[Number(event.currentTarget.value)] ??
                          "high",
                      )
                    }
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  />
                </div>
              </div>
            </DropdownItem>
          </div>
        )}
      </DropdownContent>
    </Dropdown>
  );
}
