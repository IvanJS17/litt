"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  UserRound,
  UserRoundCheck,
} from "lucide-react";
import { Modal } from "@/app/components/modals/Modal";
import { ModalSelect } from "@/app/components/modals/ModalSelect";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import { MfaVerificationPopup } from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import {
  ChatSkeuoIcon,
  LibrarySkeuoIcon,
  OrganizationSkeuoIcon,
  TabularReviewSkeuoIcon,
  WorkflowSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";
import { FileTypeIcon } from "@/app/components/shared/FileTypeIcon";
import {
  ClosedProjectSvgIcon,
  ProjectSvgIcon,
} from "@/app/components/shared/FolderSvgIcon";
import { HeaderActionsMenu } from "@/app/components/shared/HeaderActionsMenu";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import {
  SkeletonCheckbox,
  SkeletonLine,
  TABLE_CHECKBOX_CLASS,
  TableBody,
  TableCell,
  TableEmptyState,
  TableHeaderCell,
  TableHeaderRow,
  TablePrimaryCell,
  TableRow,
  TableScrollArea,
  TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import { EmptyState } from "@/app/components/ui/empty-state";
import { LIQUID_GLASS_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import {
  deleteOrgDepartureArchives,
  isMfaRequiredError,
  listOrgDepartures,
  reassignOrgDepartureArchives,
  type OrgDeparture,
  type OrgDepartureItem,
  type OrgDepartureList,
  type OrgMember,
} from "@/app/lib/mikeApi";
import { notifySuccess, userFacingApiError } from "@/app/lib/userFacingError";
import { cn } from "@/app/lib/utils";
import { DropdownItem } from "@mike/ui";
import { useIdSet } from "@/app/hooks/useIdSet";
import { useFormatter, useTranslations } from "next-intl";
import type { SettingsKey, Translate } from "@/i18n/Translate";

type Kind = OrgDepartureItem["kind"];

/** The types of work, in the order a departure lists them. */
const KIND_GROUPS: { kind: Kind }[] = [
  { kind: "project" },
  { kind: "workflow" },
  { kind: "chat" },
  { kind: "tabular_review" },
  { kind: "document" },
];

/** The catalog messages each type of work reads. */
const KIND_KEYS = {
  project: {
    label: "organizations.organizationDepartedMembers.kind.project.label",
    owned: "organizations.organizationDepartedMembers.kind.project.owned",
    ownedName: "organizations.organizationDepartedMembers.kind.project.ownedName",
  },
  workflow: {
    label: "organizations.organizationDepartedMembers.kind.workflow.label",
    owned: "organizations.organizationDepartedMembers.kind.workflow.owned",
    ownedName: "organizations.organizationDepartedMembers.kind.workflow.ownedName",
  },
  chat: {
    label: "organizations.organizationDepartedMembers.kind.chat.label",
    owned: "organizations.organizationDepartedMembers.kind.chat.owned",
    ownedName: "organizations.organizationDepartedMembers.kind.chat.ownedName",
  },
  tabular_review: {
    label: "organizations.organizationDepartedMembers.kind.tabularReview.label",
    owned: "organizations.organizationDepartedMembers.kind.tabularReview.owned",
    ownedName: "organizations.organizationDepartedMembers.kind.tabularReview.ownedName",
  },
  document: {
    label: "organizations.organizationDepartedMembers.kind.document.label",
    owned: "organizations.organizationDepartedMembers.kind.document.owned",
    ownedName: "organizations.organizationDepartedMembers.kind.document.ownedName",
  },
} as const satisfies Record<Kind, Record<string, SettingsKey>>;

/** A deadline this close is drawn in the warning colour. */
const SOON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What an action is about to be applied to, and how to name it. */
interface Target {
  ids: string[];
  label: string;
}

type DateFormatter = (value: string) => string;

function deadline(t: Translate, formatDate: DateFormatter, expiresAt: string, now: number) {
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / DAY_MS);
  const distance =
    days <= 0
      ? t("organizations.organizationDepartedMembers.deadline.today")
      : days === 1
        ? t("organizations.organizationDepartedMembers.deadline.tomorrow")
        : t("organizations.organizationDepartedMembers.deadline.inDays", { days });
  return {
    text: t("organizations.organizationDepartedMembers.deadline.line", {
      date: formatDate(expiresAt),
      distance,
    }),
    soon: days <= SOON_DAYS,
  };
}

/** What a project or workflow holds; nothing for the other kinds. */
function contentsLabel(t: Translate, item: OrgDepartureItem) {
  if (!item.contents) return "";
  const parts = [
    item.contents.documents > 0 &&
      t("organizations.organizationDepartedMembers.itemContents.documents", { count: item.contents.documents }),
    item.contents.chats > 0 &&
      t("organizations.organizationDepartedMembers.itemContents.chats", { count: item.contents.chats }),
    item.contents.tabular_reviews > 0 &&
      t("organizations.organizationDepartedMembers.itemContents.reviews", { count: item.contents.tabular_reviews }),
  ].filter(Boolean);
  if (parts.length) return parts.join(", ");
  // A workflow with no files of its own still has its steps.
  return item.kind === "project"
    ? t("organizations.organizationDepartedMembers.itemContents.empty")
    : "";
}

/** A deleted account leaves no name behind. */
const departedName = (t: Translate, departure: OrgDeparture) =>
  departure.member?.display_name ||
  departure.member?.email ||
  t("organizations.organizationDepartedMembers.formerMember");

const ICON_CLASS = "mr-2 h-4 w-4 shrink-0";

/**
 * The name cell's tree. Every checkbox stays in the one column at the left
 * edge; only what follows it steps in, by the width of a chevron and its
 * gap, so a row's icon sits under its parent's.
 */
const LABEL_INDENT_CLASS = ["", "pl-6", "pl-12"] as const;

/** The icon each type of work has elsewhere in the app. */
function KindIcon({
  kind,
  filename,
  open = false,
}: {
  kind: Kind;
  /** A library file's own name picks its file-type icon. */
  filename?: string;
  /** A type's row opens like a folder. */
  open?: boolean;
}) {
  if (kind === "project")
    return filename === undefined ? (
      <ProjectSvgIcon open={open} className={ICON_CLASS} />
    ) : (
      <ClosedProjectSvgIcon className={ICON_CLASS} />
    );
  if (kind === "workflow") return <WorkflowSkeuoIcon className={ICON_CLASS} />;
  if (kind === "chat") return <ChatSkeuoIcon className={ICON_CLASS} />;
  if (kind === "tabular_review")
    return <TabularReviewSkeuoIcon className={ICON_CLASS} />;
  return filename === undefined ? (
    <LibrarySkeuoIcon className={ICON_CLASS} />
  ) : (
    <FileTypeIcon fileType={filename} className={ICON_CLASS} />
  );
}

const CHEVRON_BUTTON_CLASS =
  "mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/**
 * The Departed view of an organization's Members page: the private work its
 * former members left, held for 30 days, for an owner to hand to somebody or
 * delete. Only owners are shown it, and the API checks that for itself.
 *
 * One row per departure, with the person, when they left and when their work
 * is deleted. It starts closed, and opens into the types of work and then the
 * items, so an owner can hand over everything at once or pick it apart. Selection is
 * always of items: selecting a person or a type selects what is under it.
 *
 * `renderToolbar` draws the page's tabs, so this view's selection actions sit
 * beside them as the roster's do.
 */
export function OrganizationDepartedMembers({
  orgId,
  members,
  search,
  renderToolbar,
}: {
  orgId: string;
  /** The roster, to choose a new owner from. */
  members: OrgMember[];
  /** Narrows the list to people or items whose name contains it. */
  search: string;
  renderToolbar: (actions?: ReactNode) => ReactNode;
}) {
  const t = useTranslations();
  const format = useFormatter();
  const formatDate: DateFormatter = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return format.dateTime(date, { day: "numeric", month: "short", year: "numeric" });
  };
  const [list, setList] = useState<OrgDepartureList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Every row starts closed: a departure opens into its types of work, and
  // a type into its items.
  const [openDepartures, setOpenDepartures] = useState<Set<string>>(
    new Set(),
  );
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reassigning, setReassigning] = useState<Target | null>(null);
  const [successor, setSuccessor] = useState("");
  const [deleting, setDeleting] = useState<Target | null>(null);
  const [mfaTarget, setMfaTarget] = useState<Target | null>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // Fixed for the visit, so a row's "in 12 days" does not change under it.
  const [now] = useState(() => Date.now());
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++requestRef.current;
    try {
      const next = await listOrgDepartures(orgId);
      if (ticket !== requestRef.current) return;
      setList(next);
      setLoadError(null);
    } catch (error) {
      if (ticket !== requestRef.current) return;
      setLoadError(
        userFacingApiError(error, t("organizations.organizationDepartedMembers.couldNotLoadDepartedMembers")),
      );
    }
  }, [orgId, t]);

  useEffect(() => {
    void load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const query = search.trim().toLowerCase();
  const departures = useMemo(() => {
    const all = list?.departures ?? [];
    if (!query) return all;
    return all.flatMap((departure) => {
      const who =
        `${departure.member?.display_name ?? ""} ${departure.member?.email ?? ""}`.toLowerCase();
      if (who.includes(query)) return [departure];
      const items = departure.items.filter((item) =>
        item.title.toLowerCase().includes(query),
      );
      return items.length ? [{ ...departure, items }] : [];
    });
  }, [list, query]);

  // What is selected and still on screen: a search or a reload can take
  // items away, and an action must never reach one that is out of sight.
  const visibleIds = useMemo(
    () => departures.flatMap((departure) => departure.items.map((i) => i.id)),
    [departures],
  );
  const selected = useMemo(() => {
    const visible = new Set(visibleIds);
    return selectedIds.filter((id) => visible.has(id));
  }, [selectedIds, visibleIds]);
  const selectedSet = useIdSet(selected);
  const isSelected = (ids: string[]) =>
    ids.length > 0 && ids.every((id) => selectedSet.has(id));
  const isPartlySelected = (ids: string[]) =>
    !isSelected(ids) && ids.some((id) => selectedSet.has(id));

  function toggle(ids: string[]) {
    const toggled = new Set(ids);
    setSelectedIds(
      isSelected(ids)
        ? selected.filter((id) => !toggled.has(id))
        : [...new Set([...selected, ...ids])],
    );
  }

  function toggleIn(
    setKeys: (update: (current: Set<string>) => Set<string>) => void,
    key: string,
  ) {
    setKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  /** A row inside a larger selection speaks for the whole selection. */
  function actionTarget(target: Target): Target {
    return selected.length > target.ids.length && isSelected(target.ids)
      ? {
          ids: selected,
          label: t("organizations.organizationDepartedMembers.selectedItems", { count: selected.length }),
        }
      : target;
  }

  function openReassign(target: Target) {
    setFailure(null);
    setSuccessor(
      members.find((member) => member.role === "owner")?.user_id ?? "",
    );
    setReassigning(target);
  }

  function openDelete(target: Target) {
    setFailure(null);
    setDeleting(target);
  }

  async function reassign() {
    if (!reassigning || !successor) return;
    setWorking(true);
    try {
      const result = await reassignOrgDepartureArchives(
        orgId,
        reassigning.ids,
        successor,
      );
      const owner = members.find((member) => member.user_id === successor);
      setReassigning(null);
      setSelectedIds([]);
      if (result.unresolved > 0)
        setFailure(
          t("organizations.organizationDepartedMembers.unresolvedReassign", { count: result.unresolved }),
        );
      else
        notifySuccess(
          t("organizations.organizationDepartedMembers.reassignedTo", {
            name: owner?.display_name || owner?.email || t("organizations.organizationDepartedMembers.theSelectedMember"),
          }),
        );
      await load();
    } catch (error) {
      setFailure(userFacingApiError(error, t("organizations.organizationDepartedMembers.couldNotReassignThisWork")));
    } finally {
      setWorking(false);
    }
  }

  async function remove(target: Target) {
    setWorking(true);
    try {
      const result = await deleteOrgDepartureArchives(orgId, target.ids);
      setDeleting(null);
      setSelectedIds([]);
      if (result.unresolved > 0)
        setFailure(
          t("organizations.organizationDepartedMembers.unresolvedDelete", { count: result.unresolved }),
        );
      else notifySuccess(t("organizations.organizationDepartedMembers.archivedWorkDeleted"));
      await load();
    } catch (error) {
      setDeleting(null);
      if (isMfaRequiredError(error)) setMfaTarget(target);
      else setFailure(userFacingApiError(error, t("organizations.organizationDepartedMembers.couldNotDeleteThisWork")));
    } finally {
      setWorking(false);
    }
  }

  /** The same two actions for a row's menu, its right-click and the toolbar. */
  function renderMenuItems(target: Target, close?: () => void) {
    const acting = actionTarget(target);
    const onSelection = acting !== target;
    return (
      <>
        <DropdownItem
          onSelect={() => {
            close?.();
            openReassign(acting);
          }}
        >
          <UserRoundCheck className="h-3.5 w-3.5" />
          {onSelection ? t("organizations.organizationDepartedMembers.reassignSelected") : t("organizations.organizationDepartedMembers.reassign")}
        </DropdownItem>
        <DropdownItem
          variant="destructive"
          onSelect={() => {
            close?.();
            openDelete(acting);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          {onSelection ? t("organizations.organizationDepartedMembers.deleteSelected") : t("settings.privacyData.deleteButton")}
        </DropdownItem>
      </>
    );
  }

  const rowMenu = (target: Target, title: string) => (
    <HeaderActionsMenu
      title={title}
      items={[
        {
          label: t("organizations.organizationDepartedMembers.reassign"),
          icon: UserRoundCheck,
          onSelect: () => openReassign(target),
        },
        {
          label: t("settings.privacyData.deleteButton"),
          icon: Trash2,
          variant: "danger",
          onSelect: () => openDelete(target),
        },
      ]}
    />
  );

  const checkbox = (ids: string[], label: string) => (
    <input
      type="checkbox"
      checked={isSelected(ids)}
      ref={(element) => {
        if (element) element.indeterminate = isPartlySelected(ids);
      }}
      onChange={() => toggle(ids)}
      onClick={(event) => event.stopPropagation()}
      className={TABLE_CHECKBOX_CLASS}
      title={label}
      aria-label={label}
    />
  );

  const loading = list === null && loadError === null;

  return (
    <>
      {renderToolbar(
        selected.length > 0 ? (
          <SelectionActionsMenu
            renderItems={(close) =>
              renderMenuItems(
                {
                  ids: selected,
                  label: t("organizations.organizationDepartedMembers.selectedItems", { count: selected.length }),
                },
                close,
              )
            }
          />
        ) : undefined,
      )}

      <TableScrollArea
        header={
          <TableHeaderRow>
            <TableStickyCell header>
              {loading ? (
                <SkeletonCheckbox />
              ) : (
                checkbox(visibleIds, t("organizations.organizationDepartedMembers.selectAllArchivedWork"))
              )}
              <span className="mr-1">
                {t("organizations.organizationDepartedMembers.name")}
                {list && !loadError ? (
                  <>
                    {" "}
                    <span className="font-normal text-gray-400">
                      ({departures.length})
                    </span>
                  </>
                ) : null}
              </span>
            </TableStickyCell>
            <TableHeaderCell className="ml-auto w-64">{t("organizations.organizationDepartedMembers.email")}</TableHeaderCell>
            <TableHeaderCell className="w-56">{t("organizations.organizationDepartedMembers.contents")}</TableHeaderCell>
            <TableHeaderCell className="w-32">{t("organizations.organizationDepartedMembers.left")}</TableHeaderCell>
            <TableHeaderCell className="w-48">{t("organizations.organizationDepartedMembers.deletes")}</TableHeaderCell>
            <TableHeaderCell className="w-10" />
          </TableHeaderRow>
        }
      >
        {loading ? (
          <TableBody>
            {[1, 2, 3].map((row) => (
              <TableRow key={row} interactive={false}>
                <TableStickyCell hover={false} bgClassName="bg-transparent">
                  <SkeletonCheckbox />
                  <SkeletonLine className="w-40" />
                </TableStickyCell>
                {["w-64", "w-56", "w-32", "w-48", "w-10"].map(
                  (width, index) => (
                    <TableCell
                      key={width}
                      className={cn(index === 0 && "ml-auto", width)}
                    >
                      {width === "w-10" ? null : (
                        <SkeletonLine className="w-20" />
                      )}
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))}
          </TableBody>
        ) : list === null ? (
          <TableEmptyState>
            <EmptyState
              icon={<OrganizationSkeuoIcon />}
              title={t("organizations.organizationDepartedMembers.departedMembers")}
              description={loadError}
              tone="error"
              action={
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(null);
                    void load();
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Loader2 className="h-3.5 w-3.5" />
                  {t("organizations.organizationDepartedMembers.tryAgain")}
                </button>
              }
            />
          </TableEmptyState>
        ) : list.departures.length === 0 ? (
          <TableEmptyState>
            <EmptyState
              icon={<OrganizationSkeuoIcon />}
              title={t("organizations.organizationDepartedMembers.departedMembers")}
              description={t("organizations.organizationDepartedMembers.noWorkIsWaitingForA")}
            />
          </TableEmptyState>
        ) : departures.length === 0 ? (
          <TableEmptyState>
            <p className="text-sm text-gray-400">
              {t("organizations.organizationDepartedMembers.noDepartedMembersOrArchivedWork")}
            </p>
          </TableEmptyState>
        ) : (
          <TableBody>
            {departures.map((departure) => {
              const name = departedName(t, departure);
              const possessive = {
                named: departure.member ? "yes" : "no",
                name,
              };
              const ids = departure.items.map((item) => item.id);
              const target: Target = {
                ids,
                label: departure.member
                  ? t("organizations.organizationDepartedMembers.everythingNameLeft", { name })
                  : t("organizations.organizationDepartedMembers.everythingThisFormerMemberLeft"),
              };
              // A search opens what it found, so a match is never hidden
              // inside a closed row.
              const open = !!query || openDepartures.has(departure.key);
              const due = deadline(t, formatDate, departure.expires_at, now);
              const everySelected = isSelected(ids);
              return [
                <TableRow
                  key={departure.key}
                  interactive={false}
                  selected={everySelected}
                  aria-expanded={open}
                  rightClickDropdown={(close) => renderMenuItems(target, close)}
                  className={
                    !everySelected ? LIQUID_GLASS_HOVER_CLASS : undefined
                  }
                >
                  <TablePrimaryCell
                    selected={everySelected}
                    onSelectionChange={() => toggle(ids)}
                    selectionIndicator={checkbox(
                      ids,
                      t("organizations.organizationDepartedMembers.selectEverythingNameLeft", { name }),
                    )}
                    label={
                      <span className="flex min-w-0 items-center">
                        <button
                          type="button"
                          aria-label={
                            open ? t("organizations.organizationDepartedMembers.collapseName", { name }) : t("organizations.organizationDepartedMembers.expandName", { name })
                          }
                          onClick={() =>
                            toggleIn(setOpenDepartures, departure.key)
                          }
                          className={CHEVRON_BUTTON_CLASS}
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-400" />
                          )}
                        </button>
                        <UserRound
                          aria-hidden="true"
                          className={cn(ICON_CLASS, "text-gray-500")}
                        />
                        <span className="truncate text-xs font-medium text-gray-800">
                          {name}
                        </span>
                      </span>
                    }
                  />
                  <TableCell className="ml-auto w-64">
                    {departure.member
                      ? departure.member.email || "—"
                      : t("organizations.organizationDepartedMembers.accountDeleted")}
                  </TableCell>
                  <TableCell className="w-56">
                    {t("organizations.organizationDepartedMembers.itemCount", { count: departure.items.length })}
                  </TableCell>
                  <TableCell className="w-32">
                    {formatDate(departure.departed_at)}
                  </TableCell>
                  <TableCell
                    className={cn("w-48", due.soon && "text-red-600")}
                  >
                    {due.text}
                  </TableCell>
                  <TableCell className="flex w-10 justify-end overflow-visible">
                    {rowMenu(target, t("organizations.organizationDepartedMembers.actionsFor", { name }))}
                  </TableCell>
                </TableRow>,
                ...(open
                  ? KIND_GROUPS.flatMap((group) => {
                      const items = departure.items.filter(
                        (item) => item.kind === group.kind,
                      );
                      if (!items.length) return [];
                      const groupKey = `${departure.key}|${group.kind}`;
                      const groupIds = items.map((item) => item.id);
                      const groupTarget: Target = {
                        ids: groupIds,
                        label: t(KIND_KEYS[group.kind].owned, { ...possessive, count: items.length }),
                      };
                      const groupOpen = !!query || openGroups.has(groupKey);
                      const groupSelected = isSelected(groupIds);
                      const groupName = t(KIND_KEYS[group.kind].ownedName, possessive);
                      return [
                        <TableRow
                          key={groupKey}
                          interactive={false}
                          selected={groupSelected}
                          aria-expanded={groupOpen}
                          rightClickDropdown={(close) =>
                            renderMenuItems(groupTarget, close)
                          }
                          className={
                            !groupSelected
                              ? LIQUID_GLASS_HOVER_CLASS
                              : undefined
                          }
                        >
                          <TablePrimaryCell
                            selected={groupSelected}
                            onSelectionChange={() => toggle(groupIds)}
                            selectionIndicator={checkbox(
                              groupIds,
                              t("organizations.organizationDepartedMembers.selectName", { name: groupName }),
                            )}
                            label={
                              <span
                                className={cn(
                                  "flex min-w-0 items-center",
                                  LABEL_INDENT_CLASS[1],
                                )}
                              >
                                <button
                                  type="button"
                                  aria-label={
                                    groupOpen
                                      ? t("organizations.organizationDepartedMembers.collapseGroupname", { groupName })
                                      : t("organizations.organizationDepartedMembers.expandGroupname", { groupName })
                                  }
                                  onClick={() =>
                                    toggleIn(setOpenGroups, groupKey)
                                  }
                                  className={CHEVRON_BUTTON_CLASS}
                                >
                                  {groupOpen ? (
                                    <ChevronDown className="h-4 w-4 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 text-gray-400" />
                                  )}
                                </button>
                                <KindIcon kind={group.kind} open={groupOpen} />
                                <span className="truncate text-xs text-gray-700">
                                  {t(KIND_KEYS[group.kind].label)}{" "}
                                  <span className="text-gray-400">
                                    ({items.length})
                                  </span>
                                </span>
                              </span>
                            }
                          />
                          <TableCell className="ml-auto w-64" />
                          <TableCell className="w-56" />
                          <TableCell className="w-32" />
                          <TableCell className="w-48" />
                          <TableCell className="flex w-10 justify-end overflow-visible">
                            {rowMenu(groupTarget, t("organizations.organizationDepartedMembers.actionsFor", { name: groupName }))}
                          </TableCell>
                        </TableRow>,
                        ...(groupOpen
                          ? items.map((item) => {
                              const itemTarget: Target = {
                                ids: [item.id],
                                label: item.title,
                              };
                              const itemSelected = selectedSet.has(item.id);
                              return (
                                <TableRow
                                  key={item.id}
                                  interactive={false}
                                  selected={itemSelected}
                                  rightClickDropdown={(close) =>
                                    renderMenuItems(itemTarget, close)
                                  }
                                  className={
                                    !itemSelected
                                      ? LIQUID_GLASS_HOVER_CLASS
                                      : undefined
                                  }
                                >
                                  <TablePrimaryCell
                                    label={
                                      <span
                                        className={cn(
                                          "flex min-w-0 items-center",
                                          LABEL_INDENT_CLASS[2],
                                        )}
                                      >
                                        <KindIcon
                                          kind={item.kind}
                                          filename={item.title}
                                        />
                                        <span className="truncate">
                                          {item.title}
                                        </span>
                                      </span>
                                    }
                                    selected={itemSelected}
                                    onSelectionChange={() => toggle([item.id])}
                                    checkboxTitle={t("organizations.organizationDepartedMembers.selectName", { name: item.title })}
                                  />
                                  <TableCell className="ml-auto w-64" />
                                  <TableCell className="w-56">
                                    {contentsLabel(t, item)}
                                  </TableCell>
                                  <TableCell className="w-32" />
                                  <TableCell className="w-48" />
                                  <TableCell className="flex w-10 justify-end overflow-visible">
                                    {rowMenu(
                                      itemTarget,
                                      t("organizations.organizationDepartedMembers.actionsFor", { name: item.title }),
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })
                          : []),
                      ];
                    })
                  : []),
              ];
            })}
            {list.truncated ? (
              <p className="px-3 py-3 text-xs text-gray-400">
                {t("organizations.organizationDepartedMembers.onlyTheWorkThatIsDeleted")}
              </p>
            ) : null}
          </TableBody>
        )}
      </TableScrollArea>

      <Modal
        open={reassigning !== null}
        onClose={() => {
          if (!working) setReassigning(null);
        }}
        breadcrumbs={[
          t("organizations.organizationSettingsShell.organization"),
          t("organizations.organizationDepartedMembers.breadcrumb.departedMembers"),
          t("organizations.organizationDepartedMembers.breadcrumb.reassign"),
        ]}
        size="sm"
        cancelAction={{
          label: t("common.cancel"),
          disabled: working,
          onClick: () => setReassigning(null),
        }}
        primaryAction={{
          label: working ? t("organizations.organizationDepartedMembers.reassigning") : t("organizations.organizationDepartedMembers.reassign2"),
          disabled: working || !successor,
          onClick: () => void reassign(),
        }}
      >
        <div className="space-y-4 pb-4">
          <p className="text-sm text-gray-700 [overflow-wrap:anywhere]">
            {t("organizations.organizationDepartedMembers.chooseWhoTakesOverLabelProjects", { label: reassigning?.label ?? "" })}
          </p>
          <ModalSelect
            id="departed-work-owner"
            aria-label={t("organizations.organizationDepartedMembers.reassignTo")}
            value={successor}
            onChange={setSuccessor}
            wrapLabels
            disabled={working}
            options={members.map((member) => ({
              value: member.user_id,
              label: member.display_name || member.email || t("organizations.memberDepartureDialog.unnamedMember"),
              suffix:
                member.display_name && member.email
                  ? `(${member.email})`
                  : undefined,
            }))}
          />
        </div>
      </Modal>
      <ConfirmPopup
        open={deleting !== null}
        title={t("organizations.organizationDepartedMembers.deleteArchivedWork")}
        message={t("organizations.organizationDepartedMembers.confirmDelete", { label: deleting?.label ?? t("organizations.organizationDepartedMembers.thisWork") })}
        confirmLabel={t("settings.privacyData.deleteButton")}
        confirmVariant="danger"
        confirmStatus={working ? "loading" : "idle"}
        onCancel={() => {
          if (!working) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting) void remove(deleting);
        }}
      />
      <MfaVerificationPopup
        open={mfaTarget !== null}
        onCancel={() => setMfaTarget(null)}
        onVerified={() => {
          const target = mfaTarget;
          setMfaTarget(null);
          if (target) void remove(target);
        }}
      />
      <WarningPopup
        open={failure !== null || (loadError !== null && list !== null)}
        title={
          failure !== null
            ? t("organizations.organizationDepartedMembers.archivedWorkNotChanged")
            : t("organizations.organizationDepartedMembers.archivedWorkNotRefreshed")
        }
        message={failure ?? loadError}
        onClose={() => {
          setFailure(null);
          setLoadError(null);
        }}
      />
    </>
  );
}
