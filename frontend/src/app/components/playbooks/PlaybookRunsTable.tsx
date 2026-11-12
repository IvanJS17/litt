"use client";

import { useMemo, useState } from "react";
import {
  ClipboardCheck,
  Eye,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import { RowActions } from "@/app/components/shared/RowActions";
import {
  SkeletonLine,
  TABLE_CHECKBOX_CLASS,
  TableBody,
  TableCell,
  TableEmptyState,
  TableFilters,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  TableScrollArea,
  type TableFilterOption,
} from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import type { PlaybookRunListItem } from "@/app/lib/mikeApi";
import { DropdownItem, PillButtonUI } from "@mike/ui";
import { formatDateTime, runOutcome, runTitle } from "./PlaybookRuns";
import { useFormatter, useTranslations } from "next-intl";

// The document takes the free width; the details sit together on the right,
// as in the playbooks table.
const DOCUMENT_COLUMN = "flex min-w-64 flex-1 items-center gap-2 pl-3 pr-4";
const PLAYBOOK_COLUMN = "w-52 shrink-0 pr-4";
const OUTCOME_COLUMN = "w-40 shrink-0 pr-4";
const SCOPE_COLUMN = "w-28 shrink-0 pr-4";
const POSTURE_COLUMN = "w-28 shrink-0 pr-4";
const DATE_COLUMN = "w-40 shrink-0 pr-4";
const ACTIONS_COLUMN = "w-8 shrink-0 justify-end";
const DETAIL_TEXT = "truncate text-xs text-gray-600";
const TABLE_MIN_WIDTH = "min-w-[64rem]";

type Outcome = "issues" | "clear" | "running" | "failed";

function outcomeOf(run: PlaybookRunListItem): Outcome {
  if (run.error || run.status === "failed") return "failed";
  if (run.status !== "completed") return "running";
  return run.findings.some(
    (finding) =>
      finding.status === "unacceptable" ||
      finding.status === "missing_required" ||
      finding.status === "needs_review",
  )
    ? "issues"
    : "clear";
}

type Filters = {
  playbook: string | null;
  outcome: Outcome | null;
  scope: "full" | "issues" | null;
  posture: "strict" | "permissive" | null;
};
const NO_FILTERS: Filters = {
  playbook: null,
  outcome: null,
  scope: null,
  posture: null,
};

export type PlaybookRunActionHandlers = {
  /** Opens the run on its playbook's Runs tab. */
  onOpen: (run: PlaybookRunListItem) => void;
  onOpenPlaybook: (run: PlaybookRunListItem) => void;
  /** Deletes the runs, after confirmation. */
  onDelete: (runs: PlaybookRunListItem[]) => void;
};

type MenuAction = {
  label: string;
  icon: LucideIcon;
  run: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/**
 * The one run menu: the row button, the row's context menu, and the toolbar's
 * Actions menu all render it. A review still running cannot be deleted.
 */
export function PlaybookRunActionItems({
  runs,
  disabled,
  onActionChosen,
  onDeselect,
  onOpen,
  onOpenPlaybook,
  onDelete,
}: PlaybookRunActionHandlers & {
  runs: PlaybookRunListItem[];
  disabled: boolean;
  onActionChosen: () => void;
  onDeselect?: () => void;
}) {
  const t = useTranslations();
  const [run] = runs;
  const running = runs.some((item) => item.status === "running");
  const actions: MenuAction[] = [
    ...(onDeselect
      ? [{ label: t("playbooks.deselectRows"), icon: X, run: onDeselect }]
      : []),
    ...(runs.length > 1
      ? [
          {
            label: t("playbooks.deleteLengthRuns", { length: runs.length }),
            icon: Trash2,
            run: () => onDelete(runs),
            destructive: true,
            disabled: running,
          },
        ]
      : run
        ? [
            { label: t("playbooks.open"), icon: Eye, run: () => onOpen(run) },
            {
              label: t("playbooks.openPlaybook"),
              icon: ClipboardCheck,
              run: () => onOpenPlaybook(run),
            },
            {
              label: t("playbooks.delete"),
              icon: Trash2,
              run: () => onDelete([run]),
              destructive: true,
              disabled: running,
            },
          ]
        : []),
  ];
  return actions.map((action) => (
    <DropdownItem
      key={action.label}
      disabled={disabled || action.disabled}
      variant={action.destructive ? "destructive" : "default"}
      onPointerUp={(event) => {
        // A context menu may open beneath the pointer before the right
        // button is released; that release must not choose an action.
        if (event.button !== 0) event.preventDefault();
      }}
      onSelect={() => {
        onActionChosen();
        action.run();
      }}
    >
      <action.icon aria-hidden="true" className="h-3.5 w-3.5" />
      {action.label}
    </DropdownItem>
  ));
}

/**
 * The caller's runs across every playbook in the workspace, newest first.
 * Opening a run takes the caller to it on its playbook's Runs tab.
 */
export function PlaybookRunsTable({
  runs,
  error,
  onRetry,
  search,
  disabled,
  selectedIds,
  onSelect,
  onOpen,
  onOpenPlaybook,
  onDelete,
}: PlaybookRunActionHandlers & {
  /** Null while loading. */
  runs: PlaybookRunListItem[] | null;
  error: string | null;
  onRetry: () => void;
  search: string;
  disabled: boolean;
  selectedIds: Set<string>;
  onSelect: (ids: Set<string>) => void;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const outcomeOptions: TableFilterOption<Outcome>[] = [
    { value: "issues", label: t("playbooks.hasIssues") },
    { value: "clear", label: t("playbooks.noIssues") },
    { value: "running", label: t("playbooks.inProgress") },
    { value: "failed", label: t("playbooks.failed") },
  ];
  const scopeOptions: TableFilterOption<"full" | "issues">[] = [
    { value: "full", label: t("playbooks.fullReview") },
    { value: "issues", label: t("playbooks.issuesOnly") },
  ];
  const postureOptions: TableFilterOption<"strict" | "permissive">[] = [
    { value: "strict", label: t("playbooks.strict") },
    { value: "permissive", label: t("playbooks.permissive") },
  ];
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const loading = runs === null;
  const all = useMemo(() => runs ?? [], [runs]);
  const playbookOptions = useMemo(
    () =>
      [...new Map(all.map((run) => [run.playbookId, run.playbookName]))]
        .map(([value, label]) => ({
          value,
          label: label.trim() || t("playbooks.untitledPlaybook"),
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [all, t],
  );
  // A playbook that has left the list stops filtering it.
  const playbookFilter =
    filters.playbook &&
    playbookOptions.some((option) => option.value === filters.playbook)
      ? filters.playbook
      : null;

  const query = search.trim().toLowerCase();
  const searched = all.filter((run) =>
    `${runTitle(run, t)} ${run.playbookName}`.toLowerCase().includes(query),
  );
  const displayed = searched.filter(
    (run) =>
      (!playbookFilter || run.playbookId === playbookFilter) &&
      (!filters.outcome || outcomeOf(run) === filters.outcome) &&
      (!filters.scope || (run.reviewScope ?? "full") === filters.scope) &&
      (!filters.posture || run.reviewMode === filters.posture),
  );

  function changeFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    onSelect(new Set());
  }

  const showFilters = !loading && !error && all.length > 0;
  const handlers = { onOpen, onOpenPlaybook, onDelete };

  // A selected row's menu acts on the whole selection, like the toolbar's.
  function renderActions(run: PlaybookRunListItem, onActionChosen: () => void) {
    const inSelection = selectedIds.has(run.id);
    return (
      <PlaybookRunActionItems
        {...handlers}
        runs={
          inSelection
            ? displayed.filter((item) => selectedIds.has(item.id))
            : [run]
        }
        disabled={disabled}
        onActionChosen={onActionChosen}
        onDeselect={inSelection ? () => onSelect(new Set()) : undefined}
      />
    );
  }

  const allSelected =
    displayed.length > 0 && displayed.every((run) => selectedIds.has(run.id));
  const someSelected =
    displayed.some((run) => selectedIds.has(run.id)) && !allSelected;

  return (
    <TableScrollArea>
      <div
        role="table"
        aria-label={t("playbooks.playbookRuns")}
        aria-busy={loading}
        className="flex min-h-full min-w-0 flex-col"
      >
        <div
          role="rowgroup"
          className={`table-sticky-header sticky top-0 z-[70] ${TABLE_MIN_WIDTH}`}
        >
          <TableHeaderRow role="row" className="min-w-0">
            <TableHeaderCell role="columnheader" className={DOCUMENT_COLUMN}>
              <input
                type="checkbox"
                aria-label={t("playbooks.selectAllRuns")}
                className={TABLE_CHECKBOX_CLASS}
                disabled={loading || disabled || !displayed.length}
                checked={allSelected}
                ref={(node) => {
                  if (node) node.indeterminate = someSelected;
                }}
                onChange={(event) =>
                  onSelect(
                    event.target.checked
                      ? new Set(displayed.map((run) => run.id))
                      : new Set(),
                  )
                }
              />
              {t("playbooks.document")}
            </TableHeaderCell>
            <TableHeaderCell
              role="columnheader"
              className={`${PLAYBOOK_COLUMN} gap-1`}
            >
              <span>{t("playbooks.playbook")}</span>
              {showFilters && (
                <TableFilters
                  label={t("playbooks.filterByPlaybook")}
                  value={playbookFilter}
                  allLabel={t("playbooks.allPlaybooks")}
                  widthClassName="w-52"
                  options={playbookOptions}
                  onChange={(value) => changeFilter("playbook", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell
              role="columnheader"
              className={`${OUTCOME_COLUMN} gap-1`}
            >
              <span>{t("playbooks.outcome")}</span>
              {showFilters && (
                <TableFilters
                  label={t("playbooks.filterByOutcome")}
                  value={filters.outcome}
                  allLabel={t("playbooks.allOutcomes")}
                  widthClassName="w-44"
                  options={outcomeOptions}
                  onChange={(value) => changeFilter("outcome", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell
              role="columnheader"
              className={`${SCOPE_COLUMN} gap-1`}
            >
              <span>{t("playbooks.scope")}</span>
              {showFilters && (
                <TableFilters
                  label={t("playbooks.filterByScope")}
                  value={filters.scope}
                  allLabel={t("playbooks.allScopes")}
                  widthClassName="w-40"
                  options={scopeOptions}
                  onChange={(value) => changeFilter("scope", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell
              role="columnheader"
              className={`${POSTURE_COLUMN} gap-1`}
            >
              <span>{t("playbooks.posture")}</span>
              {showFilters && (
                <TableFilters
                  label={t("playbooks.filterByPosture")}
                  value={filters.posture}
                  allLabel={t("playbooks.allPostures")}
                  widthClassName="w-40"
                  options={postureOptions}
                  onChange={(value) => changeFilter("posture", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell role="columnheader" className={DATE_COLUMN}>
              {t("playbooks.run")}
            </TableHeaderCell>
            <TableHeaderCell role="columnheader" className={ACTIONS_COLUMN}>
              <span className="sr-only">{t("playbooks.actions")}</span>
            </TableHeaderCell>
          </TableHeaderRow>
        </div>
        {loading ? (
          <TableBody role="rowgroup" className={TABLE_MIN_WIDTH}>
            {Array.from({ length: 6 }, (_, index) => (
              <TableRow
                key={index}
                role="row"
                className="min-w-0"
                interactive={false}
              >
                <TableCell role="cell" className={DOCUMENT_COLUMN}>
                  <span className="mr-1 h-2.5 w-2.5 shrink-0 rounded bg-gray-200 animate-pulse" />
                  <SkeletonLine className="w-44" />
                </TableCell>
                <TableCell role="cell" className={PLAYBOOK_COLUMN}>
                  <SkeletonLine className="w-32" />
                </TableCell>
                <TableCell role="cell" className={OUTCOME_COLUMN}>
                  <SkeletonLine className="w-24" />
                </TableCell>
                <TableCell role="cell" className={SCOPE_COLUMN}>
                  <SkeletonLine className="w-16" />
                </TableCell>
                <TableCell role="cell" className={POSTURE_COLUMN}>
                  <SkeletonLine className="w-12" />
                </TableCell>
                <TableCell role="cell" className={DATE_COLUMN}>
                  <SkeletonLine className="w-28" />
                </TableCell>
                <TableCell role="cell" className={ACTIONS_COLUMN}>
                  <SkeletonLine className="w-4" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        ) : error ? (
          <TableEmptyState>
            <EmptyState
              tone="error"
              title={t("playbooks.couldntLoadRuns")}
              description={error}
              action={
                <PillButtonUI tone="white" onClick={onRetry}>
                  {t("playbooks.tryAgain")}
                </PillButtonUI>
              }
            />
          </TableEmptyState>
        ) : searched.length === 0 ? (
          <TableEmptyState>
            <EmptyState
              title={query ? t("playbooks.noMatchingRuns") : t("playbooks.noRunsYet")}
              description={
                query
                  ? t("playbooks.tryAnotherDocumentOrPlaybookName")
                  : t("playbooks.reviewsYouRunWithAPlaybook")
              }
            />
          </TableEmptyState>
        ) : displayed.length === 0 ? (
          <TableEmptyState>
            <EmptyState
              title={t("playbooks.noMatchingRuns")}
              description={t("playbooks.adjustTheTableFiltersToSee")}
              action={
                <PillButtonUI
                  tone="white"
                  onClick={() => {
                    setFilters(NO_FILTERS);
                    onSelect(new Set());
                  }}
                >
                  {t("playbooks.clearFilters")}
                </PillButtonUI>
              }
            />
          </TableEmptyState>
        ) : (
          <TableBody role="rowgroup" className={TABLE_MIN_WIDTH}>
            {displayed.map((run) => (
              <TableRow
                key={run.id}
                role="row"
                className="min-w-0"
                selected={selectedIds.has(run.id)}
                aria-selected={selectedIds.has(run.id)}
                interactive={!disabled}
                rightClickDropdown={
                  disabled ? undefined : (close) => renderActions(run, close)
                }
                onClick={() => {
                  if (!disabled) onOpen(run);
                }}
              >
                <TableCell role="cell" className={DOCUMENT_COLUMN}>
                  <input
                    type="checkbox"
                    aria-label={t("playbooks.selectName", { name: runTitle(run, t) })}
                    className={TABLE_CHECKBOX_CLASS}
                    disabled={disabled}
                    checked={selectedIds.has(run.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) => {
                      const next = new Set(selectedIds);
                      if (event.target.checked) next.add(run.id);
                      else next.delete(run.id);
                      onSelect(next);
                    }}
                  />
                  <FileTypeIcon
                    fileType={run.documentName ?? ""}
                    className="h-3.5 w-3.5"
                  />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(run);
                    }}
                    title={runTitle(run, t)}
                    className="min-w-0 truncate rounded text-left text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                  >
                    {runTitle(run, t)}
                  </button>
                </TableCell>
                <TableCell
                  role="cell"
                  className={`${PLAYBOOK_COLUMN} ${DETAIL_TEXT}`}
                  title={run.playbookName}
                >
                  {run.playbookName || t("playbooks.untitledPlaybook")}
                </TableCell>
                <TableCell
                  role="cell"
                  className={`${OUTCOME_COLUMN} ${DETAIL_TEXT}`}
                >
                  {runOutcome(run, t)}
                </TableCell>
                <TableCell
                  role="cell"
                  className={`${SCOPE_COLUMN} ${DETAIL_TEXT}`}
                >
                  {run.reviewScope === "issues" ? t("playbooks.issuesOnly") : t("playbooks.fullReview")}
                </TableCell>
                <TableCell
                  role="cell"
                  className={`${POSTURE_COLUMN} ${DETAIL_TEXT}`}
                >
                  {run.reviewMode === "permissive" ? t("playbooks.permissive") : t("playbooks.strict")}
                </TableCell>
                <TableCell
                  role="cell"
                  className={`${DATE_COLUMN} ${DETAIL_TEXT}`}
                >
                  <time dateTime={run.startedAt}>
                    {formatDateTime(format, run.startedAt)}
                  </time>
                </TableCell>
                <TableCell role="cell" className={ACTIONS_COLUMN}>
                  {disabled ? (
                    <span
                      aria-hidden="true"
                      className="flex h-6 w-6 items-center justify-center text-xs text-gray-400"
                    >
                      ···
                    </span>
                  ) : (
                    <RowActions
                      ariaLabel={t("playbooks.actionsForName", { name: runTitle(run, t) })}
                      renderItems={(onActionChosen) =>
                        renderActions(run, onActionChosen)
                      }
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        )}
      </div>
    </TableScrollArea>
  );
}
