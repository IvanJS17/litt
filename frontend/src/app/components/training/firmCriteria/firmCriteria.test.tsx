import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { FirmCriteriaSection } from "./FirmCriteriaSettings";

// Ajustes → Criterios del despacho, in es-MX: what each person is offered,
// the form, the two-step removal, and loading that has the page's layout.

vi.mock("@/app/lib/mikeApi", () => ({
    listFirmCriteria: vi.fn(),
    createFirmCriterion: vi.fn(async () => ({})),
    updateFirmCriterion: vi.fn(async () => ({})),
    deleteFirmCriterion: vi.fn(async () => ({ deleted: true })),
    listPlaybooks: vi.fn(async () => []),
}));
vi.mock("@/app/lib/userFacingError", () => ({
    notifyError: vi.fn(),
    userFacingApiError: () => "No se pudieron cargar los criterios del despacho.",
}));

const renderEs = () =>
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            <FirmCriteriaSection orgId="org-1" orgName="Despacho Ruiz" />
        </IntlClientProvider>,
    );

const criterion = (over: Partial<api.FirmCriterion> = {}): api.FirmCriterion => ({
    id: "c1",
    kind: "criterio",
    practice: "mercantil",
    topic: "Prescripción cambiaria",
    position: "El plazo corre desde el vencimiento.\nSegunda línea de la postura.",
    author_user_id: "u1",
    author_name: "Ana Pérez",
    playbook_id: null,
    rule_id: null,
    created_at: "2026-11-01T18:00:00.000Z",
    updated_at: "2026-11-01T18:00:00.000Z",
    mine: true,
    ...over,
});
const list = (over: Partial<api.FirmCriteriaList> = {}): api.FirmCriteriaList => ({
    criteria: [criterion()],
    can_write: true,
    can_manage: false,
    max_per_organization: 500,
    ...over,
});
const playbook = {
    id: "p1",
    orgId: "org-1",
    name: "Playbook de arrendamiento",
    content: { topics: [{ id: "t1", name: "Rentas", rules: [{ id: "r1", name: "Renta anticipada" }, { id: "r2", name: "Depósito" }] }] },
} as unknown as api.Playbook;

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listPlaybooks).mockResolvedValue([playbook, { ...playbook, id: "p-other", orgId: "org-2", name: "Ajeno" }]);
});

