"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { PanelLeft } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { ChatHistoryProvider } from "@/app/contexts/ChatHistoryContext";
import { ManagedAccountBanner } from "@/app/components/organizations/ManagedAccountBanner";
import { WorkspaceProvider } from "@/app/contexts/WorkspaceContext";
import { SidebarContext } from "@/app/contexts/SidebarContext";
import { PageChromeContext } from "@/app/contexts/PageChromeContext";
import { AppSidebar } from "@/app/components/shared/AppSidebar";
import { preloadSidebarIcons } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { HeaderButtonUI, HeaderButtonsUI } from "@mike/ui";
import { cn } from "@/app/lib/utils";
import { useTranslations } from "next-intl";

/**
 * The project workspace (explorer, documents and chat). "New chat" renders
 * the same page without a chat id.
 */
const PROJECT_WORKSPACE_PATH =
    /^\/projects\/[^/]+\/assistant\/chat(?:\/[^/]+)?\/?$/;

export default function MikeLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const t = useTranslations();
    preloadSidebarIcons();
    // While this boundary hydrates, useAuth answers the server's loading
    // state even if the session already settled (see useOptionalAuth).
    const { isAuthenticated, authLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const isProjectWorkspace = PROJECT_WORKSPACE_PATH.test(pathname);
    // Only the chat page lets its thread scroll under a floating header. The
    // project workspace keeps the header in flow above its panels: floating,
    // the sidebar button covered the Explorer title on a phone.
    const isChatPage = /^\/assistant\/chat\/[^/]+\/?$/.test(pathname);
    const [mobileActionsContainer, setMobileActionsContainer] =
        useState<HTMLDivElement | null>(null);

    const [isSidebarOpenDesktop, setIsSidebarOpenDesktop] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("sidebarOpen");
            return saved !== null ? saved === "true" : true;
        }
        return true;
    });

    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            return false;
        }
        // The project workspace collapses the sidebar to make room. Start
        // collapsed there: opening it and collapsing it once the page mounts
        // slides the whole workspace sideways as it loads.
        return !isProjectWorkspace;
    });

    // Client navigation keeps this layout mounted, so the initializer above
    // does not run again. Collapse in the same render that enters the
    // workspace (React's "adjust state while rendering" pattern) so the
    // sidebar is never painted open there.
    const [wasProjectWorkspace, setWasProjectWorkspace] =
        useState(isProjectWorkspace);
    if (wasProjectWorkspace !== isProjectWorkspace) {
        setWasProjectWorkspace(isProjectWorkspace);
        if (isProjectWorkspace) setIsSidebarOpen(false);
    }

    // Persist what is actually on screen. The mount initializer above reads
    // this key back, but `isSidebarOpen` ignores it: it starts open on
    // desktop everywhere except the project workspace, which starts (and on
    // client navigation, becomes) collapsed and then collapses the
    // preference too through `setSidebarOpen`. Storing anything but the
    // rendered state leaves the restored preference disagreeing with the
    // sidebar on screen and the first toggle click is spent re-syncing them.
    // Remembering a collapsed sidebar across reloads needs the mount path to
    // apply the stored value too — a separate change.
    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth >= 768) {
            localStorage.setItem("sidebarOpen", isSidebarOpen.toString());
        }
    }, [isSidebarOpenDesktop]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handleResize = () => {
            const isSmall = window.innerWidth < 768;
            if (isSmall && isSidebarOpen) setIsSidebarOpen(false);
            else if (!isSmall && !isSidebarOpen)
                setIsSidebarOpen(isSidebarOpenDesktop);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [isSidebarOpen, isSidebarOpenDesktop]);

    const handleSidebarToggle = () => {
        if (window.innerWidth >= 768) {
            setIsSidebarOpenDesktop(!isSidebarOpenDesktop);
            setIsSidebarOpen(!isSidebarOpenDesktop);
        } else {
            setIsSidebarOpen(!isSidebarOpen);
        }
    };

    const handleMobileActionsContainerRef = useCallback(
        (node: HTMLDivElement | null) => {
            setMobileActionsContainer(node);
        },
        [],
    );

    const setSidebarOpen = useCallback((open: boolean) => {
        const isSmall =
            typeof window !== "undefined" && window.innerWidth < 768;
        if (isSmall) {
            if (!open) setIsSidebarOpen(false);
            return;
        }
        setIsSidebarOpen(open);
        setIsSidebarOpenDesktop(open);
    }, []);

    const pageChromeValue = useMemo(
        () => ({ mobileActionsContainer }),
        [mobileActionsContainer],
    );

    const sidebarValue = useMemo(() => ({ setSidebarOpen }), [setSidebarOpen]);

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.push("/login");
        }
    }, [authLoading, isAuthenticated, router]);

    if (authLoading) {
        return <FullScreenLoader />;
    }

    if (!isAuthenticated) return null;

    return (
        <WorkspaceProvider>
            <ChatHistoryProvider>
                <PageChromeContext.Provider value={pageChromeValue}>
                    <SidebarContext.Provider value={sidebarValue}>
                        <div className="h-dvh flex flex-col bg-app-background">
                            <div className="flex-1 flex min-w-0 overflow-visible">
                                <AppSidebar
                                    isOpen={isSidebarOpen}
                                    onToggle={handleSidebarToggle}
                                />
                                <div className="flex-1 flex flex-col h-dvh md:overflow-hidden relative w-full">
                                    {/* Mobile header */}
                                    <div
                                        data-slot="mobile-header"
                                        className={cn(
                                            "z-30 flex items-center gap-3 overflow-visible px-4 md:hidden",
                                            isChatPage
                                                ? "pointer-events-none fixed inset-x-0 top-0 bg-transparent pb-2 pt-3"
                                                : "relative shrink-0 pb-2 pt-3",
                                        )}
                                    >
                                        <HeaderButtonsUI
                                            className={cn(
                                                "pointer-events-auto",
                                                // Only the chat page floats this
                                                // bar over scrolling content.
                                                isChatPage && "backdrop-blur-2xl",
                                            )}
                                        >
                                            <HeaderButtonUI
                                                iconOnly
                                                onClick={handleSidebarToggle}
                                                title={t("common.openSidebar")}
                                                aria-label={t("common.openSidebar")}
                                            >
                                                <PanelLeft className="h-4 w-4" />
                                            </HeaderButtonUI>
                                        </HeaderButtonsUI>
                                        <div
                                            ref={handleMobileActionsContainerRef}
                                            className="pointer-events-auto ml-auto flex min-w-0 flex-1 items-center justify-end"
                                        />
                                    </div>
                                    <main className="flex h-full w-full flex-1 flex-col overflow-y-auto md:overflow-hidden">
                                        <ManagedAccountBanner />
                                        {children}
                                    </main>
                                </div>
                            </div>
                        </div>
                    </SidebarContext.Provider>
                </PageChromeContext.Provider>
            </ChatHistoryProvider>
        </WorkspaceProvider>
    );
}
