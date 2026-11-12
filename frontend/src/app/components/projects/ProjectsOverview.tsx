"use client";

import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
    getProjectFilterOptions,
    type ProjectFilterOptions,
    updateProject,
    deleteProject,
} from "@/app/lib/mikeApi";
import { deleteTabularReviewsWithConcurrency } from "@/app/lib/deleteTabularReviewsWithConcurrency";
import { restoreOptimisticallyDeletedRows } from "@/app/lib/optimisticRows";
import { useDebouncedValue } from "@/app/hooks/useDebouncedValue";
import {
    usePaginatedProjects,
    type ProjectScope,
} from "@/app/hooks/usePaginatedProjects";
import {
    mergeAccessContacts,
    PermissionDeniedPopup,
    type AccessContact,
} from "@/app/components/popups/PermissionDeniedPopup";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    notifyError,
    notifyPartialFailure,
} from "@/app/lib/userFacingError";
import { useAuth } from "@/app/contexts/AuthContext";
import {
    PERSONAL_WORKSPACE,
    useWorkspaceParam,
} from "@/app/contexts/WorkspaceContext";
import type { Project } from "@/app/components/shared/types";
import { can, roleFrom } from "@/app/lib/permissions";
import { NewProjectModal } from "./NewProjectModal";
import { ProjectDetailsModal } from "./ProjectDetailsModal";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { PAGE_HEADER_TITLE_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { TableLoadMoreRow } from "@/app/components/shared/TableLoadMoreRow";
import {
    ClosedProjectSvgIcon,
    OpenProjectSvgIcon,
} from "@/app/components/shared/FolderSvgIcon";
import {
    TABLE_CHECKBOX_CLASS,
    SkeletonCheckbox,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableFilters,
    TableSortFilter,
    type TableFilterOption,
    TableHeaderCell,
    TableHeaderRow,
    TablePrimaryCell,
    TableRow,
    TableScrollArea,
    rowActionSelectionIds,
    selectedIdsAfterRangeClick,
    selectedIdsAfterShiftClick,
    type TableSortDirection,
    TableStickyCell,
} from "@/app/components/shared/TablePrimitive";
import {
    CreatorLabel,
    CreatorLabelSkeleton,
} from "@/app/components/shared/CreatorLabel";
import {
    PersonFilter,
    localPeople,
    type PersonOption,
} from "@/app/components/shared/PersonFilter";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@mike/ui";
import { useQueryParamTab } from "@/app/hooks/useQueryParamTab";
import { AccessScopeLabel } from "@/app/components/shared/AccessScopeLabel";
import { useIdSet } from "@/app/hooks/useIdSet";
import { indexById } from "@/app/lib/idCollections";
import { useFormatter, useTranslations } from "next-intl";
import type { NsTranslate } from "@/i18n/Translate";
import { formatShortDate } from "@/app/lib/dateText";

/**
 * Who created the row. This is provenance, not permission: what the caller may
 * do here comes from `access_role`, which the overview RPC now returns.
 */
function getProjectCreatorLabel(
    project: Project,
    currentUserId: string | null | undefined,
    t: NsTranslate<"projects">,
) {
    if (project.is_owner ?? project.user_id === currentUserId) return t("projects.me");
    return (
        project.owner_display_name?.trim() ||
        project.owner_email?.trim() ||
        t("projects.shared")
    );
}

// Public: open to the whole organization. Private: everything else, whether
// it is its creator's alone or shared with individuals.
type ProjectFilter = "all" | "private" | "public" | "mine" | "shared";
type ProjectSortKey = "name" | "cm" | "files" | "chats" | "reviews" | "created";

const ORGANIZATION_FILTER_IDS: ProjectFilter[] = ["all", "private", "public"];
const PERSONAL_FILTER_IDS: ProjectFilter[] = ["all", "mine", "shared"];
const PROJECT_FILTER_SCOPES: Record<ProjectFilter, ProjectScope> = {
    all: "all",
    public: "public",
    private: "nonpublic",
    mine: "mine",
    shared: "shared",
};

export function ProjectsOverview() {
    const t = useTranslations();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [modalOpen, setModalOpen] = useState(false);
    const [detailsProject, setDetailsProject] = useState<Project | null>(null);
    const workspace = useWorkspaceParam();
    const isPersonalWorkspace = workspace === PERSONAL_WORKSPACE;
    const format = useFormatter();
    const filterLabels: Record<ProjectFilter, string> = {
        all: t("projects.all"),
        private: t("projects.private"),
        public: t("projects.public"),
        mine: t("projects.myProjects"),
        shared: t("projects.sharedWithMe"),
    };
    const projectFilters = (
        isPersonalWorkspace ? PERSONAL_FILTER_IDS : ORGANIZATION_FILTER_IDS
    ).map((id) => ({ id, label: filterLabels[id] }));
    const accessFilterOptions: TableFilterOption<"public" | "private">[] = [
        { value: "public", label: t("projects.public") },
        { value: "private", label: t("projects.private") },
    ];
    const [activeFilter, setActiveFilter] = useQueryParamTab(
        projectFilters.map((filter) => filter.id),
        "all",
    );
    const [practiceFilter, setPracticeFilter] = useState<string | null>(null);
    const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<{
        key: ProjectSortKey;
        direction: TableSortDirection;
    } | null>(null);
    const [actionsOpen, setActionsOpen] = useState(false);
    const [search, setSearch] = useState("");
    /**
     * A refusal, together with the people who could lift it. Naming somebody
     * is the whole point of the popup, and it can only do that if the surface
     * raising the refusal hands over the row's `admin_contacts` — which the
     * projects overview RPC returns on every row.
     */
    const [ownerOnlyAction, setOwnerOnlyAction] = useState<{
        action: string;
        contacts?: AccessContact[] | null;
    } | null>(null);
    const [selectionCameFromSelectAll, setSelectionCameFromSelectAll] =
        useState(false);
    const [confirmDeleteAllOpen, setConfirmDeleteAllOpen] = useState(false);
    // A project delete takes every document and chat with it and has no
    // undo, so a row's Delete asks first.
    const [projectPendingDelete, setProjectPendingDelete] =
        useState<Project | null>(null);
    const [filterOptions, setFilterOptions] = useState<ProjectFilterOptions>({
        practices: [],
        owners: [],
    });
    const [filterOptionsAttempt, setFilterOptionsAttempt] = useState(0);
    const rowSelectionAnchorIdRef = useRef<string | null>(null);
    const { user, isAuthenticated, authLoading } = useAuth();
    const previewEmptyStates = searchParams.get("emptyStates") === "1";
    const debouncedSearch = useDebouncedValue(search, 250);

    const {
        projects,
        setProjects,
        loading,
        loadingMore,
        hasMore,
        error: loadErrorObj,
        loadMoreError,
        loadMore,
        retry,
        selectedProjectIds: selectedIds,
        setSelectedProjectIds: setSelectedIds,
        selectAllMatching,
        getProjectOwnerId,
    } = usePaginatedProjects({
        search: debouncedSearch,
        selectionKey: search,
        scope: PROJECT_FILTER_SCOPES[activeFilter],
        practiceFilter,
        ownerUserIdFilter: ownerFilter,
        sort,
    });
    const selectedIdSet = useIdSet(selectedIds);
    const loadError = loadErrorObj ? "Could not load projects." : null;
    const effectiveLoading = loading && !previewEmptyStates;
    const visibleProjects = useMemo(
        () => (previewEmptyStates ? [] : projects),
        [previewEmptyStates, projects],
    );

    useEffect(() => {
        if (authLoading || !isAuthenticated) return;
        const controller = new AbortController();
        getProjectFilterOptions(controller.signal, workspace)
            .then((data) => {
                if (!controller.signal.aborted) setFilterOptions(data);
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                // "All Practices" with nothing under it reads as "nobody has
                // set a practice", so the empty dropdown is explained rather
                // than left to be misread.
                notifyError(error, {
                    action: t("projects.loadTheProjectFilters"),
                    dedupeKey: "projects-filter-options",
                    onRetry: () =>
                        setFilterOptionsAttempt((attempt) => attempt + 1),
                });
            });
        return () => {
            controller.abort();
        };
    }, [authLoading, filterOptionsAttempt, isAuthenticated, workspace]);


    const practices = filterOptions.practices;
    const ownerPeople = useMemo<PersonOption[]>(
        () =>
            filterOptions.owners.map((owner) => ({
                user_id: owner.value,
                display_name: owner.display_name ?? owner.label,
                email: owner.email ?? null,
                profile_photo: owner.profile_photo ?? null,
            })),
        [filterOptions.owners],
    );

    const allSelected =
        visibleProjects.length > 0 &&
        visibleProjects.every((p) => selectedIdSet.has(p.id));
    const someSelected =
        !allSelected && visibleProjects.some((p) => selectedIdSet.has(p.id));

    function toggleAll() {
        rowSelectionAnchorIdRef.current = null;
        if (allSelected) {
            setSelectedIds([]);
            setSelectionCameFromSelectAll(false);
        } else {
            setSelectionCameFromSelectAll(true);
            void selectAllMatching();
        }
    }

    function toggleOne(id: string) {
        rowSelectionAnchorIdRef.current = id;
        // A hand-edited selection is no longer "everything matching", as
        // with the range and modifier clicks below.
        setSelectionCameFromSelectAll(false);
        setSelectedIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    }

    function clearSelection() {
        rowSelectionAnchorIdRef.current = null;
        setSelectedIds([]);
        setSelectionCameFromSelectAll(false);
        setConfirmDeleteAllOpen(false);
        setActionsOpen(false);
    }

    function handlePracticeFilterChange(value: string | null) {
        setPracticeFilter(value);
        clearSelection();
    }

    function handleOwnerFilterChange(value: string | null) {
        setOwnerFilter(value);
        clearSelection();
    }

    function handleSortChange(
        key: ProjectSortKey,
        direction: TableSortDirection | null,
    ) {
        setSort(direction ? { key, direction } : null);
        clearSelection();
    }

    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const cmSortDirection = sort?.key === "cm" ? sort.direction : null;
    const filesSortDirection = sort?.key === "files" ? sort.direction : null;
    const chatsSortDirection = sort?.key === "chats" ? sort.direction : null;
    const reviewsSortDirection =
        sort?.key === "reviews" ? sort.direction : null;
    const createdSortDirection =
        sort?.key === "created" ? sort.direction : null;
    const nameFilterButton = (
        <TableSortFilter
            label={t("projects.sortByProjectName")}
            value={nameSortDirection}
            align="right"
            onChange={(direction) => handleSortChange("name", direction)}
        />
    );
    const accessFilterButton = !isPersonalWorkspace && (
        <TableFilters
            label={t("projects.filterByAccess")}
            value={
                activeFilter === "public" || activeFilter === "private"
                    ? activeFilter
                    : null
            }
            allLabel={t("projects.allAccess")}
            widthClassName="w-40"
            options={accessFilterOptions}
            onChange={(value) => {
                setActiveFilter(value ?? "all");
                clearSelection();
            }}
        />
    );
    const cmFilterButton = (
        <TableSortFilter
            label={t("projects.sortByCm")}
            value={cmSortDirection}
            onChange={(direction) => handleSortChange("cm", direction)}
        />
    );
    const practiceFilterButton = (
        <TableFilters
            label={t("projects.filterByPractice")}
            value={practiceFilter}
            allLabel={t("projects.allPractices")}
            options={practices.map((practice) => ({
                value: practice,
                label: practice,
            }))}
            onChange={handlePracticeFilterChange}
        />
    );
    const ownerFilterButton = (
        <PersonFilter
            label={t("projects.filterByCreator")}
            selectedTitle={(name) => `Created by ${name}`}
            value={
                ownerPeople.find((person) => person.user_id === ownerFilter) ??
                null
            }
            onChange={(person) =>
                handleOwnerFilterChange(person?.user_id ?? null)
            }
            loadPeople={localPeople(ownerPeople)}
        />
    );
    const filesFilterButton = (
        <TableSortFilter
            label={t("projects.sortByFiles")}
            value={filesSortDirection}
            onChange={(direction) => handleSortChange("files", direction)}
        />
    );
    const chatsFilterButton = (
        <TableSortFilter
            label={t("projects.sortByChats")}
            value={chatsSortDirection}
            onChange={(direction) => handleSortChange("chats", direction)}
        />
    );
    const reviewsFilterButton = (
        <TableSortFilter
            label={t("projects.sortByTabularReviews")}
            value={reviewsSortDirection}
            onChange={(direction) => handleSortChange("reviews", direction)}
        />
    );
    const createdFilterButton = (
        <TableSortFilter
            label={t("projects.sortByCreatedDate")}
            value={createdSortDirection}
            onChange={(direction) => handleSortChange("created", direction)}
        />
    );

    async function handleProjectDetailsSave(values: {
        name: string;
        cmNumber: string;
        practice: string;
    }) {
        if (!detailsProject) return;
        // The list rows carry the caller's merged access_role, so an
        // organization admin editing a colleague's matter is no longer
        // mistaken for an outsider just because they did not create it.
        if (!can(roleFrom(detailsProject), "access.manage")) {
            setOwnerOnlyAction({
                action: t("projects.editProjectDetails"),
                contacts: detailsProject.admin_contacts,
            });
            return;
        }
        const name = values.name.trim();
        const cmNumber = values.cmNumber.trim();
        const practice = values.practice.trim();
        if (!name) return;
        const updated = await updateProject(detailsProject.id, {
            name,
            cm_number: cmNumber,
            practice: practice || null,
        });
        setProjects((prev) =>
            prev.map((project) =>
                project.id === updated.id
                    ? { ...project, ...updated }
                    : project,
            ),
        );
        setDetailsProject((current) =>
            current?.id === updated.id ? { ...current, ...updated } : current,
        );
    }

    /**
     * Deletes a set of rows optimistically. Rows the server refuses come
     * back, stay selected, and are named in one notice whose Retry re-runs
     * only them — a bulk delete that half-worked must not read as a success.
     */
    async function deleteProjectRows(ids: string[]) {
        if (ids.length === 0) return;
        const snapshot = projects;
        setSelectedIds([]);
        const deletingIds = new Set(ids);
        setProjects((current) =>
            current.filter((project) => !deletingIds.has(project.id)),
        );
        const { failedIds } = await deleteTabularReviewsWithConcurrency(
            ids,
            deleteProject,
        );
        if (failedIds.length === 0) return;
        setProjects((current) =>
            restoreOptimisticallyDeletedRows(current, snapshot, failedIds),
        );
        setSelectedIds(failedIds);
        const failedIdSet = new Set(failedIds);
        const failedNames = snapshot
            .filter((project) => failedIdSet.has(project.id))
            .map((project) => project.name);
        const named = failedNames.length
            ? failedNames.length > 3
                ? t("projects.namesAndMore", {
                      names: failedNames.slice(0, 3).join(", "),
                      count: failedNames.length - 3,
                  })
                : failedNames.join(", ")
            : "";
        notifyPartialFailure(
            named
                ? t("projects.someProjectsCouldntBeDeletedNamed", { failed: failedIds.length, total: ids.length, names: named })
                : t("projects.someProjectsCouldntBeDeleted", { failed: failedIds.length, total: ids.length }),
            {
                action: t("projects.deleteCountProjects", { count: failedIds.length }),
                dedupeKey: "projects-bulk-delete",
                onRetry: () => void deleteProjectRows(failedIds),
            },
        );
    }

    // One question at a time: opening either delete confirmation closes the
    // other, so two dialogs never stack.
    function requestDeleteSelected() {
        setActionsOpen(false);
        setProjectPendingDelete(null);
        setConfirmDeleteAllOpen(true);
    }

    function requestDeleteProject(project: Project) {
        setConfirmDeleteAllOpen(false);
        setProjectPendingDelete(project);
    }

    async function handleDeleteProjectRow(project: Project) {
        const snapshot = projects;
        setProjects((current) =>
            current.filter((candidate) => candidate.id !== project.id),
        );
        try {
            await deleteProject(project.id);
        } catch (error) {
            setProjects((current) =>
                restoreOptimisticallyDeletedRows(current, snapshot, [
                    project.id,
                ]),
            );
            // The row action calls this without awaiting, so rethrowing would
            // only produce an unhandled rejection and a row that reappears
            // with no explanation. The row is back; Retry asks again, as the
            // document panel does, because the delete still has no undo.
            notifyError(error, {
                action: `delete “${project.name}”`,
                dedupeKey: `project-delete:${project.id}`,
                onRetry: () => requestDeleteProject(project),
                supportNote: `Project: ${project.name} (${project.id})`,
            });
        }
    }

    async function handleDeleteSelected() {
        const ids = [...selectedIds];
        setActionsOpen(false);
        setConfirmDeleteAllOpen(false);
        setSelectionCameFromSelectAll(false);
        // Deleting a project needs container.delete, i.e. project admin. The
        // per-row control is already hidden for rows the caller cannot
        // delete, but the bulk action can still pick them up if a user
        // toggled them across filters — or if select-all-matching pulled in
        // ids that were never paged in, which is why creator identity is the
        // fallback when the row itself is not loaded.
        const projectById = indexById(projects);
        const roleById = new Map(
            projects.map((p) => [p.id, roleFrom(p)] as const),
        );
        const deletable = ids.filter((id) => {
            const role = roleById.get(id);
            if (role) return can(role, "container.delete");
            // Unloaded row: creator identity is all we have, and it has to
            // MATCH. `!creatorId ||` treated "we don't know who created this"
            // as permission to delete it, which is the one answer an unknown
            // must never produce — select-all-matching is exactly the path
            // that hands back ids whose rows were never paged in. A row we
            // cannot vouch for is skipped and counted as blocked, so the user
            // is told rather than silently having it dropped.
            const creatorId = getProjectOwnerId(id);
            return !!creatorId && !!user?.id && creatorId === user.id;
        });
        const blocked = ids.length - deletable.length;
        const deletableIds = new Set(deletable);
        // Unchanged from before this action was extracted: the whole
        // selection is cleared even when every row was refused.
        setSelectedIds([]);
        await deleteProjectRows(deletable);
        if (blocked > 0) {
            // Several rows were refused, so offer the union of their admins
            // rather than a refusal that names nobody.
            const blockedContacts = mergeAccessContacts(
                ids
                    .filter((id) => !deletableIds.has(id))
                    .map((id) => projectById.get(id))
                    .map((project) => project?.admin_contacts),
            );
            setOwnerOnlyAction({
                action: t("projects.deleteBlockedProjects", { count: blocked }),
                contacts: blockedContacts,
            });
        }
    }

    function renderProjectActions(
        project: Project | undefined,
        close?: () => void,
    ) {
        const actionIds = project
            ? rowActionSelectionIds(project.id, selectedIds)
            : selectedIds;
        const appliesToSelection = actionIds.length > 1;
        const canManage = project ? can(roleFrom(project), "access.manage") : false;
        return (
            <RowActionMenuItems
                onClose={close}
                onView={
                    appliesToSelection || !project
                        ? undefined
                        : () => router.push(`/projects/${project!.id}`)
                }
                viewLabel={t("projects.open")}
                onEditDetails={
                    appliesToSelection || !canManage
                        ? undefined
                        : () => {
                              setDetailsProject(project!);
                          }
                }
                onDelete={
                    appliesToSelection || !project
                        ? requestDeleteSelected
                        : canManage
                          ? () => requestDeleteProject(project!)
                          : undefined
                }
                deleteLabel={
                    appliesToSelection
                        ? `Delete ${actionIds.length} projects`
                        : undefined
                }
            />
        );
    }

    const toolbarActions =
        selectedIds.length > 0 ? (
            <SelectionActionsMenu
                open={actionsOpen}
                onOpenChange={setActionsOpen}
                renderItems={(close) => renderProjectActions(projects.find((project) => project.id === selectedIds[0]), close)}
            />
        ) : undefined;

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            {/* Page header */}
            <PageHeader
                loading={loading}
                actions={[
                    {
                        type: "search",
                        value: search,
                        onChange: setSearch,
                        placeholder: t("projects.searchProjects"),
                    },
                    {
                        type: "new",
                        onClick: () => setModalOpen(true),
                        title: t("projects.newProject"),
                    },
                ]}
            >
                <h1 className={`${PAGE_HEADER_TITLE_CLASS} text-gray-900`}>
                    {t("projects.projects")}
                </h1>
            </PageHeader>

            <TableToolbar
                items={projectFilters}
                active={activeFilter}
                onChange={(nextFilter) => {
                    setActiveFilter(nextFilter);
                    clearSelection();
                }}
                actions={toolbarActions}
            />

            {/* Table */}
            <TableScrollArea
                onScroll={(event) => {
                    if (loading || loadingMore || !hasMore) return;
                    const el = event.currentTarget;
                    const distanceToBottom =
                        el.scrollHeight - el.scrollTop - el.clientHeight;
                    if (distanceToBottom < 200) void loadMore();
                }}
                header={
                    <TableHeaderRow>
                        <TableStickyCell header>
                            {effectiveLoading ? (
                                <SkeletonCheckbox />
                            ) : (
                                <input
                                    type="checkbox"
                                    checked={allSelected}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someSelected;
                                    }}
                                    onChange={toggleAll}
                                    className={TABLE_CHECKBOX_CLASS}
                                    aria-label={t("projects.selectAllProjects")}
                                />
                            )}
                            <span className="mr-1">{t("projects.name")}</span>
                            {!loading && nameFilterButton}
                        </TableStickyCell>
                        <TableHeaderCell className="ml-auto w-32">
                            <span className="mr-1">{t("projects.access")}</span>
                            {!loading && accessFilterButton}
                        </TableHeaderCell>
                        <TableHeaderCell className="w-32">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.cm")}</span>
                                {!loading && cmFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-36">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.practice")}</span>
                                {!loading && practiceFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-32">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.creator")}</span>
                                {!loading && ownerFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-24">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.files")}</span>
                                {!loading && filesFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-24">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.chats")}</span>
                                {!loading && chatsFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-36">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.tabularReviews")}</span>
                                {!loading && reviewsFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-32">
                            <div className="flex items-center gap-1">
                                <span>{t("projects.created")}</span>
                                {!loading && createdFilterButton}
                            </div>
                        </TableHeaderCell>
                        <TableHeaderCell className="w-8" />
                    </TableHeaderRow>
                }
            >
                {effectiveLoading ? (
                    <TableBody>
                        {[1, 2, 3].map((i) => (
                            <TableRow key={i} interactive={false}>
                                <TableStickyCell
                                    hover={false}
                                    bgClassName="bg-transparent"
                                >
                                    <SkeletonCheckbox />
                                    <div className="mr-2 h-4 w-4 shrink-0 rounded bg-gray-100 animate-pulse" />
                                    <SkeletonLine className="h-3.5 w-48" />
                                </TableStickyCell>
                                <TableCell className="ml-auto w-32">
                                    <SkeletonLine className="w-16" />
                                </TableCell>
                                <TableCell className="w-32">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-36">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-32">
                                    <CreatorLabelSkeleton className="w-16" />
                                </TableCell>
                                <TableCell className="w-24">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-24">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-36">
                                    <SkeletonLine className="w-8" />
                                </TableCell>
                                <TableCell className="w-32">
                                    <SkeletonLine className="w-20" />
                                </TableCell>
                                <TableCell className="w-8" />
                            </TableRow>
                        ))}
                    </TableBody>
                ) : loadError ? (
                    <TableEmptyState>
                        <EmptyState
                            icon={<OpenProjectSvgIcon />}
                            title={t("projects.projects")}
                            description={loadError}
                            tone="error"
                            action={
                                <PillButtonUI
                                    tone="black"
                                    size="sm"
                                    onClick={retry}
                                >
                                    {t("projects.tryAgain")}
                                </PillButtonUI>
                            }
                        />
                    </TableEmptyState>
                ) : visibleProjects.length === 0 ? (
                    <TableEmptyState>
                        {activeFilter === "public" || activeFilter === "shared" ? (
                            <p className="text-sm text-gray-400">
                                {activeFilter === "public"
                                    ? t("projects.noPublicProjects")
                                    : t("projects.noProjectsSharedWithYou")}
                            </p>
                        ) : (
                            <EmptyState
                                icon={<OpenProjectSvgIcon />}
                                title={t("projects.projects")}
                                description={t("projects.uploadDocumentsIntoProjectsAndTo")}
                                action={
                                    <PillButtonUI
                                        tone="black"
                                        size="sm"
                                        onClick={() => setModalOpen(true)}
                                    >
                                        {t("projects.create")}
                                    </PillButtonUI>
                                }
                            />
                        )}
                    </TableEmptyState>
                ) : (
                    <TableBody>
                        {visibleProjects.map((project) => {
                            // The list rows carry the caller's merged
                            // access_role, so an organization admin editing a
                            // colleague's matter is no longer mistaken for an
                            // outsider just because they did not create it.
                            const canManage = can(
                                roleFrom(project),
                                "access.manage",
                            );
                            return (
                                <TableRow
                                    key={project.id}
                                    selected={selectedIdSet.has(project.id)}
                                    rightClickDropdown={(close) => renderProjectActions(project, close)}
                                    onClick={(event) => {
                                        if (event.shiftKey) {
                                            event.preventDefault();
                                            const anchorId =
                                                rowSelectionAnchorIdRef.current;
                                            setSelectionCameFromSelectAll(
                                                false,
                                            );
                                            setSelectedIds((current) =>
                                                selectedIdsAfterRangeClick(
                                                    project.id,
                                                    visibleProjects.map(
                                                        (visibleProject) =>
                                                            visibleProject.id,
                                                    ),
                                                    current,
                                                    anchorId,
                                                ),
                                            );
                                            rowSelectionAnchorIdRef.current =
                                                project.id;
                                            return;
                                        }
                                        if (event.ctrlKey || event.metaKey) {
                                            event.preventDefault();
                                            setSelectionCameFromSelectAll(
                                                false,
                                            );
                                            setSelectedIds((current) =>
                                                selectedIdsAfterShiftClick(
                                                    project.id,
                                                    current,
                                                ),
                                            );
                                            rowSelectionAnchorIdRef.current =
                                                project.id;
                                            return;
                                        }
                                        router.push(`/projects/${project.id}`);
                                    }}
                                >
                                    {/* Project Name */}
                                    <TablePrimaryCell
                                        selected={selectedIdSet.has(project.id)}
                                        onSelectionChange={() =>
                                            toggleOne(project.id)
                                        }
                                        checkboxTitle={`Select ${project.name}`}
                                    >
                                        <ClosedProjectSvgIcon className="mr-2 h-4 w-4 shrink-0" />
                                        <span className="min-w-0 flex-1 truncate text-xs text-gray-800">
                                            {project.name}
                                        </span>
                                    </TablePrimaryCell>

                                    <TableCell className="ml-auto w-32">
                                        <AccessScopeLabel
                                            scope={
                                                project.access_scope ??
                                                (project.org_id
                                                    ? "organization"
                                                    : project.is_owner === false
                                                      ? "shared"
                                                      : "private")
                                            }
                                            organizationName={
                                                project.organization_name
                                            }
                                            directGrantCount={
                                                project.direct_grant_count
                                            }
                                        />
                                    </TableCell>
                                    <TableCell className="w-32">
                                        {project.cm_number ?? (
                                            <span className="text-gray-300">
                                                —
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-36">
                                        {project.practice ?? (
                                            <span className="text-gray-300">
                                                —
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="w-32">
                                        <CreatorLabel
                                            label={getProjectCreatorLabel(
                                                project,
                                                user?.id,
                                                t,
                                            )}
                                            photo={project.owner_profile_photo}
                                            name={project.owner_display_name}
                                            email={project.owner_email}
                                        />
                                    </TableCell>
                                    <TableCell className="w-24">
                                        {project.document_count ?? 0}
                                    </TableCell>
                                    <TableCell className="w-24">
                                        {project.chat_count ?? 0}
                                    </TableCell>
                                    <TableCell className="w-36">
                                        {project.review_count ?? 0}
                                    </TableCell>
                                    <TableCell className="w-32">
                                        {formatShortDate(format, project.created_at)}
                                    </TableCell>

                                    <div
                                        className="w-8 shrink-0 flex justify-end"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <RowActions
                                            onView={() =>
                                                router.push(
                                                    `/projects/${project.id}`,
                                                )
                                            }
                                            viewLabel={t("projects.open")}
                                            onEditDetails={
                                                canManage
                                                    ? () => {
                                                          setDetailsProject(
                                                              project,
                                                          );
                                                      }
                                                    : undefined
                                            }
                                            onDelete={
                                                canManage
                                                    ? () =>
                                                          requestDeleteProject(
                                                              project,
                                                          )
                                                    : undefined
                                            }
                                        />
                                    </div>
                                </TableRow>
                            );
                        })}
                    </TableBody>
                )}
                <TableLoadMoreRow
                    loading={effectiveLoading}
                    hasMore={hasMore}
                    itemCount={visibleProjects.length}
                    loadingMore={loadingMore}
                    hasError={!!loadMoreError}
                    onLoadMore={() => void loadMore()}
                />
            </TableScrollArea>

            <NewProjectModal
                open={modalOpen}
                onClose={(createdWithoutHandover) => {
                    setModalOpen(false);
                    // A project created behind a failed grant or upload never
                    // arrived through onCreated: refetch so it is on the list
                    // the user lands back on, not only after a reload.
                    if (createdWithoutHandover) retry();
                }}
                onCreated={(p) => {
                    setProjects((prev) => [p, ...prev]);
                    router.push(`/projects/${p.id}`);
                }}
            />

            <ProjectDetailsModal
                open={!!detailsProject}
                project={detailsProject}
                canEdit={
                    !!detailsProject &&
                    can(roleFrom(detailsProject), "access.manage")
                }
                onClose={() => setDetailsProject(null)}
                onSave={handleProjectDetailsSave}
            />

            <PermissionDeniedPopup
                open={!!ownerOnlyAction}
                action={ownerOnlyAction?.action}
                contacts={ownerOnlyAction?.contacts}
                onClose={() => setOwnerOnlyAction(null)}
            />
            <ConfirmPopup
                open={confirmDeleteAllOpen && selectedIds.length > 0}
                title={
                    selectionCameFromSelectAll
                        ? t("projects.deleteAllSelectedProjects")
                        : t("projects.deleteSelectedProjects")
                }
                message={
                    selectionCameFromSelectAll
                        ? t("projects.thisWillPermanentlyDeleteEverySelected", { length: selectedIds.length })
                        : t("projects.thisWillPermanentlyDeleteTheSelected", { count: selectedIds.length })
                }
                confirmLabel={t("projects.delete")}
                confirmVariant="danger"
                onCancel={() => setConfirmDeleteAllOpen(false)}
                onConfirm={() => void handleDeleteSelected()}
            />
            <ConfirmPopup
                open={!!projectPendingDelete}
                title={t("projects.deleteProject")}
                message={t("projects.projectWillBePermanentlyDeleted", { name: projectPendingDelete?.name ?? "" })}
                confirmLabel={t("projects.delete")}
                confirmVariant="danger"
                onCancel={() => setProjectPendingDelete(null)}
                onConfirm={() => {
                    const project = projectPendingDelete;
                    setProjectPendingDelete(null);
                    if (project) void handleDeleteProjectRow(project);
                }}
            />
        </div>
    );
}
