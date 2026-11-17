import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectPageHeader } from "./ProjectPageParts";

vi.mock("@/app/components/shared/PageHeader", () => ({
    PageHeader: ({
        actionGroups,
    }: {
        actionGroups?: Array<
            Array<{ type?: string; render?: React.ReactNode } | null>
        >;
    }) => (
        <div>
            {actionGroups?.flat().map((action, index) =>
                action?.type === "custom" ? (
                    <div key={index}>{action.render}</div>
                ) : null,
            )}
        </div>
    ),
}));

vi.mock("@/app/components/shared/HeaderActionsMenu", () => ({
    HeaderActionsMenu: ({
        items,
    }: {
        items: Array<{
            label: string;
            onSelect: () => void;
            disabled?: boolean;
        }>;
    }) => (
        <div>
            {items.map((item) => (
                <button
                    key={item.label}
                    disabled={item.disabled}
                    onClick={item.onSelect}
                >
                    {item.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("@/app/components/shared/DocumentUploadMenu", () => ({
    DocumentUploadMenu: () => <button>Upload</button>,
}));

function renderHeader(overrides: { roleKnown?: boolean; onOpenRadar?: (() => void) | null } = {}) {
    render(
        <ProjectPageHeader
            project={{ id: "project-1", name: "Matter" } as never}
            search=""
            activeSection="documents"
            creatingReview={false}
            canManageProject
            roleKnown
            onBackToProjects={vi.fn()}
            onProjectRoot={vi.fn()}
            onOpenDetails={vi.fn()}
            onOpenMemory={vi.fn()}
            onDeleteProject={vi.fn()}
            onSearchChange={vi.fn()}
            onOpenAccess={vi.fn()}
            onNewChat={vi.fn()}
            onNewReview={vi.fn()}
            {...overrides}
        />,
    );
}

describe("ProjectPageHeader radar action", () => {
    it("opens the deadline radar of a matter's project from the actions menu", async () => {
        const user = userEvent.setup();
        const onOpenRadar = vi.fn();
        renderHeader({ onOpenRadar });
        await user.click(screen.getByRole("button", { name: "Deadline radar" }));
        expect(onOpenRadar).toHaveBeenCalledTimes(1);
    });

    it("waits for the caller's role before offering it", () => {
        renderHeader({ roleKnown: false, onOpenRadar: vi.fn() });
        expect(screen.getByRole("button", { name: "Deadline radar" })).toBeDisabled();
    });

    it("offers nothing for a project without a matter", () => {
        renderHeader({ onOpenRadar: null });
        expect(screen.queryByRole("button", { name: "Deadline radar" })).not.toBeInTheDocument();
    });
});
