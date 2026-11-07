import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    getWorkflow,
    getWorkflowPeople,
    listWorkflowShares,
} from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { WorkflowDetailPage } from "./WorkflowDetailPage";

// The deployment flag that would show upstream's "Open source this" action.
// The page reads it when the module loads, hence hoisted.
vi.hoisted(() => {
    process.env.NEXT_PUBLIC_WORKFLOW_CONTRIBUTIONS_ENABLED = "true";
});

vi.mock("@/app/hooks/useItemWorkspace", () => ({ useItemWorkspace: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getWorkflow: vi.fn(),
    getWorkflowPeople: vi.fn(),
    listWorkflowShares: vi.fn(),
}));
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn() }),
    useSearchParams: () => ({ get: () => null }),
}));
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: "me", email: "me@firm.test" } }),
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: { practiceAreas: [] } }),
}));
vi.mock("@/app/hooks/useQueryParamTab", () => ({
    useQueryParamTab: () => ["prompt", vi.fn()],
}));
vi.mock("@/app/components/ui/markdown-editor", () => ({
    MarkdownEditor: () => null,
}));
vi.mock("./WorkflowAssets", () => ({ WorkflowAssets: () => null }));
vi.mock("@/app/components/workflows/UseWorkflowModal", () => ({
    UseWorkflowModal: () => null,
}));
vi.mock("@/app/components/workflows/NewWorkflowModal", () => ({
    NewWorkflowModal: () => null,
}));
vi.mock("@/app/components/modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));

const workflow = {
    id: "workflow-1",
    is_owner: true,
    access_role: "owner",
    org_id: null,
    metadata: {
        title: "Contract Intake",
        type: "assistant",
        language: "English",
        practice: null,
        jurisdictions: null,
    },
    skill_md: "",
} as unknown as Workflow;

describe("WorkflowDetailPage open-source submission (LiTT)", () => {
    beforeEach(() => {
        vi.mocked(getWorkflow).mockResolvedValue(workflow);
        vi.mocked(getWorkflowPeople).mockResolvedValue({
            owner: { user_id: "me", email: "me@firm.test", display_name: "Me", role: "owner" },
            members: [],
        });
        vi.mocked(listWorkflowShares).mockResolvedValue([]);
        vi.stubGlobal(
            "matchMedia",
            vi.fn().mockReturnValue({
                matches: true,
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
            }),
        );
    });

    it("never offers publishing to upstream's catalog, even with the env flag on", async () => {
        const user = userEvent.setup();
        render(<WorkflowDetailPage id="workflow-1" workflowType="assistant" />);
        await user.click(await screen.findByRole("button", { name: "Workflow actions" }));
        const items = (await screen.findAllByRole("menuitem")).map((item) => item.textContent);
        expect(items).toContain("Download workflow");
        expect(items).not.toContain("Open source this");
        expect(screen.queryByText(/mike-workflows/)).toBeNull();
    });
});
