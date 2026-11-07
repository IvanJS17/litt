import { LIQUID_GLASS_FLOAT_CLASS } from "@mike/ui";
import { SkeletonLine } from "@/app/components/shared/TablePrimitive";
import { PAGE_HEADER_ROW_CLASS } from "@/app/components/shared/pageHeaderStyles";
import { cn } from "@/app/lib/utils";

/** One per entry in AppSidebar's NAV_ITEMS. */
const NAV_ROW_WIDTHS = ["w-20", "w-10", "w-16", "w-14", "w-24", "w-20", "w-18"];
const CONTENT_ROW_WIDTHS = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-3/5", "w-2/3"];
/** AppSidebar's own placeholders use this tone on the glass card. */
const ON_GLASS = "bg-gray-200";

/**
 * The loading state of every page inside the sidebar layout (`(pages)/`):
 * the sidebar and the page header in their final places, so the page
 * fills in instead of replacing a full-screen spinner. Mirrors the boxes of
 * `(pages)/layout.tsx`, AppSidebar (open on desktop, closed on phones) and
 * PageHeader; change it with them.
 */
export function AppShellSkeleton() {
    return (
        <div
            role="status"
            aria-label="Loading"
            data-slot="app-shell-skeleton"
            className="h-dvh flex flex-col bg-app-background"
        >
            <div className="flex-1 flex min-w-0">
                <div
                    data-slot="app-shell-skeleton-sidebar"
                    className={cn(
                        "hidden w-62 h-[calc(100dvh-1.5rem)] my-3 ml-3 shrink-0 flex-col rounded-2xl md:flex",
                        LIQUID_GLASS_FLOAT_CLASS,
                    )}
                >
                    <div className="flex h-11 shrink-0 items-center px-3">
                        <SkeletonLine className={cn("h-5 w-16", ON_GLASS)} />
                    </div>
                    <div className="flex-1 pt-1.5">
                        {NAV_ROW_WIDTHS.map((width, index) => (
                            <div key={index} className="px-1.5 py-0.5">
                                <div className="flex h-8 items-center gap-2 px-2">
                                    <SkeletonLine className={cn("h-4 w-4", ON_GLASS)} />
                                    <SkeletonLine className={cn(width, ON_GLASS)} />
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="shrink-0 p-1">
                        <div className="flex h-9 items-center gap-2 px-[7px]">
                            <SkeletonLine className={cn("h-5.5 w-5.5 rounded-full", ON_GLASS)} />
                            <SkeletonLine className={cn("w-28", ON_GLASS)} />
                        </div>
                    </div>
                </div>
                <div className="flex-1 flex flex-col h-dvh min-w-0">
                    {/* The phone header: the sidebar's open button. */}
                    <div className="flex shrink-0 items-center px-4 pb-2 pt-3 md:hidden">
                        <SkeletonLine className="h-8 w-8 rounded-full" />
                    </div>
                    <div
                        className={cn(
                            "flex items-center mx-3 md:mx-6.5",
                            PAGE_HEADER_ROW_CLASS,
                        )}
                    >
                        <SkeletonLine className="h-5 w-40" />
                    </div>
                    <div className="mx-3 space-y-4 md:mx-6.5">
                        {CONTENT_ROW_WIDTHS.map((width, index) => (
                            <SkeletonLine key={index} className={width} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
