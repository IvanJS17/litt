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
}));
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
        expect(await screen.findByText("Mi formación")).toBeInTheDocument();
        expect(await screen.findByText("Ana Mentora")).toBeInTheDocument();
        expect(
            screen.getByText("ana.mentora.con.un.correo.muy.largo@despacho-ruiz.example.mx"),
        ).toBeInTheDocument();
        expect(screen.getByText("Todas las materias: Junior")).toBeInTheDocument();
        expect(screen.getByText("Employment: Pasante")).toBeInTheDocument();
        expect(screen.queryByText("Mis pupilos")).toBeNull();
    });

    it("tells a lawyer they have no training", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([]);
        render(<TrainingSettings />);
        expect(await screen.findByText(/No tienes mentor en ninguna organización/)).toBeInTheDocument();
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
        expect(await screen.findByText("Mis pupilos")).toBeInTheDocument();
        expect(await screen.findByText("Luis Pasante")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Guardar etapa" }));
        await waitFor(() =>
            expect(api.setTrainingStage).toHaveBeenCalledWith("org-1", "pupil-1", null, "pasante"),
        );

        const stage = screen.getByText("fiscal: Pasante").closest("li")!;
        fireEvent.click(within(stage).getByRole("button", { name: "Quitar" }));
        await waitFor(() =>
            expect(api.removeTrainingStage).toHaveBeenCalledWith("org-1", "pupil-1", "fiscal"),
        );

        fireEvent.click(screen.getByRole("button", { name: "Liberar" }));
        await waitFor(() => expect(api.releaseTrainingPupil).toHaveBeenCalledWith("org-1", "pupil-1"));
        expect(screen.getByRole("button", { name: "Agregar pupilo" })).toBeDisabled();
    });
});
