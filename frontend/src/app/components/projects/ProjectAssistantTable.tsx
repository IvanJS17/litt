"use client";

import {
    useMemo,
    useRef,
    useState,
    type ReactNode,
    type Dispatch,
    type SetStateAction,
} from "react";
import { useFormatter, useTranslations } from "next-intl";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import {
    RowActionMenuItems,
    RowActions,
} from "@/app/components/shared/RowActions";
import {
    TABLE_CHECKBOX_CLASS,
    SkeletonCheckbox,
    SkeletonLine,
    TableBody,
    TableCell,
    TableEmptyState,
    TableSortFilter,
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
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    CreatorLabel,
    CreatorLabelSkeleton,
} from "@/app/components/shared/CreatorLabel";
import {
    PersonFilter,
    distinctPeople,
    localPeople,
} from "@/app/components/shared/PersonFilter";
import { EmptyState } from "@/app/components/ui/empty-state";
import { PillButtonUI } from "@mike/ui";
import { ChatSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import type { Chat } from "@/app/components/shared/types";
import { can, roleFrom } from "@/app/lib/permissions";
import type { OwnerGate } from "./ProjectWorkspace";
import { formatDate } from "./ProjectPageParts";
import type { NsTranslate } from "@/i18n/Translate";
import { useIdSet } from "@/app/hooks/useIdSet";

function creatorLabel(
    chat: Chat,
    currentUserId: string | null | undefined,
    t: NsTranslate<"projects">,
) {
    if (currentUserId && chat.user_id === currentUserId) return t("projects.me");
    return chat.creator_display_name?.trim() || t("projects.shared");
}

type ProjectChatSortKey = "name" | "created";

export function ProjectAssistantTable({
    chats,
    filteredChats,
    selectedChatIds,
    renamingChatId,
    renameChatValue,
    currentUserId,
    onCreateChat,
    canCreateChat,
    onOpenChat,
    onDeleteChat,
    onDeleteSelectedChats,
    onOwnerOnlyAction,
    submitChatRename,
    setSelectedChatIds,
    setRenamingChatId,
    setRenameChatValue,
    loading = false,
    renderToolbar,
}: {
    chats: Chat[];
    filteredChats: Chat[];
    selectedChatIds: string[];
    renamingChatId: string | null;
    renameChatValue: string;
    currentUserId?: string | null;
    onCreateChat: () => void;
    canCreateChat: boolean;
    onOpenChat: (chatId: string) => void;
    onDeleteChat: (chat: Chat) => Promise<void> | void;
    onDeleteSelectedChats: () => Promise<void> | void;
    onOwnerOnlyAction: (action: OwnerGate) => void;
    submitChatRename: (chatId: string) => Promise<void> | void;
    setSelectedChatIds: Dispatch<SetStateAction<string[]>>;
    setRenamingChatId: Dispatch<SetStateAction<string | null>>;
    setRenameChatValue: Dispatch<SetStateAction<string>>;
    loading?: boolean;
    renderToolbar?: (actions: ReactNode) => ReactNode;
}) {
    const t = useTranslations();
    const format = useFormatter();
    const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
    const [sort, setSort] = useState<{
        key: ProjectChatSortKey;
        direction: TableSortDirection;
    } | null>(null);
    const rowSelectionAnchorIdRef = useRef<string | null>(null);
    const selectedChatIdSet = useIdSet(selectedChatIds);
    const [chatPendingDelete, setChatPendingDelete] = useState<Chat | null>(
        null,
    );

    /**
     * Deleting a chat is destructive and irreversible, and a project admin's
     * Delete reaches a colleague's thread — so it is confirmed first, the way
     * every other delete in the app is. The role gate runs BEFORE the
     * confirmation: asking a viewer to confirm a delete the server will refuse
     * is two dialogs for one refusal.
     */
    function requestDeleteChat(chat: Chat) {
        if (!can(roleFrom(chat), "container.delete")) {
            onOwnerOnlyAction(t("projects.deleteThisChat"));
            return;
        }
        setChatPendingDelete(chat);
    }

    function clearSelection() {
        rowSelectionAnchorIdRef.current = null;
        setSelectedChatIds([]);
    }

    function requestRenameChat(chat: Chat) {
        if (!can(roleFrom(chat), "access.manage")) {
            onOwnerOnlyAction({ action: t("projects.renameThisChat"), requiredRole: "owner" });
            return;
        }
        setRenameChatValue(chat.title ?? t("projects.untitledChat"));
        setRenamingChatId(chat.id);
    }

    function renderChatActions(chat: Chat | undefined, onClose: () => void) {
        const actionIds = chat
            ? rowActionSelectionIds(chat.id, selectedChatIds)
            : selectedChatIds;
        const appliesToSelection = actionIds.length > 1;
        const canDeleteSelection = actionIds.length > 0 && actionIds.every((id) => {
            const selected = chats.find((item) => item.id === id);
            return selected && can(roleFrom(selected), "container.delete");
        });
        return (
            <RowActionMenuItems
                onClose={onClose}
                onView={!appliesToSelection && chat ? () => onOpenChat(chat.id) : undefined}
                onRename={!appliesToSelection && chat && can(roleFrom(chat), "access.manage") ? () => requestRenameChat(chat) : undefined}
                onDelete={canDeleteSelection ? () =>
                    appliesToSelection || !chat
                        ? onDeleteSelectedChats()
                        : requestDeleteChat(chat)
                    : undefined
                }
                deleteLabel={appliesToSelection ? `Delete ${actionIds.length} chats` : undefined}
            />
        );
    }

    function handleCreatorFilterChange(value: string | null) {
        setCreatorFilter(value);
        clearSelection();
    }

    function handleSortChange(
        key: ProjectChatSortKey,
        direction: TableSortDirection | null,
    ) {
        setSort(direction ? { key, direction } : null);
        clearSelection();
    }

    const creatorPeople = useMemo(
        () =>
            distinctPeople(
                chats.map((chat) => ({
                    user_id: chat.user_id,
                    display_name:
                        chat.creator_display_name ||
                        (chat.user_id === currentUserId ? "Me" : null),
                    profile_photo: chat.creator_profile_photo,
                })),
            ),
        [chats, currentUserId],
    );

    const visibleChats = useMemo(() => {
        const rows = filteredChats.filter(
            (chat) =>
                !creatorFilter || chat.user_id === creatorFilter,
        );
        if (!sort) return rows;

        return [...rows].sort((a, b) => {
            const multiplier = sort.direction === "asc" ? 1 : -1;
            if (sort.key === "created") {
                return (
                    (new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime()) *
                    multiplier
                );
            }

            return (
                (a.title ?? t("projects.untitledChat")).localeCompare(
                    b.title ?? t("projects.untitledChat"),
                ) * multiplier
            );
        });
    }, [creatorFilter, filteredChats, sort, t]);

    const allVisibleChatsSelected =
        visibleChats.length > 0 &&
        visibleChats.every((chat) => selectedChatIdSet.has(chat.id));
    const someVisibleChatsSelected =
        !allVisibleChatsSelected &&
        visibleChats.some((chat) => selectedChatIdSet.has(chat.id));
    const nameSortDirection = sort?.key === "name" ? sort.direction : null;
    const createdSortDirection =
        sort?.key === "created" ? sort.direction : null;
    const nameFilterButton = (
        <TableSortFilter
            label={t("projects.sortByChatName")}
            value={nameSortDirection}
            align="right"
            onChange={(direction) => handleSortChange("name", direction)}
        />
    );
    const creatorFilterButton = (
        <PersonFilter
            label={t("projects.filterByCreator")}
            selectedTitle={(name) => `Created by ${name}`}
            value={
                creatorPeople.find(
                    (person) => person.user_id === creatorFilter,
                ) ?? null
            }
            onChange={(person) =>
                handleCreatorFilterChange(person?.user_id ?? null)
            }
            loadPeople={localPeople(creatorPeople)}
        />
    );
    const createdFilterButton = (
        <TableSortFilter
            label={t("projects.sortByCreatedDate")}
            value={createdSortDirection}
            onChange={(direction) => handleSortChange("created", direction)}
        />
    );

    return (
        <>
        {renderToolbar?.(selectedChatIds.length > 0 ? (
            <SelectionActionsMenu
                renderItems={(close) => renderChatActions(chats.find((chat) => chat.id === selectedChatIds[0]), close)}
            />
        ) : undefined)}
        <TableScrollArea
            header={
                <TableHeaderRow className="pr-8 md:pr-8">
                    <TableStickyCell header>
                        {loading ? (
                            <SkeletonCheckbox />
                        ) : (
                            <input
                                type="checkbox"
                                checked={allVisibleChatsSelected}
                                ref={(el) => {
                                    if (el)
                                        el.indeterminate =
                                            someVisibleChatsSelected;
                                }}
                                onChange={() => {
                                    rowSelectionAnchorIdRef.current = null;
                                    if (allVisibleChatsSelected)
                                        setSelectedChatIds([]);
                                    else
                                        setSelectedChatIds(
                                            visibleChats.map((c) => c.id),
                                        );
                                }}
                                className={TABLE_CHECKBOX_CLASS}
                            />
                        )}
                        <span className="mr-1">{t("projects.chats")}</span>
                        {!loading && nameFilterButton}
                    </TableStickyCell>
                    <TableHeaderCell className="ml-auto w-32">
                        <div className="flex items-center gap-1">
                            <span>{t("projects.creator")}</span>
                            {!loading && creatorFilterButton}
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
            {loading ? (
                <ProjectAssistantLoadingRows />
            ) : chats.length === 0 ? (
                <TableEmptyState>
                    <EmptyState
                        icon={<ChatSkeuoIcon />}
                        title={t("projects.assistant")}
                        description={t("projects.askQuestionsAndGetAnswersGrounded")}
                        action={
                            <PillButtonUI
                                tone="black"
                                size="sm"
                                onClick={onCreateChat}
                                disabled={!canCreateChat}
                            >
                                {t("projects.create")}
                            </PillButtonUI>
                        }
                    />
                </TableEmptyState>
            ) : (
                <TableBody>
                    {visibleChats.map((chat) => {
                        return (
                        <TableRow
                            key={chat.id}
                            selected={selectedChatIdSet.has(chat.id)}
                            rightClickDropdown={(close) => renderChatActions(chat, close)}
                            onClick={(event) => {
                                if (renamingChatId === chat.id) return;
                                if (event.shiftKey) {
                                    event.preventDefault();
                                    const anchorId =
                                        rowSelectionAnchorIdRef.current;
                                    setSelectedChatIds((current) =>
                                        selectedIdsAfterRangeClick(
                                            chat.id,
                                            visibleChats.map(
                                                (visibleChat) => visibleChat.id,
                                            ),
                                            current,
                                            anchorId,
                                        ),
                                    );
                                    rowSelectionAnchorIdRef.current = chat.id;
                                    return;
                                }
                                if (event.ctrlKey || event.metaKey) {
                                    event.preventDefault();
                                    setSelectedChatIds((current) =>
                                        selectedIdsAfterShiftClick(
                                            chat.id,
                                            current,
                                        ),
                                    );
                                    rowSelectionAnchorIdRef.current = chat.id;
                                    return;
                                }
                                onOpenChat(chat.id);
                            }}
                            className="pr-8 md:pr-8"
                        >
                            <TablePrimaryCell
                                selected={selectedChatIdSet.has(chat.id)}
                                onSelectionChange={() =>
                                    setSelectedChatIds((prev) => {
                                        rowSelectionAnchorIdRef.current =
                                            chat.id;
                                        return prev.includes(chat.id)
                                            ? prev.filter((x) => x !== chat.id)
                                            : [...prev, chat.id];
                                    })
                                }
                                label={chat.title ?? t("projects.untitledChat")}
                                editing={renamingChatId === chat.id}
                                editValue={renameChatValue}
                                onEditValueChange={setRenameChatValue}
                                onEditCommit={() =>
                                    void submitChatRename(chat.id)
                                }
                                onEditCancel={() => setRenamingChatId(null)}
                            />
                            <TableCell className="ml-auto w-32">
                                <CreatorLabel
                                    label={creatorLabel(chat, currentUserId, t)}
                                    photo={chat.creator_profile_photo}
                                    name={chat.creator_display_name}
                                />
                            </TableCell>
                            <TableCell className="w-32">
                                {formatDate(format, chat.created_at)}
                            </TableCell>
                            <div
                                className="w-8 shrink-0 flex justify-end"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <RowActions
                                    onView={() => onOpenChat(chat.id)}
                                    onRename={can(roleFrom(chat), "access.manage") ? () => requestRenameChat(chat) : undefined}
                                    onDelete={can(roleFrom(chat), "container.delete") ? () => requestDeleteChat(chat) : undefined}
                                />
                            </div>
                        </TableRow>
                        );
                    })}
                </TableBody>
            )}
        </TableScrollArea>
        <ConfirmPopup
            open={chatPendingDelete !== null}
            title={t("projects.deleteChat")}
            message={t("projects.thisCannotBeUndone")}
            confirmLabel={t("projects.delete")}
            confirmVariant="danger"
            onCancel={() => setChatPendingDelete(null)}
            onConfirm={() => {
                const chat = chatPendingDelete;
                setChatPendingDelete(null);
                if (chat) void onDeleteChat(chat);
            }}
        />
        </>
    );
}

function ProjectAssistantLoadingRows() {
    const titleWidths = ["w-36", "w-40", "w-44", "w-48", "w-52"];

    return (
        <TableBody>
            {[1, 2, 3, 4, 5].map((i) => (
                <TableRow
                    key={i}
                    interactive={false}
                    className="pr-8 md:pr-8"
                >
                    <TableStickyCell hover={false}>
                        <div className="flex min-w-0 items-center">
                            <SkeletonCheckbox />
                            <SkeletonLine
                                className={`h-3.5 ${titleWidths[i - 1]}`}
                            />
                        </div>
                    </TableStickyCell>
                    <TableCell className="ml-auto w-32">
                        <CreatorLabelSkeleton className="w-16" />
                    </TableCell>
                    <TableCell className="w-32">
                        <SkeletonLine className="w-16" />
                    </TableCell>
                    <TableCell className="w-8" />
                </TableRow>
            ))}
        </TableBody>
    );
}
