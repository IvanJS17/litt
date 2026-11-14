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
import { PIXEL_TEXT_CLASS, pixelTextClass } from "./pixelTextUI.styles";
import { TabPillButtonUI } from "./TabPillButtonUI";
import { textButtonUIClassName } from "./TextButtonUI.styles";
import {
  COMPOSER_GHOST_BUTTON_CLASS,
  COMPOSER_MENU_CLASS,
  COMPOSER_GHOST_WEB_ICON_CLASS,
  COMPOSER_GHOST_WEB_SIZE_CLASS,
  COMPOSER_GHOST_WORD_ICON_CLASS,
  COMPOSER_GHOST_WORD_SIZE_CLASS,
} from "./ComposerSurfaceUI.styles";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownSeparator,
  DropdownTrigger,
} from "./dropdown";
import {
  ReasoningLadderUI,
  ReasoningMiniUI,
  ladderStepCount,
} from "./ReasoningLadderUI";
import {
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

const MAKER_PREFIX = "Claude";
const PREVIEW_NOTES = ["(preview)", "(vista previa)"];

/**
 * The short name for a narrow trigger: "Claude Fable 5.2" → "Fable 5.2",
 * "Mistral Large 4 (Preview)" → "Mistral Large 4". The full name stays in the
 * list and in the trigger's title.
 */
export function shortModelLabel(label: string): string {
  // Plain string checks, not a regex: a label comes from the model catalog,
  // and `\s*…\s*$` backtracks quadratically on a long run of whitespace.
  let short =
    label.startsWith(MAKER_PREFIX) && /\s/.test(label.charAt(MAKER_PREFIX.length))
      ? label.slice(MAKER_PREFIX.length)
      : label;
  short = short.trimEnd();
  const note = PREVIEW_NOTES.find(
    (candidate) => short.slice(-candidate.length).toLowerCase() === candidate,
  );
  if (note) short = short.slice(0, -note.length);
  short = short.trim();
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
  /** The ghost button's size: the web's 30 px (40 with a finger) or Word's 32 px. */
  controlSize?: "web" | "word";
  emptyLabel?: string;
  onEmptyClick?: () => void;
  reasoningLevel?: ReasoningLevel;
  onReasoningChange?: (level: ReasoningLevel) => void;
  reasoningLevels?: readonly ReasoningLevel[];
  /**
   * LiTT is working on a reply. The thumbnail beside the name then changes
   * with no transition, so the only thing that moves on screen is the
   * status indicator.
   */
  working?: boolean;
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

// Rows are 32 px (44 px with a finger), 2 px apart, with 8 px corners.
const MODEL_ROWS_CLASS = "flex flex-col gap-0.5";

const itemClassName =
  "theme-dropdown-item flex min-h-8 cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-1 text-[0.8125rem] text-gray-700 outline-none transition-colors focus:text-gray-900 data-[highlighted]:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 pointer-coarse:min-h-11 [&>*]:pointer-events-none";

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
  controlSize = "web",
  emptyLabel,
  onEmptyClick,
  reasoningLevel,
  onReasoningChange,
  reasoningLevels = REASONING_LEVELS,
  working = false,
  open: openProp,
  onOpenChange,
}: ModelToggleUIProps) {
  const t = useTranslations();
  const TriggerButton = toolbar ? TabPillButtonUI : "button";
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const open = openProp ?? uncontrolledOpen;
  const ladderRef = React.useRef<HTMLDivElement>(null);
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
  const hasReasoning = reasoningLevel !== undefined && !!onReasoningChange;
  // The thumbnail of the level, beside the name, in the chat composer only.
  const showMini =
    hasReasoning &&
    !modalInput &&
    !toolbar &&
    selected !== undefined &&
    selectedAvailable &&
    ladderStepCount(reasoningLevels) > 0;
  const reasoningName = (level: ReasoningLevel): string =>
    t(REASONING_LEVEL_LABEL_KEYS[level]);
  // What the last change of level was, for the thumbnail: only a click or a
  // tap on the ladder, or another model, animates it. The keyboard and a drag
  // do not.
  const [levelChangeInstant, setLevelChangeInstant] = React.useState(false);
  // The level the pointer would choose, shown in grey beside the real one.
  const [previewLevel, setPreviewLevel] = React.useState<ReasoningLevel | null>(
    null,
  );

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
          aria-label={
            hasReasoning && selected && selectedAvailable && !loading
              ? t("ui.modelToggle.chooseModelWithReasoning", {
                  label,
                  level: reasoningName(reasoningLevel),
                })
              : t("ui.modelToggle.chooseModel")
          }
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
                  COMPOSER_GHOST_BUTTON_CLASS,
                  controlSize === "word"
                    ? COMPOSER_GHOST_WORD_SIZE_CLASS
                    : COMPOSER_GHOST_WEB_SIZE_CLASS,
                  compact && !compactShowsName
                    ? controlSize === "word"
                      ? COMPOSER_GHOST_WORD_ICON_CLASS
                      : COMPOSER_GHOST_WEB_ICON_CLASS
                    : "",
                  tone === "default" || selected
                    ? "text-gray-700"
                    : "text-gray-500",
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
                className={`${modalInput ? "min-w-0 flex-1 text-left" : compact ? "min-w-0 max-w-[7.5rem]" : "min-w-0 max-w-[200px]"} truncate ${showMini ? "@max-[18rem]:hidden" : ""}`}
              >
                {compact ? shortModelLabel(label) : label}
              </span>
              {showMini && reasoningLevel !== undefined ? (
                <ReasoningMiniUI
                  levels={reasoningLevels}
                  level={reasoningLevel}
                  instant={working || levelChangeInstant}
                />
              ) : (
                <ChevronDown
                  className={`h-3 w-3 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                />
              )}
            </>
          )}
        </TriggerButton>
      </DropdownTrigger>
      <DropdownContent
        side={modalInput || toolbar ? "bottom" : "top"}
        align={modalInput || toolbar ? "start" : "end"}
        sideOffset={modalInput ? 4 : 8}
        className={`${COMPOSER_MENU_CLASS} flex max-h-[min(360px,60vh)] flex-col overflow-hidden rounded-[14px] p-1.5 text-gray-700 ${modalInput ? "w-[var(--radix-dropdown-menu-trigger-width)]" : "w-66 max-w-[calc(100vw-24px)]"}`}
      >
        <div
          className={`-mr-1.5 min-h-0 flex-1 overflow-y-auto pr-1.5 ${MODEL_ROWS_CLASS}`}
        >
          {availableGroups.map(({ group, items }) => {
            const expanded = expandedGroup === group;
            return (
              <React.Fragment key={group}>
                <DropdownItem
                  aria-expanded={expanded}
                  className={`${itemClassName} font-semibold text-gray-900`}
                  onSelect={(event) => {
                    event.preventDefault();
                    setExpandedGroup(expanded ? null : group);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {routeLabel(t, group)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`${PIXEL_TEXT_CLASS} font-normal tabular-nums text-gray-500`}
                  >
                    {items.length}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 text-gray-500 transition-transform duration-200 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
                  />
                </DropdownItem>
                {expanded &&
                  items.map((model) => (
                    <DropdownItem
                      key={model.id}
                      selected={model.id === value}
                      className={`${itemClassName} litt-model-row pl-[18px] ${model.id === value ? "font-medium text-gray-900" : ""}`}
                      onSelect={() => {
                        // Another model may move the level to the nearest
                        // one it offers; that change animates.
                        setLevelChangeInstant(false);
                        onChange(model.id);
                      }}
                    >
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        {model.label}
                      </span>
                      {model.source &&
                        (!["Direct", "Local", "Configured"].includes(model.source) ||
                          (routeCounts.get(
                            `${model.group}\u0000${model.label.toLocaleLowerCase()}`,
                          ) ?? 0) > 1) && (
                          <span
                            className={`shrink-0 text-right font-normal text-gray-500 ${pixelTextClass(routeLabel(t, model.source), "text-2xs")}`}
                          >
                            {routeLabel(t, model.source)}
                          </span>
                        )}
                      {model.id === value && (
                        <Check
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-gray-900"
                        />
                      )}
                    </DropdownItem>
                  ))}
              </React.Fragment>
            );
          })}
        </div>
        {reasoningLevel !== undefined &&
          onReasoningChange &&
          ladderStepCount(reasoningLevels) > 0 && (
          <div className="shrink-0">
            <DropdownSeparator className="mx-1 my-1.5 bg-[var(--litt-composer-ring)]" />
            <DropdownItem
              aria-label={t("ui.modelToggle.reasoningLevelValue", {
                level: reasoningName(reasoningLevel),
              })}
              onSelect={(event) => event.preventDefault()}
              onFocus={(event) => {
                if (event.target === event.currentTarget) {
                  ladderRef.current?.focus();
                }
              }}
              className="block cursor-default rounded-lg px-2.5 pb-2.5 pt-2 [&>*]:pointer-events-auto"
            >
              <div>
                <div className="mb-2 flex items-baseline gap-2 text-xs">
                  <span className="font-semibold text-gray-900">
                    {t("ui.modelToggle.reasoning")}
                  </span>
                  <span
                    className={`ml-auto font-medium ${previewLevel ? "text-gray-500" : "text-gray-900"}`}
                  >
                    {reasoningName(previewLevel ?? reasoningLevel)}
                  </span>
                </div>
                <ReasoningLadderUI
                  ref={ladderRef}
                  levels={reasoningLevels}
                  level={reasoningLevel}
                  label={t("ui.modelToggle.reasoningLevel")}
                  valueText={reasoningName(reasoningLevel)}
                  onPreview={setPreviewLevel}
                  onChange={(next, source) => {
                    setLevelChangeInstant(source !== "pointer");
                    setPreviewLevel(null);
                    onReasoningChange(next);
                  }}
                />
                <div
                  aria-hidden="true"
                  className="mt-1 flex justify-between text-2xs text-gray-500"
                >
                  <span>{reasoningName(reasoningLevels[0] ?? "none")}</span>
                  <span>
                    {reasoningName(reasoningLevels.at(-1) ?? reasoningLevel)}
                  </span>
                </div>
              </div>
            </DropdownItem>
          </div>
        )}
      </DropdownContent>
    </Dropdown>
  );
}