describe("Ajustes del despacho → Formación → Criterios del despacho", () => {
    it("loads with its own skeleton, then lists criteria with author, date and kind", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list());
        const { container } = renderEs();
        expect(container.querySelector(".animate-pulse")).not.toBeNull();
        expect(await screen.findByText("Prescripción cambiaria")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Criterios del despacho" })).toBeInTheDocument();
        expect(screen.getByText(/No son derecho vigente y LiTT no las verifica/)).toBeInTheDocument();
        expect(screen.getByText(/Las escribe quien no esté en formación/)).toBeInTheDocument();
        expect(screen.getByText("1 criterio")).toBeInTheDocument();
        expect(screen.getByText(/^Criterio · /)).toHaveTextContent("Criterio · mercantil · Tuyo");
        expect(screen.getByText(/Segunda línea de la postura\./)).toBeInTheDocument();
        expect(screen.getByText(/^De Ana Pérez · /)).toBeInTheDocument();
        expect(api.listFirmCriteria).toHaveBeenCalledWith("org-1");
    });

    it("says an empty firm has no criteria yet", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ criteria: [] }));
        renderEs();
        expect(await screen.findByText("Tu despacho todavía no ha escrito criterios.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Escribir un criterio" })).toBeEnabled();
    });

    it("offers a trainee nothing to write, change or remove", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ can_write: false, criteria: [criterion({ mine: false, author_name: null })] }));
        renderEs();
        expect(await screen.findByText(/^De un usuario eliminado · /)).toBeInTheDocument();
        expect(screen.getByText("Mientras estás en formación lees los criterios de tu despacho, pero no los escribes.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Escribir un criterio" })).toBeNull();
        expect(screen.queryByRole("button", { name: /Editar|Quitar/ })).toBeNull();
    });

    it("lets an owner or admin remove another person's criterion but not edit it", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ can_manage: true, criteria: [criterion({ mine: false })] }));
        renderEs();
        await screen.findByText("Prescripción cambiaria");
        expect(screen.queryByRole("button", { name: /Editar/ })).toBeNull();
        expect(screen.getByRole("button", { name: "Quitar el criterio «Prescripción cambiaria»" })).toBeInTheDocument();
    });

    it("writes a criterion: needs a topic and a position, sends them trimmed, and reloads", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ criteria: [] }));
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        const save = screen.getByRole("button", { name: "Guardar" });
        expect(save).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "  Intereses  " } });
        fireEvent.change(screen.getByLabelText("Postura"), { target: { value: " Se pactan por escrito. " } });
        expect(screen.getByText("24 de 2000 caracteres")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Materia"), { target: { value: "Employment" } });
        expect(save).toBeEnabled();
        fireEvent.click(save);
        await waitFor(() =>
            expect(api.createFirmCriterion).toHaveBeenCalledWith("org-1", {
                kind: "criterio",
                topic: "Intereses",
                position: "Se pactan por escrito.",
                practice: "Employment",
            }),
        );
        expect(await screen.findByText("Se guardó el criterio.")).toBeInTheDocument();
        expect(api.listFirmCriteria).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();
    });

    it("writes a dissenting opinion that names a rule of a playbook of this firm only", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ criteria: [] }));
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        fireEvent.click(screen.getByRole("radio", { name: "Voto particular" }));
        expect(screen.getByText(/nombra la regla del playbook de la que discrepas/)).toBeInTheDocument();
        const playbookSelect = await screen.findByLabelText("Playbook");
        await waitFor(() => expect(within(playbookSelect).getAllByRole("option")).toHaveLength(2));
        expect(within(playbookSelect).queryByText("Ajeno")).toBeNull();
        expect(screen.getByLabelText("Regla")).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "Renta" } });
        fireEvent.change(screen.getByLabelText("Postura"), { target: { value: "Discrepo." } });
        expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
        fireEvent.change(playbookSelect, { target: { value: "p1" } });
        fireEvent.change(screen.getByLabelText("Regla"), { target: { value: "r2" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
        await waitFor(() =>
            expect(api.createFirmCriterion).toHaveBeenCalledWith("org-1", {
                kind: "voto_particular",
                topic: "Renta",
                position: "Discrepo.",
                practice: null,
                playbook_id: "p1",
                rule_id: "r2",
            }),
        );
    });

    it("clears the rule when the playbook changes, and says when there are no playbooks", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ criteria: [] }));
        vi.mocked(api.listPlaybooks).mockResolvedValue([playbook, { ...playbook, id: "p2", name: "Otro", content: { topics: [{ id: "t", name: "T", rules: [{ id: "x", name: "Otra regla" }] }] } } as unknown as api.Playbook]);
        const { unmount } = renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        fireEvent.click(screen.getByRole("radio", { name: "Voto particular" }));
        await waitFor(() => expect(within(screen.getByLabelText("Playbook")).getAllByRole("option")).toHaveLength(3));
        fireEvent.change(screen.getByLabelText("Playbook"), { target: { value: "p1" } });
        fireEvent.change(screen.getByLabelText("Regla"), { target: { value: "r1" } });
        fireEvent.change(screen.getByLabelText("Playbook"), { target: { value: "p2" } });
        expect(screen.getByLabelText("Regla")).toHaveValue("");
        unmount();
        vi.mocked(api.listPlaybooks).mockResolvedValue([]);
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        fireEvent.click(screen.getByRole("radio", { name: "Voto particular" }));
        expect(await screen.findByText("Todavía no hay playbooks de los que discrepar.")).toBeInTheDocument();
    });

    it("edits one of mine, with its values in the form", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list());
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Editar el criterio «Prescripción cambiaria»" }));
        expect(screen.getByLabelText("Tema")).toHaveValue("Prescripción cambiaria");
        expect(screen.getByLabelText("Materia")).toHaveValue("mercantil");
        expect(screen.getByRole("radio", { name: "Criterio" })).toBeChecked();
        fireEvent.change(screen.getByLabelText("Postura"), { target: { value: "Otra postura." } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
        await waitFor(() =>
            expect(api.updateFirmCriterion).toHaveBeenCalledWith("org-1", "c1", {
                kind: "criterio",
                topic: "Prescripción cambiaria",
                position: "Otra postura.",
                practice: "mercantil",
            }),
        );
    });

    it("cancels a form, and removes only after a second confirmation", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list());
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
        expect(screen.queryByRole("button", { name: "Guardar" })).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "Quitar el criterio «Prescripción cambiaria»" }));
        expect(screen.getByText("¿Quieres quitar este criterio? No se puede deshacer.")).toBeInTheDocument();
        expect(api.deleteFirmCriterion).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
        expect(api.deleteFirmCriterion).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Quitar el criterio «Prescripción cambiaria»" }));
        fireEvent.click(screen.getByRole("button", { name: "Sí, quitarlo" }));
        await waitFor(() => expect(api.deleteFirmCriterion).toHaveBeenCalledWith("org-1", "c1"));
        expect(await screen.findByText("Se quitó el criterio.")).toBeInTheDocument();
    });

    it("shows a failure to save with notifyError and keeps the form open", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(list({ criteria: [] }));
        vi.mocked(api.createFirmCriterion).mockRejectedValueOnce(new Error("boom"));
        renderEs();
        fireEvent.click(await screen.findByRole("button", { name: "Escribir un criterio" }));
        fireEvent.change(screen.getByLabelText("Tema"), { target: { value: "T" } });
        fireEvent.change(screen.getByLabelText("Postura"), { target: { value: "P" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
        await waitFor(() => expect(notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "save the criterion", operation: "firm_criteria.write" }));
        expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
    });

    it("says why it cannot load, and keeps going without the playbooks", async () => {
        vi.mocked(api.listFirmCriteria).mockRejectedValue(new Error("down"));
        vi.mocked(api.listPlaybooks).mockRejectedValue(new Error("down"));
        renderEs();
        expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los criterios del despacho.");
    });

    it("names a dissenting opinion's rule and playbook, or says it cannot open them, and stops at the limit", async () => {
        vi.mocked(api.listFirmCriteria).mockResolvedValue(
            list({
                max_per_organization: 2,
                criteria: [
                    criterion({ id: "v1", kind: "voto_particular", playbook_id: "p1", rule_id: "r1", practice: null, updated_at: "2026-11-03T18:00:00.000Z" }),
                    criterion({ id: "v2", kind: "voto_particular", playbook_id: null, rule_id: "r9", practice: null }),
                ],
            }),
        );
        renderEs();
        expect(await screen.findByText("Discrepa de la regla «Renta anticipada» de «Playbook de arrendamiento»")).toBeInTheDocument();
        expect(screen.getByText("Discrepa de una regla de un playbook que no puedes abrir")).toBeInTheDocument();
        expect(screen.getByText(/· cambiado el /)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Escribir un criterio" })).toBeDisabled();
        expect(screen.getByText(/Quita uno para escribir otro/)).toBeInTheDocument();
    });
});
