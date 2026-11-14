import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { OrganizationTraining } from "./OrganizationTraining";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

// These screens are written in Spanish (LiTT's own), so they render in es-MX.
const wrapEs = (ui: ReactElement) => (
    <IntlClientProvider locale="es-MX" messages={esMX}>
        {ui}
    </IntlClientProvider>
);
const renderEs = (ui: ReactElement) => {
    const result = render(wrapEs(ui));
    return { ...result, rerender: (next: ReactElement) => result.rerender(wrapEs(next)) };
};

const settings = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member" }));
vi.mock("@/app/components/organizations/OrganizationSettingsShell", () => ({
    useOrganizationSettings: () => ({
        orgId: "org-1",
        org: { id: "org-1", name: "Despacho Ruiz", role: settings.role },
    }),
}));
vi.mock("@/app/lib/mikeApi", () => ({
    listOrgMembers: vi.fn(),
    getOrgTraining: vi.fn(),
    designateTrainingMentor: vi.fn(async () => undefined),
    removeTrainingMentor: vi.fn(async () => undefined),
    assignTrainingPupil: vi.fn(async () => undefined),
    releaseTrainingPupil: vi.fn(async () => undefined),
    // The firm's criteria, below the mentors.
    listFirmCriteria: vi.fn(),
    createFirmCriterion: vi.fn(),
    updateFirmCriterion: vi.fn(),
    deleteFirmCriterion: vi.fn(),
    listPlaybooks: vi.fn(async () => []),
}));
vi.mock("@/app/lib/userFacingError", () => ({
    notifyError: vi.fn(),
    userFacingApiError: () => "No se pudo cargar la formación.",
}));
// The dropdown is Radix; a native select keeps these tests about the page.
vi.mock("@/app/components/modals/ModalSelect", () => ({
    ModalSelect: (props: {
        "aria-label"?: string;
        value: string;
        disabled?: boolean;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
    }) => (
        <select
            aria-label={props["aria-label"]}
            value={props.value}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.value)}
        >
            {props.options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

beforeEach(() => {
    vi.clearAllMocks();
    settings.role = "owner";
    vi.mocked(api.listOrgMembers).mockResolvedValue([
        { user_id: "boss", display_name: "Dora Dueña", email: "dora@despacho.example.mx", role: "owner" },
        { user_id: "mentor-1", display_name: "Ana Mentora", email: "ana@despacho.example.mx", role: "member" },
        { user_id: "pupil-1", display_name: "Luis Pasante", email: "luis@despacho.example.mx", role: "member" },
        { user_id: "free-1", display_name: "Eva Libre", email: "eva@despacho.example.mx", role: "member" },
    ] as unknown as api.OrgMember[]);
    vi.mocked(api.getOrgTraining).mockResolvedValue({
        mentors: ["mentor-1"],
        pupils: [{ trainee_user_id: "pupil-1", mentor_user_id: "mentor-1" }],
    });
    vi.mocked(api.listFirmCriteria).mockResolvedValue({
        criteria: [],
        can_write: true,
        can_manage: true,
        max_per_organization: 500,
    });
});

describe("Ajustes del despacho → Formación, for an owner or admin", () => {
    it("shows who is a mentor and of whom, and designates a mentor", async () => {
        renderEs(<OrganizationTraining />);
        await screen.findByRole("switch", { name: "Mentor: Luis Pasante" });
        expect(screen.getByRole("heading", { name: "Mentores y aprendices" })).toBeInTheDocument();
        expect(screen.getByText("Mentor de:").parentElement).toHaveTextContent("Mentor de: Luis Pasante");
        expect(screen.getByRole("combobox", { name: "Elegir mentor para Luis Pasante" })).toHaveValue("mentor-1");
        expect(screen.getByRole("switch", { name: "Mentor: Ana Mentora" })).toBeChecked();
        fireEvent.click(screen.getByRole("switch", { name: "Mentor: Luis Pasante" }));
        await waitFor(() => expect(api.designateTrainingMentor).toHaveBeenCalledWith("org-1", "pupil-1"));
    });

    it("assigns a member without a mentor to the one it chooses, moves them and frees them", async () => {
        renderEs(<OrganizationTraining />);
        const free = await screen.findByRole("combobox", { name: "Elegir mentor para Eva Libre" });
        expect(free).toHaveValue("");
        expect(within(free).getByRole("option", { name: "Sin mentor" })).toBeInTheDocument();
        // A member is never offered as their own mentor.
        expect(within(free).queryByRole("option", { name: "Eva Libre" })).toBeNull();
        fireEvent.change(free, { target: { value: "mentor-1" } });
        await waitFor(() => expect(api.assignTrainingPupil).toHaveBeenCalledWith("org-1", "free-1", "mentor-1"));

        fireEvent.change(screen.getByRole("combobox", { name: "Elegir mentor para Luis Pasante" }), {
            target: { value: "" },
        });
        await waitFor(() => expect(api.releaseTrainingPupil).toHaveBeenCalledWith("org-1", "pupil-1"));
    });

    it("never offers an owner or admin a mentor to choose, and says why", async () => {
        renderEs(<OrganizationTraining />);
        await screen.findByRole("switch", { name: "Mentor: Dora Dueña" });
        expect(screen.queryByRole("combobox", { name: "Elegir mentor para Dora Dueña" })).toBeNull();
        // The role is a tag on the row, not a sentence under it; the rule is under «Más información».
        expect(screen.getByText("Propietario")).toBeVisible();
        // «Not verified» is a notice: in view, never folded.
        expect(screen.getByText("No son derecho vigente y LiTT no las verifica.").closest("details")).toBeNull();
        expect(screen.getByText(/nunca aprendices/).closest("details")).not.toBeNull();
        // They can be mentors.
        expect(screen.getByRole("switch", { name: "Mentor: Dora Dueña" })).not.toBeChecked();
    });

    it("asks to name a mentor first when there is none, and offers the firm's criteria below", async () => {
        vi.mocked(api.getOrgTraining).mockResolvedValue({ mentors: [], pupils: [] });
        renderEs(<OrganizationTraining />);
        expect(await screen.findByText(/Todavía no hay mentores/)).toBeInTheDocument();
        expect(await screen.findByRole("combobox", { name: "Elegir mentor para Eva Libre" })).toBeDisabled();
        expect(screen.getByRole("heading", { name: "Criterios del despacho" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Escribir un criterio" })).toBeEnabled();
        expect(api.listFirmCriteria).toHaveBeenCalledWith("org-1");
    });

    it("explains why a mentor with aprendices cannot be retired", async () => {
        const conflict = Object.assign(new Error("conflict"), { code: "training_mentor_has_pupils" });
        vi.mocked(api.removeTrainingMentor).mockRejectedValueOnce(conflict);
        renderEs(<OrganizationTraining />);
        fireEvent.click(await screen.findByRole("switch", { name: "Mentor: Ana Mentora" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                conflict,
                expect.objectContaining({
                    codeMessages: expect.objectContaining({
                        training_mentor_has_pupils: expect.stringContaining("todavía tiene aprendices"),
                    }),
                }),
            ),
        );
    });

    it("works the same for an admin", async () => {
        settings.role = "admin";
        renderEs(<OrganizationTraining />);
        expect(await screen.findByRole("switch", { name: "Mentor: Ana Mentora" })).toBeInTheDocument();
    });
});

describe("Ajustes del despacho → Formación, for a member", () => {
    it("shows only the firm's criteria, reads nothing of mentors, and writes when the server lets them", async () => {
        settings.role = "member";
        renderEs(<OrganizationTraining />);
        expect(screen.getByText(/Aquí lees los criterios de tu despacho/)).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Escribir un criterio" })).toBeEnabled();
        expect(screen.queryByRole("heading", { name: "Mentores y aprendices" })).toBeNull();
        expect(api.getOrgTraining).not.toHaveBeenCalled();
        expect(api.listOrgMembers).not.toHaveBeenCalled();
    });

    it("lets a member in training read the criteria but not write them", async () => {
        settings.role = "member";
        vi.mocked(api.listFirmCriteria).mockResolvedValue({
            criteria: [],
            can_write: false,
            can_manage: false,
            max_per_organization: 500,
        });
        renderEs(<OrganizationTraining />);
        expect(
            await screen.findByText("Mientras estás en formación lees los criterios de tu despacho, pero no los escribes."),
        ).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Escribir un criterio" })).toBeNull();
    });
});
