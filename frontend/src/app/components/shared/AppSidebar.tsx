"use client";

import { UserAvatar } from "@/app/components/ui/user-avatar";

import {
    useState,
    useEffect,
    useMemo,
    useCallback,
    useRef,
    type UIEvent,
} from "react";
import {
  PanelLeft,
  Check,
  ChevronsUpDown,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import {
    PERSONAL_WORKSPACE,
    PERSONAL_WORKSPACE_LABEL,
    useWorkspace,
    workspaceChoices,
} from "@/app/contexts/WorkspaceContext";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { SidebarChatItem } from "@/app/components/shared/SidebarChatItem";
import {
    Dropdown,
    DropdownContent,
    DropdownItem,
    DropdownLabel,
    DropdownRadioGroup,
    DropdownRadioItem,
    DropdownSeparator,
    DropdownTrigger,
} from "@mike/ui";
import { SidebarHeading } from "@/app/components/shared/SidebarHeading";
import { SidebarLogo } from "@/app/components/shared/SidebarLogo";
import { LittWordmark } from "@mike/ui";
import { SidebarProjectItem } from "@/app/components/shared/SidebarProjectItem";
import {
    ChatSkeuoIcon,
    IdeSkeuoIcon,
    FolderSkeuoIcon,
    LibrarySkeuoIcon,
    TabularReviewSkeuoIcon,
    TabularReviewCompleteIcon,
    WorkflowSkeuoIcon,
    PlaybookSkeuoIcon,
    OrganizationSkeuoIcon,
    SettingsSkeuoIcon,
    SignOutSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";
import { listProjectsPage } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { useAssignLatest } from "@/app/hooks/useLatestRef";
import type { Project } from "@/app/components/shared/types";
import { firmSettingsHref } from "@/app/lib/settingsMap";
import { cn } from "@/app/lib/utils";
import { useAssistantHistoryStatuses } from "@/app/hooks/useAssistantHistoryStatuses";
import { useSidebarHistory } from "@/app/hooks/useSidebarHistory";
import {
    scrollFadeMaskStyle,
    useScrollEdges,
} from "@/app/hooks/useScrollEdges";
import { useTabularHistoryStatuses } from "@/app/hooks/useTabularHistoryStatuses";
import { usePlaybookRunHistoryStatuses } from "@/app/hooks/usePlaybookRunHistoryStatuses";
import { useViewedPlaybookRun } from "@/app/lib/playbookRunActivity";
import { SidebarPlaybookRunItem } from "@/app/components/shared/SidebarPlaybookRunItem";
import { notifyWorkspaceSwitched } from "@/app/hooks/useItemWorkspace";
import {
    WorkspaceBadge,
    workspaceChoiceLabel,
} from "@/app/components/shared/WorkspaceBadge";
import {
    LIQUID_GLASS_FLOAT_CLASS,
    LIQUID_GLASS_SELECTED_CLASS,
    LIQUID_GLASS_HOVER_CLASS,
} from "@/app/components/ui/liquid-surface";
import { SETTINGS_PHONE_HOME } from "@/app/lib/settingsRoutes";
import { useIsPhone } from "@/app/hooks/useIsPhone";
import { useTranslations } from "next-intl";

/** Where a workspace opens: the page the logo leads to. */
const WORKSPACE_HOME = "/assistant";

const NAV_ITEMS = [
    { href: "/assistant", labelKey: "shared.appSidebar.navAssistant", icon: ChatSkeuoIcon },
    { href: "/ide", labelKey: "shared.appSidebar.navIde", icon: IdeSkeuoIcon },
    { href: "/projects", labelKey: "shared.appSidebar.navProjects", icon: FolderSkeuoIcon },
    { href: "/library", labelKey: "shared.appSidebar.navLibrary", icon: LibrarySkeuoIcon },
    {
        href: "/tabular-reviews",
        labelKey: "shared.appSidebar.navTabularReview",
        icon: TabularReviewSkeuoIcon,
    },
    { href: "/workflows", labelKey: "shared.appSidebar.navWorkflows", icon: WorkflowSkeuoIcon },
    { href: "/playbooks", labelKey: "shared.appSidebar.navPlaybooks", icon: PlaybookSkeuoIcon },
] as const;

const RECENT_PROJECT_PAGE_SIZE = 10;
// A cap, not a height: a short list gives the rest of the column to History.
const RECENT_PROJECT_LIST_HEIGHT_CLASS = "max-h-44";
// Room for an expanded project's recent chats and reviews.
const RECENT_PROJECT_LIST_EXPANDED_HEIGHT_CLASS = "max-h-64";
const recentProjectsCache = new Map<
    string,
    { projects: Project[]; hasMore: boolean }
>();

function isNearScrollEnd(element: HTMLDivElement) {
    return (
        element.scrollHeight - element.scrollTop - element.clientHeight <= 32
    );
}

interface AppSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
}

/** Renders workspace navigation, recent content, and the current account menu with its photo or monogram. */
export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
    const t = useTranslations();
    const { user, signOut } = useAuth();
    const { profile } = useUserProfile();
    const {
        chats,
        setCurrentChatId,
        sideChatId,
        requestSideChat,
    } =
        useChatHistoryContext();
    const history = useSidebarHistory();
    const router = useRouter();
    const pathname = usePathname();
    const activeReviewId = pathname.match(/\/tabular-reviews\/([^/]+)/)?.[1] ?? null;
    const reviewStatuses = useTabularHistoryStatuses(history.reviews, activeReviewId);
    // A run is on screen when its results are shown, wherever its page is.
    const viewedRunId = useViewedPlaybookRun();
    const runStatuses = usePlaybookRunHistoryStatuses(history.playbookRuns, viewedRunId);
    const routeChatId = useMemo(() => {
        if (pathname.startsWith("/assistant/chat/")) {
            return pathname.split("/").pop() ?? null;
        }

        const projectChatMatch = pathname.match(
            /^\/projects\/[^/]+\/assistant\/chat\/([^/]+)/,
        );
        return projectChatMatch?.[1] ?? null;
    }, [pathname]);
    const chatIds = useMemo(
        () => (chats ?? []).map((chat) => chat.id),
        [chats],
    );
    const onAssistantPage =
        pathname === "/assistant" || pathname.startsWith("/assistant/chat/");
    function openInSideChat(chatId: string) {
        // The assistant page, when it is the one on screen, opens the chat
        // beside its current one without a navigation; from anywhere else
        // the chat arrives in the URL it reads on mount.
        if (onAssistantPage) requestSideChat(chatId);
        else router.push(`/assistant?side=${encodeURIComponent(chatId)}`);
    }
    const {
        statuses: assistantHistoryStatuses,
        clearStatus: clearAssistantHistoryStatus,
    } = useAssistantHistoryStatuses({
        activeChatId: routeChatId,
        sideChatId,
        chatIds,
    });
    // Fade the contents in whenever the sidebar opens, from its own toggle or
    // from a page calling setSidebarOpen, but not when it is already open on
    // first render.
    // The sidebar slides in as a whole on a phone, so its contents do not
    // fade as well. On a phone it is always laid out in full (only slid out
    // of sight), so its contents are always the expanded ones.
    const phone = useIsPhone();
    const expanded = isOpen || phone;
    const [shouldAnimate, setShouldAnimate] = useState(false);
    const [wasOpen, setWasOpen] = useState(isOpen);
    if (isOpen !== wasOpen) {
        setWasOpen(isOpen);
        if (isOpen && !phone) setShouldAnimate(true);
    }
    const toggleRef = useRef<HTMLButtonElement>(null);
    // A phone's open sidebar is a window: focus moves into it, Escape closes
    // it, and focus goes back to the button that opened it.
    const onToggleRef = useRef(onToggle);
    useEffect(() => {
        onToggleRef.current = onToggle;
    }, [onToggle]);
    useEffect(() => {
        if (!phone || !isOpen) return;
        toggleRef.current?.focus({ preventScroll: true });
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
                onToggleRef.current();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            const active = document.activeElement;
            if (!active || active === document.body || active.closest("#app-sidebar")) {
                document
                    .querySelector<HTMLElement>("[data-sidebar-trigger]")
                    ?.focus({ preventScroll: true });
            }
        };
    }, [phone, isOpen]);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    // The toggle slides out from under the pointer as the sidebar resizes, so
    // its hover background is held off after a click until the pointer next
    // enters or leaves it.
    const [toggleHoverSuppressed, setToggleHoverSuppressed] = useState(false);
    const [projectsCollapsed, setProjectsCollapsed] = useState(false);
    const [historyCollapsed, setHistoryCollapsed] = useState(false);
    const activeProjectId = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
    const [expandedProjectIds, setExpandedProjectIds] = useState<
        ReadonlySet<string>
    >(() => new Set(activeProjectId ? [activeProjectId] : []));
    // Opening a project expands its recent items. It never collapses one the
    // user opened, so navigating away keeps their choice.
    const [lastActiveProjectId, setLastActiveProjectId] =
        useState(activeProjectId);
    if (activeProjectId !== lastActiveProjectId) {
        setLastActiveProjectId(activeProjectId);
        if (activeProjectId && !expandedProjectIds.has(activeProjectId)) {
            setExpandedProjectIds(
                (current) => new Set([...current, activeProjectId]),
            );
        }
    }
    const setProjectExpanded = useCallback(
        (projectId: string, expanded: boolean) => {
            setExpandedProjectIds((current) => {
                const next = new Set(current);
                if (expanded) next.add(projectId);
                else next.delete(projectId);
                return next;
            });
        },
        [],
    );
    const userId = user?.id ?? null;
    const {
        workspaceId,
        organizations,
        activeOrganization,
        personalWorkspaceDisabled,
        setWorkspace,
    } = useWorkspace();
    const workspaceParam = workspaceId ?? undefined;
    // The switcher is navigation: what was on screen belonged to the
    // workspace just left, so the new one opens at its home.
    //
    // The page leaves first and the workspace follows. Changing it straight
    // away made the page being left reload itself for the new workspace — a
    // list flashing its loading state — only to be replaced a moment later.
    const pendingWorkspaceRef = useRef<{
        id: string;
        name: string;
        from: string;
    } | null>(null);
    const switchWorkspace = (next: string) => {
        if (next === workspaceId) return;
        const name =
            next === PERSONAL_WORKSPACE
                ? PERSONAL_WORKSPACE_LABEL
                : (organizations?.find((org) => org.id === next)?.name ?? "");
        if (pathname === WORKSPACE_HOME) {
            pendingWorkspaceRef.current = null;
            setWorkspace(next);
            if (name) notifyWorkspaceSwitched(name);
            return;
        }
        pendingWorkspaceRef.current = { id: next, name, from: pathname };
        router.push(WORKSPACE_HOME);
    };
    useEffect(() => {
        const pending = pendingWorkspaceRef.current;
        // Any page other than the one being left: home, or wherever else
        // they went in the meantime.
        if (!pending || pathname === pending.from) return;
        pendingWorkspaceRef.current = null;
        setWorkspace(pending.id);
        if (pending.name) notifyWorkspaceSwitched(pending.name);
    }, [pathname, setWorkspace]);
    // Recent projects are remembered per account AND per workspace, so a
    // switch never paints the previous workspace's matters from cache.
    const projectsCacheKey = userId ? `${userId}:${workspaceId ?? ""}` : null;
    const projectsRequestRef = useRef(0);
    // The switcher only exists for somebody who has more than one place to
    // be. With no organizations there is nothing to choose between, and the
    // menu stays exactly as it was.
    const workspaceOptions =
        workspaceId && organizations && organizations.length > 0
