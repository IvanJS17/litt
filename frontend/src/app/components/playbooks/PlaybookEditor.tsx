"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FolderMinus,
  FolderOutput,
  FolderPlus,
  Plus,
  Trash2,
} from "lucide-react";
import { PLAYBOOK_LABEL_CLASS } from "./PlaybookField";
import { PlaybookPanels } from "./PlaybookPanels";
import {
  PLAYBOOK_PANE_BODY_CLASS,
  PLAYBOOK_PANE_EMPTY_CLASS,
  PLAYBOOK_PANE_HEADER_CLASS,
  PLAYBOOK_PANE_INSET_CLASS,
  PLAYBOOK_SIDE_HEADER_CLASS,
  PLAYBOOK_SIDE_LIST_CLASS,
  PLAYBOOK_SIDE_TITLE_CLASS,
} from "./playbookPaneStyles";
import {
  PlaybookRuleForm,
  ruleFormTabs,
  type RuleFormTab,
  type UndoableRuleChange,
} from "./PlaybookRuleForm";
import type { PlaybookProvenance } from "./usePlaybookProvenance";
import { EmptyState } from "@/app/components/ui/empty-state";
import { EDITOR_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { dismissToast, showToast } from "@/app/components/ui/toast";
import {
  HeaderActionsMenu,
  type HeaderActionsMenuItem,
} from "@/app/components/shared/HeaderActionsMenu";
import {
  TextButtonUI,
  PillButtonUI,
  TabPillButtonUI,
  DropdownAtPoint,
  DropdownItem,
} from "@mike/ui";
import { setRowDragPreview } from "@/app/lib/rowDragPreview";
import { movePlaybookRule, type RuleDropTarget } from "./playbookRuleMoves";
import { createPlaybookRule } from "./playbookRules";
import type { PlaybookContent, PlaybookRule } from "@/app/lib/mikeApi";
import { useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";

const RULE_BUTTON_CLASS =
  "grid w-full min-w-0 cursor-pointer grid-cols-[12px_minmax(0,1fr)] items-center gap-2 rounded-lg py-1.5 text-left text-xs transition-colors";

const RULE_DRAG_TYPE = "application/x-mike-playbook-rule";
type ContextTarget = { topicId: string | null; ruleId?: string };

function ruleDisplayName(rule: PlaybookRule, t: NsTranslate<"playbooks">) {
  return rule.name.trim() || t("playbooks.untitledRule");
}

export function PlaybookEditor({
  content,
  onChange,
  selectedRuleId,
  onSelectRule,
  disabled,
  provenance,
  children,
}: {
  content: PlaybookContent;
  onChange: (content: PlaybookContent) => void;
  selectedRuleId: string | null;
  onSelectRule: (id: string | null) => void;
  disabled: boolean;
  /** LiTT: what drafted rules' origins show; see usePlaybookProvenance. */
  provenance?: PlaybookProvenance;
  children?: ReactNode;
}) {
  const t = useTranslations();
  const [expandedTopics, setExpandedTopics] = useState(
    () => new Set(content.topics.map((topic) => topic.id)),
  );
  const [newTopicId, setNewTopicId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<
    (ContextTarget & { x: number; y: number }) | null
  >(null);
  const [draggedRuleId, setDraggedRuleId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<RuleDropTarget | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const contextFocus = useRef<HTMLElement | null>(null);
  const ruleNameId = useId();
  const ruleBodyRef = useRef<HTMLDivElement>(null);
  // Kept across rules so someone working through positions stays there.
  const [ruleTab, setRuleTab] = useState<RuleFormTab>("details");
  const ungroupedRules = content.rules ?? [];
  const rules = [
    ...ungroupedRules,
    ...content.topics.flatMap((topic) => topic.rules),
  ];
  const selectedRule =
    rules.find((rule) => rule.id === selectedRuleId) ?? rules[0];

  function addRule(topicId?: string) {
    if (disabled) return;
    const rule = createPlaybookRule(rules.length + 1);
    onChange({
      ...content,
      rules: topicId ? ungroupedRules : [...ungroupedRules, rule],
      topics: topicId
        ? content.topics.map((topic) =>
            topic.id === topicId
              ? { ...topic, rules: [...topic.rules, rule] }
              : topic,
          )
        : content.topics,
    });
    if (topicId) setExpandedTopics((current) => new Set([...current, topicId]));
    onSelectRule(rule.id);
  }

  function addTopic() {
    if (disabled) return;
    const id = `topic-${crypto.randomUUID()}`;
    onChange({
      ...content,
      topics: [...content.topics, { id, name: t("playbooks.newTopic"), rules: [] }],
    });
    setExpandedTopics((current) => new Set([...current, id]));
    setNewTopicId(id);
  }

  function moveRule(ruleId: string, target: RuleDropTarget) {
    if (disabled) return;
    const next = movePlaybookRule(content, ruleId, target);
    if (next === content) return;
    onChange(next);
    onSelectRule(ruleId);
    if (target.topicId)
      setExpandedTopics((current) => new Set([...current, target.topicId!]));
  }

  function deleteRule(ruleId: string) {
    if (disabled) return;
    const remainingRules = ungroupedRules.filter((rule) => rule.id !== ruleId);
    const topics = content.topics.map((topic) => ({
      ...topic,
      rules: topic.rules.filter((rule) => rule.id !== ruleId),
    }));
    onChange({ ...content, rules: remainingRules, topics });
    if (selectedRule?.id !== ruleId) return;
    const nextTopic = topics.find((topic) => topic.rules.length > 0);
    onSelectRule(remainingRules[0]?.id ?? nextTopic?.rules[0]?.id ?? null);
    if (!remainingRules.length && nextTopic)
      setExpandedTopics((current) => new Set([...current, nextTopic.id]));
  }

  function duplicateRule(ruleId: string) {
    if (disabled) return;
    const source = rules.find((rule) => rule.id === ruleId);
    if (!source) return;
    const copy: PlaybookRule = {
      ...structuredClone(source),
      id: `rule-${crypto.randomUUID()}`,
      name: t("playbooks.ruleCopy", { name: ruleDisplayName(source, t) }),
    };
    const insertCopy = (siblings: PlaybookRule[]) =>
      siblings.flatMap((rule) => (rule.id === ruleId ? [rule, copy] : [rule]));
    onChange({
      ...content,
      rules: insertCopy(ungroupedRules),
      topics: content.topics.map((topic) => ({
        ...topic,
        rules: insertCopy(topic.rules),
      })),
    });
    const topic = content.topics.find((entry) =>
      entry.rules.some((rule) => rule.id === ruleId),
    );
    if (topic) setExpandedTopics((current) => new Set([...current, topic.id]));
    onSelectRule(copy.id);
  }

  function removeTopic(topicId: string) {
    if (disabled) return;
    const topic = content.topics.find((entry) => entry.id === topicId);
    if (!topic) return;
    onChange({
      ...content,
      rules: [...ungroupedRules, ...topic.rules],
      topics: content.topics.filter((entry) => entry.id !== topicId),
    });
  }

  /** The open rule's own menu; adding, editing and ordering are the list's. */
  function openRuleActions(ruleId: string): HeaderActionsMenuItem[] {
    return [
      {
        label: t("playbooks.duplicateRule"),
        icon: Copy,
        disabled,
        onSelect: () => duplicateRule(ruleId),
      },
      {
        label: t("playbooks.deleteRule"),
        icon: Trash2,
        variant: "danger",
        disabled,
        onSelect: () => deleteRule(ruleId),
      },
    ];
  }

  /**
   * A row's menu in the list. A rule's offers what acts on it, and takes it
   * out of its topic; dragging reorders it and puts it into a topic. Clicking
   * the row already opens the rule.
   */
  function menuActions(target: ContextTarget): HeaderActionsMenuItem[] {
    if (target.ruleId) {
      const ruleId = target.ruleId;
      const [duplicate, remove] = openRuleActions(ruleId);
      return [
        duplicate,
        ...(target.topicId
          ? [
              {
                label: t("playbooks.moveOutOfTopic"),
                icon: FolderOutput,
                disabled,
                onSelect: () => moveRule(ruleId, { topicId: null }),
              },
            ]
          : []),
        remove,
      ];
    }
    if (target.topicId) {
      const topicId = target.topicId;
      return [
        {
          label: t("playbooks.addRule"),
          icon: Plus,
          disabled,
          onSelect: () => addRule(topicId),
        },
        {
          label: t("playbooks.removeTopicKeepRules"),
          icon: FolderMinus,
          disabled,
          onSelect: () => removeTopic(topicId),
        },
      ];
    }
    return [
      { label: t("playbooks.addRule"), icon: Plus, disabled, onSelect: () => addRule() },
      { label: t("playbooks.addTopic"), icon: FolderPlus, disabled, onSelect: addTopic },
    ];
  }

  function openContext(event: MouseEvent<HTMLElement>, target: ContextTarget) {
    event.preventDefault();
    event.stopPropagation();
    contextFocus.current =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>("button, input, [tabindex]") ??
          event.currentTarget)
        : event.currentTarget;
    setContextMenu({ ...target, x: event.clientX, y: event.clientY });
  }

  function contextKey(
    event: KeyboardEvent<HTMLElement>,
    target: ContextTarget,
  ) {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
      return;
    event.preventDefault();
    event.stopPropagation();
    contextFocus.current =
      event.target instanceof HTMLElement ? event.target : event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    setContextMenu({ ...target, x: rect.left, y: rect.bottom });
  }

  function isRuleDrag(event: DragEvent<HTMLElement>) {
    return (
      !disabled &&
      !!draggedRuleId &&
      Array.from(event.dataTransfer.types).includes(RULE_DRAG_TYPE)
    );
  }

  function dragOver(event: DragEvent<HTMLElement>, target: RuleDropTarget) {
    if (!isRuleDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTarget((current) =>
      current?.topicId === target.topicId &&
      current?.ruleId === target.ruleId &&
      current?.position === target.position
        ? current
        : target,
    );
  }

  function finishDrag() {
    setDraggedRuleId(null);
    setDropTarget(null);
  }

  function dropRule(event: DragEvent<HTMLElement>, target: RuleDropTarget) {
    if (!isRuleDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.getData(RULE_DRAG_TYPE) === draggedRuleId)
      moveRule(draggedRuleId!, target);
    finishDrag();
  }

  function rowTarget(
    event: DragEvent<HTMLElement>,
    target: ContextTarget,
  ): RuleDropTarget {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      ...target,
      position:
        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    };
  }

  function replaceRule(next: PlaybookRule) {
    onChange({
      ...content,
      rules: ungroupedRules.map((rule) => (rule.id === next.id ? next : rule)),
      topics: content.topics.map((topic) => ({
        ...topic,
        rules: topic.rules.map((rule) => (rule.id === next.id ? next : rule)),
      })),
    });
  }

  // An Undo runs after later edits, so it reads the props as they are then.
  const latest = useRef({ content, onChange, onSelectRule, disabled });
  useEffect(() => {
    latest.current = { content, onChange, onSelectRule, disabled };
  });
  const undoToasts = useRef(new Set<string>());
  useEffect(() => {
    const toasts = undoToasts.current;
    // The editor remounts for another playbook; its Undo must not reach it.
    return () => toasts.forEach(dismissToast);
  }, []);

  function updateRule(
    ruleId: string,
    recipe: (rule: PlaybookRule) => PlaybookRule,
  ) {
    const current = latest.current;
    if (current.disabled) return;
    let found = false;
    const apply = (list: PlaybookRule[]) =>
      list.map((rule) => {
        if (rule.id !== ruleId) return rule;
        found = true;
        return recipe(rule);
      });
    const next = {
      ...current.content,
      rules: apply(current.content.rules ?? []),
      topics: current.content.topics.map((topic) => ({
        ...topic,
        rules: apply(topic.rules),
      })),
    };
    if (!found) return;
    current.onChange(next);
    current.onSelectRule(ruleId);
  }

  const replaceRuleWithUndo: UndoableRuleChange = (next, message, undo) => {
    replaceRule(next);
    const toastId = showToast({
      tone: "info",
      message,
      durationMs: 8000,
      actions: [
        {
          label: t("playbooks.undo"),
          onClick: () => {
            undoToasts.current.delete(toastId);
            updateRule(next.id, undo);
            // Only positions and their clauses offer an undo.
            setRuleTab("positions");
          },
        },
      ],
    });
    undoToasts.current.add(toastId);
  };

  function ruleButton(rule: PlaybookRule, topicId: string | null = null) {
    const name = ruleDisplayName(rule, t);
    const target = { topicId, ruleId: rule.id };
    const isDropTarget =
      dropTarget?.ruleId === rule.id && rule.id !== draggedRuleId;
    return (
      <div
        key={rule.id}
        onContextMenu={(event) => openContext(event, target)}
        onKeyDown={(event) => contextKey(event, target)}
        onDragOver={(event) => dragOver(event, rowTarget(event, target))}
        onDrop={(event) => dropRule(event, rowTarget(event, target))}
        className={`relative grid min-w-0 grid-cols-[minmax(0,1fr)_24px] items-center gap-2 rounded-lg pr-2 ${selectedRule?.id === rule.id ? "theme-dropdown-selected text-gray-900" : "theme-dropdown-item text-gray-600 hover:text-gray-900"}`}
      >
        <button
          type="button"
          aria-pressed={selectedRule?.id === rule.id}
          onClick={() => onSelectRule(rule.id)}
          draggable={!disabled}
          onDragStart={(event) => {
            if (disabled) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.setData(RULE_DRAG_TYPE, rule.id);
            event.dataTransfer.effectAllowed = "move";
            setRowDragPreview({
              dataTransfer: event.dataTransfer,
              row: event.currentTarget.parentElement!,
              clientX: event.clientX,
              clientY: event.clientY,
            });
            setDraggedRuleId(rule.id);
            setContextMenu(null);
          }}
          onDragOver={(event) => dragOver(event, rowTarget(event, target))}
          onDrop={(event) => dropRule(event, rowTarget(event, target))}
          title={name}
          className={`${RULE_BUTTON_CLASS} ${topicId ? "pl-6" : "pl-2"}`}
        >
          {isDropTarget && (
            <span
              aria-hidden="true"
              className={`pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-interactive ${dropTarget.position === "before" ? "top-0" : "bottom-0"}`}
            />
          )}
          <span
            aria-hidden="true"
            className="h-1 w-1 justify-self-center rounded-full bg-current opacity-50"
          />
          <span className="min-w-0 truncate">{name}</span>
        </button>
        <HeaderActionsMenu
          title={t("playbooks.ruleActionsForName", { name })}
          triggerClassName="h-6 w-6"
          items={menuActions(target)}
          onCloseAutoFocus={(event) => {
            if (newTopicId) event.preventDefault();
          }}
        />
      </div>
    );
  }

  return (
    <PlaybookPanels
      sidebar={
        <section
          ref={sidebarRef}
          tabIndex={0}
          aria-label={t("playbooks.topicsAndRules")}
          onContextMenu={(event) => openContext(event, { topicId: null })}
          onKeyDown={(event) => contextKey(event, { topicId: null })}
          onDragOver={(event) => dragOver(event, { topicId: null })}
          onDrop={(event) => dropRule(event, { topicId: null })}
          onDragEnd={finishDrag}
          onDragLeave={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setDropTarget(null);
          }}
          className={`flex min-h-0 min-w-0 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${EDITOR_SURFACE_CLASS} ${dropTarget?.topicId === null && !dropTarget.ruleId ? "ring-2 ring-inset ring-interactive/40" : ""}`}
        >
          <div
            className={`flex items-center justify-between gap-2 ${PLAYBOOK_SIDE_HEADER_CLASS}`}
          >
            <h2 className={PLAYBOOK_SIDE_TITLE_CLASS}>{t("playbooks.rules")}</h2>
            <div className="flex h-5 items-center gap-1">
              <HeaderActionsMenu
                title={t("playbooks.rulesActions")}
                triggerClassName="h-6 w-6"
                onCloseAutoFocus={(event) => {
                  if (newTopicId) event.preventDefault();
                }}
                items={menuActions({ topicId: null })}
              />
              <TextButtonUI
                size="icon-xs"
                className="h-6"
                aria-label={t("playbooks.addRule")}
                title={t("playbooks.addRule")}
                disabled={disabled}
                onClick={() => addRule()}
              >
                <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              </TextButtonUI>
            </div>
          </div>
          <fieldset
            className={`max-h-64 min-h-0 min-w-0 space-y-1 overflow-y-auto @[48rem]:max-h-none @[48rem]:flex-1 ${PLAYBOOK_SIDE_LIST_CLASS}`}
          >
            <legend className="sr-only">{t("playbooks.chooseARule")}</legend>
            {rules.length === 0 && content.topics.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-gray-500">
                {t("playbooks.addARuleToGetStarted")}
              </p>
            )}
            {ungroupedRules.map((rule) => ruleButton(rule))}
            {content.topics.map((topic, topicIndex) => (
              <div key={topic.id} className="space-y-1">
                <div
                  onContextMenu={(event) =>
                    openContext(event, { topicId: topic.id })
                  }
                  onKeyDown={(event) =>
                    contextKey(event, { topicId: topic.id })
                  }
                  onDragOver={(event) => dragOver(event, { topicId: topic.id })}
                  onDrop={(event) => dropRule(event, { topicId: topic.id })}
                  className={`theme-dropdown-item grid min-w-0 grid-cols-[12px_minmax(0,1fr)_24px] items-center gap-2 rounded-lg px-2 ${dropTarget?.topicId === topic.id && !dropTarget.ruleId ? "ring-2 ring-inset ring-interactive/40" : ""}`}
                >
                  <TextButtonUI
                    size="icon-xs"
                    className="h-7 w-3"
                    aria-label={expandedTopics.has(topic.id) ? t("playbooks.collapseTopic", { name: topic.name }) : t("playbooks.expandTopic", { name: topic.name })}
                    aria-expanded={expandedTopics.has(topic.id)}
                    onClick={() =>
                      setExpandedTopics((current) => {
                        const next = new Set(current);
                        if (next.has(topic.id)) next.delete(topic.id);
                        else next.add(topic.id);
                        return next;
                      })
                    }
                  >
                    {expandedTopics.has(topic.id) ? (
                      <ChevronDown aria-hidden="true" className="h-3 w-3" />
                    ) : (
                      <ChevronRight aria-hidden="true" className="h-3 w-3" />
                    )}
                  </TextButtonUI>
                  <input
                    autoFocus={newTopicId === topic.id}
                    onFocus={(event) => {
                      if (newTopicId === topic.id) event.currentTarget.select();
                    }}
                    onBlur={() => setNewTopicId(null)}
                    disabled={disabled}
                    value={topic.name}
                    onChange={(event) =>
                      onChange({
                        ...content,
                        topics: content.topics.map((item) =>
                          item.id === topic.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                    aria-label={t("playbooks.topicName", { n: topicIndex + 1 })}
                    title={topic.name}
                    className="-mx-1 h-7 min-w-0 rounded-md bg-transparent px-1 py-0 text-xs text-gray-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                  />
                  <HeaderActionsMenu
                    title={t("playbooks.topicActionsFor", { name: topic.name || t("playbooks.untitledTopic") })}
                    triggerClassName="h-6 w-6"
                    items={menuActions({ topicId: topic.id })}
                    onCloseAutoFocus={(event) => {
                      if (newTopicId) event.preventDefault();
                    }}
                  />
                </div>
                {expandedTopics.has(topic.id) && (
                  <div className="space-y-1">
                    {topic.rules.map((rule) => ruleButton(rule, topic.id))}
                  </div>
                )}
              </div>
            ))}
          </fieldset>
          {contextMenu && (
            <DropdownAtPoint
              point={contextMenu}
              onClose={() => setContextMenu(null)}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                if (newTopicId) return;
                if (contextFocus.current?.isConnected)
                  contextFocus.current.focus();
                else {
                  const target =
                    sidebarRef.current?.querySelector<HTMLElement>(
                      '[aria-pressed="true"]',
                    ) ?? sidebarRef.current;
                  target?.focus();
                }
              }}
              className="w-56"
            >
              {menuActions(contextMenu).map(({ icon: Icon, ...action }) => (
                <DropdownItem
                  key={action.label}
                  disabled={action.disabled}
                  variant={
                    action.variant === "danger" ? "destructive" : "default"
                  }
                  onPointerUp={(event) => {
                    // Opening the context menu can put an item under the
                    // pointer before the right button is released.
                    if (event.button !== 0) event.preventDefault();
                  }}
                  onSelect={action.onSelect}
                >
                  {Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
                  {action.label}
                </DropdownItem>
              ))}
            </DropdownAtPoint>
          )}
        </section>
      }
    >
      <section
        aria-label={t("playbooks.ruleEditor")}
        className={`@container flex min-h-0 min-w-0 flex-col overflow-hidden ${EDITOR_SURFACE_CLASS}`}
      >
        {selectedRule && (
          <fieldset
            disabled={disabled}
            className={`min-w-0 ${PLAYBOOK_PANE_HEADER_CLASS}`}
          >
            <legend className="sr-only">{t("playbooks.ruleNameAndActions")}</legend>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={ruleNameId}
                  className={`mb-1 block ${PLAYBOOK_LABEL_CLASS}`}
                >
                  {t("playbooks.rule")}
                </label>
                <textarea
                  id={ruleNameId}
                  rows={1}
                  value={selectedRule.name}
                  placeholder={t("playbooks.untitledRule")}
                  onChange={(event) =>
                    replaceRule({
                      ...selectedRule,
                      name: event.target.value.replace(/\s*\n\s*/g, " "),
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.preventDefault();
                  }}
                  className="keyboard-focus-ring block w-full min-w-0 resize-none rounded-md bg-transparent px-0 py-0.5 font-serif text-xl text-gray-900 outline-none transition-colors [field-sizing:content] [overflow-wrap:anywhere] placeholder:text-gray-400 hover:bg-app-surface-hover focus-visible:ring-2 focus-visible:ring-focus disabled:hover:bg-transparent"
                />
              </div>
              <HeaderActionsMenu
                title={t("playbooks.ruleActions")}
                triggerClassName="h-6 w-6 shrink-0"
                items={openRuleActions(selectedRule.id)}
                onCloseAutoFocus={(event) => {
                  if (newTopicId) event.preventDefault();
                }}
              />
            </div>
          </fieldset>
        )}
        {selectedRule && (
          // Outside the disabled fieldset: readers switch sections too.
          <div
            role="group"
            aria-label={t("playbooks.ruleSections")}
            className={`flex shrink-0 flex-wrap gap-1.5 pb-2 ${PLAYBOOK_PANE_INSET_CLASS}`}
          >
            {ruleFormTabs(t).map((tab) => (
              <TabPillButtonUI
                key={tab.id}
                surface="flat"
                active={ruleTab === tab.id}
                onClick={() => {
                  setRuleTab(tab.id);
                  if (ruleBodyRef.current) ruleBodyRef.current.scrollTop = 0;
                }}
              >
                {tab.label}
              </TabPillButtonUI>
            ))}
          </div>
        )}
        <div
          ref={ruleBodyRef}
          data-slot="rule-editor-body"
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto ${selectedRule ? PLAYBOOK_PANE_BODY_CLASS : PLAYBOOK_PANE_EMPTY_CLASS}`}
        >
          <fieldset
            disabled={disabled}
            className={`min-w-0 shrink-0 ${!selectedRule ? "flex flex-1 flex-col justify-center" : ruleTab === "escalation" ? "flex flex-1 flex-col" : ""}`}
          >
            <legend className="sr-only">{t("playbooks.editRule")}</legend>
            {selectedRule ? (
              <PlaybookRuleForm
                key={selectedRule.id}
                tab={ruleTab}
                rule={selectedRule}
                onChange={replaceRule}
                onUndoableChange={replaceRuleWithUndo}
                provenance={provenance}
              />
            ) : (
              <EmptyState
                title={t("playbooks.noRulesYet")}
                description={
                  disabled
                    ? t("playbooks.thisPlaybookHasNoRulesYet")
                    : t("playbooks.addARuleToStartBuilding")
                }
                className="mx-auto w-fit max-w-full py-12"
                action={
                  !disabled && (
                    <PillButtonUI tone="black" onClick={() => addRule()}>
                      <Plus aria-hidden="true" className="h-4 w-4" />
                      {t("playbooks.add")}
                    </PillButtonUI>
                  )
                }
              />
            )}
          </fieldset>
          {children}
        </div>
      </section>
    </PlaybookPanels>
  );
}
