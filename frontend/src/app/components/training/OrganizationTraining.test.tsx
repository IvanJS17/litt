import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const settings = vi.hoisted(() => ({ role: "owner" as "owner" | "member" }));
vi.mock("@/app/components/organizations/OrganizationSettingsShell", () => ({
    useOrganizationSettings: () => ({ orgId: "org-1", org: { id: "org-1", role: settings.role } }),
}));
vi.mock("@/app/lib/mikeApi", () => ({
    listOrgMembers: vi.fn(),
    getOrgTraining: vi.fn(),
    designateTrainingMentor: vi.fn(async () => undefined),
    removeTrainingMentor: vi.fn(async () => undefined),
}));
vi.mock("@/app/lib/userFacingError", () => ({
    notifyError: vi.fn(),
    userFacingApiError: () => "No se pudo cargar la formación.",
}));

beforeEach(() => {
    vi.clearAllMocks();
    settings.role = "owner";
    vi.mocked(api.listOrgMembers).mockResolvedValue([
        { user_id: "mentor-1", display_name: "Ana Mentora", email: "ana@despacho.example.mx", role: "member" },
        { user_id: "pupil-1", display_name: "Luis Pasante", email: "luis@despacho.example.mx", role: "member" },
    ] as unknown as api.OrgMember[]);
    vi.mocked(api.getOrgTraining).mockResolvedValue({
        mentors: ["mentor-1"],
        pupils: [{ trainee_user_id: "pupil-1", mentor_user_id: "mentor-1" }],
    });
});

describe("Organización → Formación", () => {
    it("lists who is a mentor and of whom, and designates a mentor", async () => {
        renderEs(<OrganizationTraining />);
        await screen.findByRole("switch", { name: "Mentor: Luis Pasante" });
        expect(screen.getByText("Mentor de:").parentElement).toHaveTextContent("Mentor de: Luis Pasante");
        expect(screen.getByText(/Pupilo de Ana Mentora/)).toBeInTheDocument();
        const anaSwitch = screen.getByRole("switch", { name: "Mentor: Ana Mentora" });
        expect(anaSwitch).toBeChecked();
        fireEvent.click(screen.getByRole("switch", { name: "Mentor: Luis Pasante" }));
        await waitFor(() => expect(api.designateTrainingMentor).toHaveBeenCalledWith("org-1", "pupil-1"));
    });

    it("explains why a mentor with pupils cannot be retired", async () => {
        const conflict = Object.assign(new Error("conflict"), { code: "training_mentor_has_pupils" });
        vi.mocked(api.removeTrainingMentor).mockRejectedValueOnce(conflict);
        renderEs(<OrganizationTraining />);
        fireEvent.click(await screen.findByRole("switch", { name: "Mentor: Ana Mentora" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                conflict,
                expect.objectContaining({
                    codeMessages: expect.objectContaining({
                        training_mentor_has_pupils: expect.stringContaining("todavía tiene pupilos"),
                    }),
                }),
            ),
        );
    });

    it("offers nothing to a member and reads nothing", () => {
        settings.role = "member";
        renderEs(<OrganizationTraining />);
        expect(screen.getByText(/Solo el dueño o un administrador/)).toBeInTheDocument();
        expect(api.getOrgTraining).not.toHaveBeenCalled();
    });
});