? workspaceChoices(organizations, personalWorkspaceDisabled)
            : null;
    // The sidebar is headed by whose work it is showing: the organization's
    // name in its workspace, and plain "LiTT" for personal work. `null` while
    // a remembered organization's name is still loading — saying "LiTT" for
    // that moment would be naming the wrong workspace.
    const sidebarHeading = activeOrganization
        ? activeOrganization.name
        : workspaceId &&
            workspaceId !== PERSONAL_WORKSPACE &&
            organizations === null
          ? null
          : "LiTT";
    // Personal work is headed by the LiTT wordmark itself, never by the
    // monogram beside the name typed in a font (that would retype the mark).
    const headedByWordmark = !activeOrganization && sidebarHeading !== null;
    const [recentProjects, setRecentProjects] = useState<Project[] | null>(
        null,
    );
    const [hasMoreRecentProjects, setHasMoreRecentProjects] = useState(false);
    const [loadingMoreRecentProjects, setLoadingMoreRecentProjects] =
        useState(false);
    const loadingMoreRecentProjectsRef = useRef(false);
    const [recentProjectsAttempt, setRecentProjectsAttempt] = useState(0);
    const displayedRecentProjects =
        recentProjects ??
        (projectsCacheKey
            ? recentProjectsCache.get(projectsCacheKey)?.projects
            : undefined) ??
        null;

    useEffect(() => {
        const request = ++projectsRequestRef.current;
        if (!userId) {
            setRecentProjects([]);
            setHasMoreRecentProjects(false);
            setLoadingMoreRecentProjects(false);
            loadingMoreRecentProjectsRef.current = false;
            return;
        }

        const cacheKey = projectsCacheKey;
        if (!cacheKey) return;
        const cached = recentProjectsCache.get(cacheKey);
        if (cached) {
            setRecentProjects(cached.projects);
            setHasMoreRecentProjects(cached.hasMore);
        } else {
            setRecentProjects(null);
            setHasMoreRecentProjects(false);
        }
        const controller = new AbortController();
        setLoadingMoreRecentProjects(false);
        loadingMoreRecentProjectsRef.current = false;

        listProjectsPage({
            limit: RECENT_PROJECT_PAGE_SIZE + 1,
            workspace: workspaceParam,
            scope: "mine",
            sortKey: "updated",
            sortDirection: "desc",
            signal: controller.signal,
        })
            .then((projects) => {
                if (controller.signal.aborted) return;
                const next = projects.slice(0, RECENT_PROJECT_PAGE_SIZE);
                const hasMore = projects.length > RECENT_PROJECT_PAGE_SIZE;
                recentProjectsCache.set(cacheKey, { projects: next, hasMore });
                setRecentProjects(next);
                setHasMoreRecentProjects(hasMore);
            })
            .catch((error) => {
                if (controller.signal.aborted) return;
                setRecentProjects([]);
                setHasMoreRecentProjects(false);
                // An empty Projects section reads as "you have no projects",
                // which is the one thing this failure does not mean.
                notifyError(error, {
                    action: t("shared.appSidebar.loadYourRecentProjects"),
                    dedupeKey: "sidebar-recent-projects",
                    onRetry: () =>
                        setRecentProjectsAttempt((attempt) => attempt + 1),
                });
            });

        return () => {
            controller.abort();
            projectsRequestRef.current = request + 1;
        };
    }, [recentProjectsAttempt, userId, projectsCacheKey, workspaceParam]);

    const retryLoadMoreRecentProjectsRef = useRef<(() => void) | null>(null);
    const loadMoreRecentProjects = useCallback(async () => {
        if (
            !userId ||
            recentProjects === null ||
            !hasMoreRecentProjects ||
            loadingMoreRecentProjectsRef.current
        ) {
            return;
        }

        const cacheKey = projectsCacheKey;
        if (!cacheKey) return;
        loadingMoreRecentProjectsRef.current = true;
        setLoadingMoreRecentProjects(true);
        const request = projectsRequestRef.current;
        try {
            const projects = await listProjectsPage({
                limit: RECENT_PROJECT_PAGE_SIZE + 1,
                offset: recentProjects.length,
                workspace: workspaceParam,
                scope: "mine",
                sortKey: "updated",
                sortDirection: "desc",
            });
            // The workspace changed while this page was in flight: it
            // belongs to a list that is no longer on screen.
            if (request !== projectsRequestRef.current) return;
            const page = projects.slice(0, RECENT_PROJECT_PAGE_SIZE);
            setRecentProjects((current) => {
                const existing = new Set(
                    (current ?? []).map((project) => project.id),
                );
                const next = [
                    ...(current ?? []),
                    ...page.filter((project) => !existing.has(project.id)),
                ];
                recentProjectsCache.set(cacheKey, {
                    projects: next,
                    hasMore: projects.length > RECENT_PROJECT_PAGE_SIZE,
                });
                return next;
            });
            setHasMoreRecentProjects(
                projects.length > RECENT_PROJECT_PAGE_SIZE,
            );
        } catch (error) {
            // The current page survives; the user is told the next one did
            // not arrive instead of scrolling at a list that stopped growing.
            notifyError(error, {
                action: t("shared.appSidebar.loadMoreProjects"),
                dedupeKey: "sidebar-recent-projects-more",
                onRetry: () => retryLoadMoreRecentProjectsRef.current?.(),
            });
        } finally {
            if (request === projectsRequestRef.current) {
                loadingMoreRecentProjectsRef.current = false;
                setLoadingMoreRecentProjects(false);
            }
        }
    }, [
        hasMoreRecentProjects,
        projectsCacheKey,
        recentProjects,
        userId,
        workspaceParam,
    ]);

    // "Retry" re-enters the latest paging callback; a callback cannot
    // reference itself.
    useAssignLatest(retryLoadMoreRecentProjectsRef, () => void loadMoreRecentProjects());

    const handleRecentProjectsScroll = useCallback(
        (event: UIEvent<HTMLDivElement>) => {
            if (isNearScrollEnd(event.currentTarget)) {
                void loadMoreRecentProjects();
            }
        },
        [loadMoreRecentProjects],
    );

    // History scrolls on its own; its ends fade where more rows are hidden.
    const historyScroll = useScrollEdges<HTMLDivElement>("y");
    // A short window scrolls the whole column above the account button.
    const columnScroll = useScrollEdges<HTMLDivElement>("y");
    const handleHistoryScroll = (event: UIEvent<HTMLDivElement>) => {
        historyScroll.onScroll();
        if (isNearScrollEnd(event.currentTarget)) void history.loadMore();
    };

    const handleToggle = () => {
        onToggle();
    };

    // A failed sign-out leaves the session live, which the user must know
    // about — on a shared machine especially. Signing out again is safe, so
    // the notice carries a real Retry.
    function handleSignOut() {
        void signOut()
            .then(() => router.push("/"))
            .catch((error) => {
                notifyError(error, {
                    action: t("shared.appSidebar.signOutAction"),
                    dedupeKey: "sign-out",
                    onRetry: handleSignOut,
                });
            });
    }

    useEffect(() => {
        setCurrentChatId(routeChatId);
    }, [routeChatId, setCurrentChatId]);


    const getDisplayName = () => {
        if (!profile) return "";
        return profile.displayName || user?.email?.split("@")[0] || "";
    };

    const anyRecentProjectExpanded =
        displayedRecentProjects?.some((project) =>
            expandedProjectIds.has(project.id),
        ) ?? false;

    if (!user) return null;

    return (
        <>
            {/* Phone: the veil behind the open sidebar, ink at 25 %. It fades
                with the slide (250 ms in, 180 ms out) and a tap on it closes
                the sidebar. Always mounted so it can fade out; md+ never
                shows it. */}
            <div
                className={cn(
                    "fixed inset-0 z-[98] bg-[color-mix(in_srgb,var(--litt-tinta)_25%,transparent)] transition-[opacity,visibility] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:hidden",
                    isOpen
                        ? "opacity-100 duration-[250ms]"
                        : "pointer-events-none invisible opacity-0 duration-[180ms]",
                )}
                onClick={handleToggle}
                aria-hidden="true"
            />
            {/* From md up the column in the layout is as wide as the sidebar
                will be, at once; only the panel inside animates its width, so
                the page beside it is laid out once, not on every frame. On a
                phone this wrapper takes no box. */}
            <div
                className={cn(
                    "max-md:contents md:relative md:shrink-0",
                    isOpen
                        ? "md:w-[calc(15.5rem+0.75rem)]"
                        : "md:w-[calc(46px+0.75rem)]",
                )}
            >
            <div
                id="app-sidebar"
                // Open on a phone, the sidebar is a window over the page: the
                // page is inert (layout), Escape closes it, and it is named
                // for a screen reader. Closed, it is inert and invisible.
                role={phone && isOpen ? "dialog" : undefined}
                aria-modal={phone && isOpen ? true : undefined}
                aria-label={phone && isOpen ? t("shared.appSidebar.navLabel") : undefined}
                inert={phone && !isOpen}
                data-state={isOpen ? "open" : "closed"}
                className={cn(
                    // Phone: always laid out at full size and slid in and out
                    // with transform (never the width), 250 ms in / 180 ms out.
                    "max-md:fixed max-md:left-0 max-md:top-0 max-md:ml-[max(0.5rem,env(safe-area-inset-left))] max-md:mt-[max(0.5rem,env(safe-area-inset-top))] max-md:w-62 max-md:h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top))-max(0.5rem,env(safe-area-inset-bottom)))] max-md:rounded-2xl max-md:transition-[transform,visibility]",
                    isOpen
                        ? "max-md:[transform:none] max-md:duration-[250ms]"
                        : "max-md:pointer-events-none max-md:invisible max-md:[transform:translateX(calc(-100%-1rem))] max-md:duration-[180ms]",
                    // Desktop: the panel floats in its column and animates only
                    // the width and the radius, in 200 ms.
                    "md:absolute md:left-3 md:top-3 md:h-[calc(100dvh-1.5rem)] md:transition-[width,border-radius] md:duration-200",
                    // Collapsed, the ends are full semicircles. The radii are
                    // lengths, not rounded-full, so the change animates with
                    // the width.
                    isOpen ? "md:w-62 md:rounded-2xl" : "md:w-[46px] md:rounded-[23px]",
                    "ease-[cubic-bezier(0.32,0.72,0,1)] overflow-visible",
                    LIQUID_GLASS_FLOAT_CLASS,
                    "z-[99] flex shrink-0 flex-col motion-reduce:transition-none",
                )}
            >
              <nav
                aria-label={t("shared.appSidebar.navLabel")}
                className="flex min-h-0 flex-1 flex-col"
              >
                {/* Toggle + Logo */}
                <div
                    className={`h-11 shrink-0 items-center justify-between gap-1 px-1.5 ${
                        !expanded ? "hidden md:flex" : "flex"
                    }`}
                >
                    {expanded && headedByWordmark && (
                        <div className="min-w-0 flex-1">
                            {/* X = 22, the wordmark's on-screen minimum; its
                                box carries the 4u protection area. The mark
                                never fades on hover; focus shows the ring. */}
                            <Link
                                href="/assistant"
                                data-slot="sidebar-heading"
                                className="flex w-fit rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                            >
                                <LittWordmark x={22} />
                            </Link>
                        </div>
                    )}
                    {expanded && !headedByWordmark && (
                        <div className="min-w-0 flex-1 px-1.5">
                            <Link
                                href="/assistant"
                                className="flex min-w-0 items-center gap-1.5 hover:opacity-80 transition-opacity"
                            >
                                <span className="flex shrink-0 px-px">
                                    <SidebarLogo
                                        organization={activeOrganization}
                                    />
                                </span>
                                {sidebarHeading === null ? (
                                    <span
                                        data-slot="sidebar-heading-loading"
                                        role="status"
                                        aria-label={t("shared.appSidebar.loadingWorkspace")}
                                        className={cn("h-5 w-28 rounded bg-gray-200", shouldAnimate ? "sidebar-heading-enter" : "animate-pulse")}
                                    />
                                ) : (
                                    <SidebarHeading
                                        name={sidebarHeading}
                                        className={
                                            shouldAnimate
                                                ? "sidebar-heading-enter"
                                                : undefined
                                        }
                                    />
                                )}
                            </Link>
                        </div>
                    )}
                    <button
                        ref={toggleRef}
                        type="button"
                        onClick={() => {
                            setToggleHoverSuppressed(true);
                            handleToggle();
                        }}
                        onPointerEnter={() => setToggleHoverSuppressed(false)}
                        onPointerLeave={() => setToggleHoverSuppressed(false)}
                        aria-label={isOpen ? t("shared.appSidebar.closeSidebar") : t("shared.appSidebar.openSidebar")}
                        className={cn(
                            "group flex h-8 w-8 pointer-coarse:h-10 pointer-coarse:w-10 shrink-0 items-center justify-center transition-[border-radius] duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                            expanded ? "rounded-md" : "rounded-[16px]",
                            !toggleHoverSuppressed && LIQUID_GLASS_HOVER_CLASS,
                        )}
                        title={isOpen ? t("shared.appSidebar.closeSidebar") : t("shared.appSidebar.openSidebar")}
                    >
                        {expanded ? (
                            <PanelLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
                        ) : (
                            <span aria-hidden="true" className="relative flex h-[18px] w-[18px] items-center justify-center">
                                <span className="absolute inset-0 flex items-center justify-center group-hover:invisible group-focus-visible:invisible">
                                    <SidebarLogo
                                        organization={activeOrganization}
                                    />
                                </span>
                                <PanelLeft className="invisible h-4 w-4 shrink-0 group-hover:visible group-focus-visible:visible" />
                            </span>
                        )}
                    </button>
                </div>

                {/* Whose work is on screen, in words, whatever the heading
                    above says; a firm's name is already the heading. */}
                {expanded && (
                    <div className="px-2.5 pb-1">
                        <WorkspaceBadge showName={headedByWordmark} />
                    </div>
                )}

                {/* Everything between the header and the account button
                    scrolls as one when the window is short, so the sidebar
                    never grows past the screen or slides under the footer.
                    Its bottom fades while rows are hidden below, so the
                    last one never looks cut off by the account button. */}
                <div
                    ref={columnScroll.ref}
                    data-sidebar-column
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
                    style={scrollFadeMaskStyle(columnScroll.edges)}
                    data-scroll-end={columnScroll.edges.end || undefined}
                    onScroll={columnScroll.onScroll}
                >
                    {/* Nav items */}
                    <div className="pt-1.5">
                        {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => {
                            const label = t(labelKey);
                            const isActive =
                                href === "/assistant"
                                    ? pathname === href
                                    : href === "/projects"
                                      ? pathname === href
                                      : pathname === href ||
                                        pathname.startsWith(href + "/");
                            return (
                                <div key={href} className="px-1.5 py-0.5">
                                    <button
                                        onClick={() => router.push(href)}
                                        title={!expanded ? label : ""}
                                        className={cn(
                                            "w-full h-8 flex items-center gap-2 px-2 py-2 rounded-md transition-colors text-left pointer-coarse:h-11",
                                            isActive
                                                ? `${LIQUID_GLASS_SELECTED_CLASS} text-gray-900`
                                                : `text-gray-700 ${LIQUID_GLASS_HOVER_CLASS}`,
                                            !expanded ? "hidden md:flex" : "flex",
                                        )}
                                    >
                                        <Icon
                                            className={`h-4 w-4 flex-shrink-0 ${
                                                isActive
                                                    ? "text-gray-900"
                                                    : "text-black"
                                            }`}
                                        />
                                        {expanded && (
                                            <span
                                                className={`text-sm font-medium ${
                                                    shouldAnimate
                                                        ? "sidebar-fade-in-2"
                                                        : ""
                                                }`}
                                            >
                                                {label}
                                            </span>
                                        )}
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {expanded && (
                        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
                            {/* Recent Projects */}
                            <div>
                                <button
                                    onClick={() => setProjectsCollapsed((v) => !v)}
                                    className={`mb-2 flex w-full items-center justify-between rounded-md px-3.5 pointer-coarse:min-h-11 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
                                        shouldAnimate ? "sidebar-fade-in" : ""
                                    }`}
                                >
                                    <span>{t("shared.appSidebar.recentProjects")}</span>
                                    <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                            projectsCollapsed ? "-rotate-90" : ""
                                        }`}
                                    />
                                </button>
                                {!projectsCollapsed && (
                                    <div
                                        className={cn(
                                            anyRecentProjectExpanded
                                                ? RECENT_PROJECT_LIST_EXPANDED_HEIGHT_CLASS
                                                : RECENT_PROJECT_LIST_HEIGHT_CLASS,
                                            "overflow-y-auto transition-[max-height] duration-200 motion-reduce:transition-none",
                                        )}
                                        onScroll={handleRecentProjectsScroll}
                                    >
                                        {!displayedRecentProjects ? (
                                            <div className="space-y-1 px-1.5">
                                                {[50, 65, 45].map((w, i) => (
                                                    <div
                                                        key={i}
                                                        className="flex h-8 items-center gap-2 rounded-md px-2"
                                                    >
                                                        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                                                            <div className="h-3.5 w-3.5 rounded bg-gray-200 animate-pulse" />
                                                        </div>
                                                        <div
                                                            className="h-3 bg-gray-200 rounded animate-pulse"
                                                            style={{
                                                                width: `${w}%`,
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        ) : displayedRecentProjects.length === 0 ? (
                                            <div
                                                className={`px-3.5 py-2 text-xs text-gray-500 ${
                                                    shouldAnimate
                                                        ? "sidebar-fade-in-2"
                                                        : ""
                                                }`}
                                            >
                                                {t("shared.appSidebar.noProjectsYet")}
                                            </div>
                                        ) : (
                                            <div
                                                className={`space-y-1 px-1.5 pb-1 ${
                                                    shouldAnimate
                                                        ? "sidebar-fade-in-2"
                                                        : ""
                                                }`}
                                            >
                                                {displayedRecentProjects.map(
                                                    (project) => (
                                                        <SidebarProjectItem
                                                            key={project.id}
                                                            project={project}
                                                            pathname={pathname}
                                                            expanded={expandedProjectIds.has(
                                                                project.id,
                                                            )}
                                                            onExpandedChange={(
                                                                expanded,
                                                            ) =>
                                                                setProjectExpanded(
                                                                    project.id,
                                                                    expanded,
                                                                )
                                                            }
                                                            onOpenProject={() =>
                                                                router.push(
                                                                    `/projects/${project.id}`,
                                                                )
                                                            }
                                                        />
                                                    ),
                                                )}
                                                {loadingMoreRecentProjects && (
                                                    <div className="flex h-8 items-center justify-center">
                                                        <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* History */}
                            <div
                                className={cn(
                                    "flex min-h-0 flex-col",
                                    // Room for the heading and three rows:
                                    // History never shrinks under the
                                    // account button; a shorter window
                                    // scrolls the whole column instead.
                                    !historyCollapsed && "min-h-36 flex-1",
                                )}
                            >
                                <button
                                    type="button"
                                    aria-expanded={!historyCollapsed}
                                    aria-controls="sidebar-history"
                                    onClick={() => setHistoryCollapsed((v) => !v)}
                                    className={`mb-2 flex w-full items-center justify-between rounded-md px-3.5 pointer-coarse:min-h-11 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${
                                        shouldAnimate ? "sidebar-fade-in" : ""
                                    }`}
                                >
                                    <span>{t("shared.appSidebar.history")}</span>
                                    <ChevronDown
                                        className={`h-3.5 w-3.5 transition-transform ${
                                            historyCollapsed ? "-rotate-90" : ""
                                        }`}
                                    />
                                </button>
                                <div
                                    ref={historyScroll.ref}
                                    id="sidebar-history"
                                    role="region"
                                    aria-label={t("shared.appSidebar.history")}
                                    className={cn(
                                        "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1",
                                        historyCollapsed && "hidden",
                                    )}
                                    style={scrollFadeMaskStyle(historyScroll.edges)}
                                    data-scroll-start={historyScroll.edges.start || undefined}
                                    data-scroll-end={historyScroll.edges.end || undefined}
                                    onScroll={handleHistoryScroll}
                                >
                                    {history.loading ? (
                                        <div className="space-y-1.5 px-1.5">
                                            {[40, 60, 50, 70, 45].map((w, i) => (
                                                <div
                                                    key={i}
                                                    className="flex h-8 items-center gap-2 rounded-md px-2"
                                                >
                                                    <div className="flex h-4 w-4 shrink-0 items-center justify-center">
                                                        <div className="h-3.5 w-3.5 rounded bg-gray-200 animate-pulse" />
                                                    </div>
                                                    <div
                                                        className="h-3 bg-gray-200 rounded animate-pulse"
                                                        style={{ width: `${w}%` }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    ) : history.items.length === 0 ? (
                                        <div
                                            className={`text-xs text-gray-500 py-2 px-3.5 ${
                                                shouldAnimate
                                                    ? "sidebar-fade-in-2"
                                                    : ""
                                            }`}
                                        >
                                            {!history.error && t("shared.appSidebar.noHistoryYet")}
                                        </div>
                                    ) : (
                                        <>
                                            <div
                                                className={`space-y-1.5 px-1.5 ${
                                                    shouldAnimate
                                                        ? "sidebar-fade-in-2"
                                                        : ""
                                                }`}
                                            >
                                                {history.items.map((entry) => {
                                                    if (entry.kind === "review") {
                                                        const review = entry.item;
                                                        const title = review.title?.trim() || t("shared.appSidebar.untitledReview");
                                                        const projectName = review.project_name?.trim();
                                                        const fullTitle = projectName ? `${projectName}: ${title}` : title;
                                                        const href = review.project_id
                                                            ? `/projects/${review.project_id}/tabular-reviews/${review.id}`
                                                            : `/tabular-reviews/${review.id}`;
                                                        const active = pathname === href || pathname.startsWith(`${href}/`);
                                                        const status = reviewStatuses.statuses[review.id];
                                                        return (
                                                            <Link
                                                                key={`review:${review.id}`}
                                                                href={href}
                                                                title={fullTitle}
                                                                aria-label={t("shared.appSidebar.tabularReviewStatus", { title: fullTitle, status: status ?? "idle" })}
                                                                onClick={() => reviewStatuses.clearStatus(review.id)}
                                                                aria-current={active ? "page" : undefined}
                                                                className={cn(
                                                                    "flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus",
                                                                    active
                                                                        ? `${LIQUID_GLASS_SELECTED_CLASS} text-gray-900`
                                                                        : `${LIQUID_GLASS_HOVER_CLASS} text-gray-700`,
                                                                )}
                                                            >
                                                                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                                                                    {status === "loading" ? (
                                                                        <Loader2 role="status" aria-label={t("shared.appSidebar.titleReviewRunning", { title })} className="h-3.5 w-3.5 animate-spin text-interactive motion-reduce:animate-none" />
                                                                    ) : status === "complete" ? (
                                                                        <TabularReviewCompleteIcon className="h-3.5 w-3.5" />
                                                                    ) : (
                                                                        <TabularReviewSkeuoIcon className="h-3.5 w-3.5" />
                                                                    )}
                                                                </span>
                                                                <span className="min-w-0 flex-1 truncate">
                                                                    {projectName && <span className="text-gray-400 font-normal">{projectName}: </span>}
                                                                    {title}
                                                                </span>
                                                            </Link>
                                                        );
                                                    }
                                                    if (entry.kind === "playbookRun") {
                                                        const run = entry.item;
                                                        return (
                                                            <SidebarPlaybookRunItem
                                                                key={`playbook-run:${run.id}`}
                                                                run={run}
                                                                isActive={viewedRunId === run.id}
                                                                status={runStatuses.statuses[run.id]}
                                                                onOpen={() => runStatuses.clearStatus(run.id)}
                                                            />
                                                        );
                                                    }
                                                    const chat = entry.item;
                                                    return (
                                                    <SidebarChatItem
                                                        key={`chat:${chat.id}`}
                                                        chat={chat}
                                                        isActive={
                                                            routeChatId === chat.id
                                                        }
                                                        projectName={
                                                            chat.project_name ??
                                                            undefined
                                                        }
                                                        responseStatus={
                                                            assistantHistoryStatuses[
                                                                chat.id
                                                            ]
                                                        }
                                                        onOpenInSideChat={
                                                            // Assistant chats only: a
                                                            // project's chats open in
                                                            // its own workspace. Not a
                                                            // chat already on screen.
                                                            chat.project_id ||
                                                            chat.id === routeChatId ||
                                                            chat.id === sideChatId
                                                                ? undefined
                                                                : () =>
                                                                      openInSideChat(
                                                                          chat.id,
                                                                      )
                                                        }
                                                        onSelect={() => {
                                                            clearAssistantHistoryStatus(
                                                                chat.id,
                                                            );
                                                            setCurrentChatId(
                                                                chat.id,
                                                            );
                                                            router.push(
                                                                chat.project_id
                                                                    ? `/projects/${chat.project_id}/assistant/chat/${chat.id}`
                                                                    : `/assistant/chat/${chat.id}`,
                                                            );
                                                        }}
                                                    />
                                                    );
                                                })}
                                            </div>
                                            {history.loadingMore && (
                                                <div className="flex h-8 items-center justify-center">
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {!history.loading && history.error && (
                                        <button
                                            type="button"
                                            onClick={() => void history.retry()}
                                            className="mx-3.5 my-2 rounded text-left text-xs text-gray-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                        >
                                            {t("shared.appSidebar.someHistoryCouldNotBeLoaded")}
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* User Profile. A hairline marks where the column stops
                    while rows are hidden below it; the border is always
                    there, so showing it never moves the button. */}
                <div
                    data-sidebar-account
                    className={cn(
                        "shrink-0 border-t p-1 transition-colors",
                        columnScroll.edges.end
                            ? "border-gray-200"
                            : "border-transparent",
                    )}
                >
                    {user && (
                        <Dropdown
                            open={isDropdownOpen}
                            onOpenChange={setIsDropdownOpen}
                        >
                          <DropdownTrigger asChild>
                            <button
                                type="button"
                                aria-label={t("shared.appSidebar.accountMenu")}
                                className={cn(
                                    "flex h-9 pointer-coarse:h-11 w-full shrink-0 items-center px-[7px] outline-none [transition:border-radius_300ms_cubic-bezier(0.4,0,0.2,1),background-color_150ms,color_150ms] focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
                                    expanded ? "rounded-xl" : "rounded-[18px]",
                                    !expanded ? "hidden md:flex" : "",
                                    pathname.startsWith("/settings") ||
                                        isDropdownOpen
                                        ? LIQUID_GLASS_SELECTED_CLASS
                                        : LIQUID_GLASS_HOVER_CLASS,
                                )}
                                title={!expanded ? user.email : undefined}
                            >
                                <UserAvatar photo={profile?.profilePhoto} name={profile?.displayName} email={user.email} className="h-5.5 w-5.5 text-3xs" />
                                {expanded && (
                                    <div
                                        className={`text-left flex-1 min-w-0 pl-2 flex items-center justify-between gap-2 ${
                                            shouldAnimate
                                                ? "sidebar-fade-in-2"
                                                : ""
                                        }`}
                                    >
                                        <span className="min-w-0 break-words text-sm font-medium text-gray-900 leading-tight">
                                            {getDisplayName()}
                                        </span>
                                        <ChevronsUpDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                                    </div>
                                )}
                            </button>
                          </DropdownTrigger>
                          <DropdownContent
                              side="top"
                              align="start"
                              className={cn(
                                  "whitespace-nowrap",
                                  expanded
                                      ? "w-[var(--radix-dropdown-menu-trigger-width)]"
                                      : "w-56",
                              )}
                          >
                              {workspaceOptions ? (
                                  <>
                                      {/* Same inset as the items below,
                                          so the heading sits over their
                                          text; normal case, and the size
                                          and weight of the sidebar's own
                                          section headings. */}
                                      <DropdownLabel className="px-2 text-xs font-semibold normal-case tracking-normal">
                                          {t("shared.appSidebar.workspace")}
                                      </DropdownLabel>
                                      <DropdownRadioGroup
                                          aria-label={t("shared.appSidebar.workspace")}
                                          value={
                                              workspaceId ?? PERSONAL_WORKSPACE
                                          }
                                          onValueChange={switchWorkspace}
                                          className="max-h-44 overflow-y-auto"
                                      >
                                          {workspaceOptions.map((option) => (
                                              <DropdownRadioItem
                                                  key={option.id}
                                                  value={option.id}
                                                  className="min-h-8 gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-gray-700"
                                              >
                                                  <span className="min-w-0 flex-1 whitespace-normal break-words">
                                                      {workspaceChoiceLabel(t, option)}
                                                  </span>
                                                  {option.id === workspaceId ? (
                                                      <Check
                                                          aria-hidden="true"
                                                          className="h-3.5 w-3.5 shrink-0 text-gray-500"
                                                      />
                                                  ) : null}
                                              </DropdownRadioItem>
                                          ))}
                                      </DropdownRadioGroup>
                                      <DropdownSeparator className="my-1" />
                                  </>
                              ) : null}
                              <DropdownItem
                                  // On a phone Settings opens on its grouped list; the
                                  // Account page is one row down.
                                  onSelect={() =>
                                      router.push(
                                          window.innerWidth < 768
                                              ? SETTINGS_PHONE_HOME
                                              : "/settings",
                                      )
                                  }
                                  className="h-8 gap-2 rounded-md px-2 py-2 text-sm font-medium text-gray-700 hover:text-gray-700 focus:text-gray-700 data-[selected=true]:text-gray-900 data-[selected=true]:hover:text-gray-900 data-[selected=true]:focus:text-gray-900"
                              >
                                  <SettingsSkeuoIcon className="h-4 w-4 text-black" />
                                  {t("shared.appSidebar.settings")}
                              </DropdownItem>
                              {/* «Ajustes del despacho»: the active firm's
                                  settings. In the personal workspace there is
                                  none: the firms a person belongs to are
                                  listed under Settings → Mis despachos. */}
                              {activeOrganization ? (
                                  <DropdownItem
                                      onSelect={() =>
                                          router.push(
                                              firmSettingsHref(activeOrganization.id),
                                          )
                                      }
                                      className="h-8 gap-2 rounded-md px-2 py-2 text-sm font-medium text-gray-700 hover:text-gray-700 focus:text-gray-700 data-[selected=true]:text-gray-900 data-[selected=true]:hover:text-gray-900 data-[selected=true]:focus:text-gray-900"
                                  >
                                      <OrganizationSkeuoIcon className="h-4 w-4 text-black" />
                                      {t("settings.map.firmSettingsButton")}
                                  </DropdownItem>
                              ) : null}
                              <DropdownItem
                                  onSelect={() => {
                                      void handleSignOut();
                                  }}
                                  className="h-8 gap-2 rounded-md px-2 py-2 text-sm font-medium text-gray-700 hover:text-gray-700 focus:text-gray-700 data-[selected=true]:text-gray-900 data-[selected=true]:hover:text-gray-900 data-[selected=true]:focus:text-gray-900"
                              >
                                  <SignOutSkeuoIcon className="h-4 w-4 text-black" />
                                  {t("shared.appSidebar.signOut")}
                              </DropdownItem>
                          </DropdownContent>
                        </Dropdown>
                    )}
                </div>
              </nav>
            </div>
            </div>
        </>
    );
}
