import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/app/lib/mikeApi";
import { TrainingSettings } from "./TrainingSettings";

vi.mock("@/app/lib/mikeApi", () => ({
    getMyTraining: vi.fn(),
    getMyPupils: vi.fn(),
    listOrgMembers: vi.fn(),
    assignTrainingPupil: vi.fn(async () => undefined),
    releaseTrainingPupil: vi.fn(async () => undefined),
    setTrainingStage: vi.fn(async () => undefined),
    removeTrainingStage: vi.fn(async () => undefined),
    getMySupervision: vi.fn(async () => ({ org_id: "org-1", work_reviews: [], defenses: [], urgency_passes: [] })),
    listProjects: vi.fn(async () => []),
    // Layer 3, full reading: a junior's notice in Mi formación.
    getMyReadings: vi.fn(async () => ({
        org_id: "org-1",
        eligibility: { is_junior: true, due: false, open_reading_id: null, last_submitted_at: null, next_due_at: null },
        generation: { available: false, code: "training_review_key_required" },
        readings: [],
    })),
    startReading: vi.fn(),
    // Layer 3, own map: «Mi criterio» in Mi formación.
    listMyGymAttempts: vi.fn(async () => []),
    getMyCriterion: vi.fn(async () => ({
        org_id: "org-1",
        trainee_user_id: "me",
        map: { topics: [], min_events: 3, window: 4, retake_after_days: 14 },
        calibration: { min_per_level: 3, marked_turns: 0, levels: [] },
        hints: { requested: 0, max_level: 0 },
        retakes: [],
        open_retake_id: null,
        generation: { available: false, code: "training_review_key_required" },
    })),
    startRetake: vi.fn(),
    answerRetake: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspace: () => ({ organizations: [{ id: "org-1", name: "Despacho Ruiz" }] }),
}));
vi.mock("@/app/lib/userFacingError", () => ({
    notifyError: vi.fn(),
    userFacingApiError: () => "No se pudo cargar tu formación.",
}));

const members = [
    { user_id: "mentor-1", display_name: "Ana Mentora", email: "ana.mentora.con.un.correo.muy.largo@despacho-ruiz.example.mx", role: "member" },
    { user_id: "pupil-1", display_name: "Luis Pasante", email: "luis@despacho-ruiz.example.mx", role: "member" },
    { user_id: "free-1", display_name: "Eva Libre", email: "eva@despacho-ruiz.example.mx", role: "member" },
] as unknown as api.OrgMember[];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOrgMembers).mockResolvedValue(members);
});

describe("Ajustes → Formación", () => {
    it("shows a pupil their mentor and stages, with the email whole", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([
            {
                org_id: "org-1",
                is_mentor: false,
                mentor_user_id: "mentor-1",
                stages: [
                    { practice: null, stage: "junior" },
                    { practice: "employment", stage: "pasante" },
                ],
            },
        ]);
        render(<TrainingSettings />);
        expect(await screen.findByText("My training")).toBeInTheDocument();
        expect(await screen.findByText("Ana Mentora")).toBeInTheDocument();
        expect(
            screen.getByText("ana.mentora.con.un.correo.muy.largo@despacho-ruiz.example.mx"),
        ).toBeInTheDocument();
        expect(screen.getByText("All practice areas: Junior")).toBeInTheDocument();
        expect(screen.getByText("Employment: Intern")).toBeInTheDocument();
        expect(screen.queryByText("My pupils")).toBeNull();
        // Layer 2: what their mentor sees of them, in that organization.
        expect(await screen.findByText("What my mentor sees of me")).toBeInTheDocument();
        expect(api.getMySupervision).toHaveBeenCalledWith("org-1");
        // Layer 3: their own map, calibration and retakes.
        expect(await screen.findByRole("heading", { name: "My criterion" })).toBeInTheDocument();
        expect(api.getMyCriterion).toHaveBeenCalledWith("org-1");
        // Layer 3, criteria contrast: a junior reaches its page from here.
        expect(screen.getByRole("link", { name: "Criteria contrast" })).toHaveAttribute("href", "/settings/training/contrast");
    });

    it("tells a lawyer they have no training", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([]);
        render(<TrainingSettings />);
        expect(await screen.findByText(/You don't have a mentor in any organization/)).toBeInTheDocument();
    });

    it("lets a mentor take a pupil, set and remove a stage, and release them", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([
            { org_id: "org-1", is_mentor: true, mentor_user_id: null, stages: [] },
        ]);
        vi.mocked(api.getMyPupils).mockResolvedValue({
            pupils: [{ user_id: "pupil-1", stages: [{ practice: "fiscal", stage: "pasante" }] }],
            candidates: ["free-1"],
        });
        render(<TrainingSettings />);
        expect(await screen.findByText("My pupils")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Open the mentor panel" })).toHaveAttribute(
            "href",
            "/settings/training/mentor",
        );
        expect(await screen.findByText("Luis Pasante")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Save stage" }));
        await waitFor(() =>
            expect(api.setTrainingStage).toHaveBeenCalledWith("org-1", "pupil-1", null, "pasante"),
        );

        const stage = screen.getByText("fiscal: Intern").closest("li")!;
        fireEvent.click(within(stage).getByRole("button", { name: "Remove" }));
        await waitFor(() =>
            expect(api.removeTrainingStage).toHaveBeenCalledWith("org-1", "pupil-1", "fiscal"),
        );

        fireEvent.click(screen.getByRole("button", { name: "Release" }));
        await waitFor(() => expect(api.releaseTrainingPupil).toHaveBeenCalledWith("org-1", "pupil-1"));
        expect(screen.getByRole("button", { name: "Add pupil" })).toBeDisabled();
    });
});
