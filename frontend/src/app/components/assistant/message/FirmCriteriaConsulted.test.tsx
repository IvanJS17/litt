import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import type { AssistantEvent } from "../../shared/types";
import { FirmCriteriaConsulted } from "./FirmCriteriaConsulted";

// «Criterios consultados» under an answer, in es-MX: the criteria as the
// server emitted them, with author and date, and honest about nothing found.

const renderEs = (events: AssistantEvent[]) =>
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            <FirmCriteriaConsulted events={events} />
        </IntlClientProvider>,
    );

const criterion = (over: Record<string, unknown> = {}) => ({
    id: "c1",
    kind: "criterio" as const,
    practice: "mercantil",
    topic: "Prescripción cambiaria",
    position: "El plazo corre desde el vencimiento.",
    author_user_id: "u1",
    author_name: "Ana Pérez",
    playbook_id: null,
    rule_id: null,
    created_at: "2026-11-01T18:00:00.000Z",
    updated_at: "2026-11-01T18:00:00.000Z",
    ...over,
});
const event = (over: Record<string, unknown> = {}): AssistantEvent =>
    ({ type: "firm_criteria", call_id: "call-1", practice: null, topic: null, criteria: [criterion()], truncated: false, ...over }) as AssistantEvent;

describe("FirmCriteriaConsulted", () => {
    it("shows nothing when no criteria were consulted", () => {
        const { container } = renderEs([{ type: "content", text: "Hola" }]);
        expect(container).toBeEmptyDOMElement();
    });

    it("names the author and the date of each criterion, and says it is not law", () => {
        renderEs([event()]);
        expect(screen.getByText("1 criterio consultado")).toBeInTheDocument();
        expect(screen.getByText(/No son derecho vigente y LiTT no las verifica/)).toBeInTheDocument();
        expect(screen.getByText("Prescripción cambiaria")).toBeInTheDocument();
        expect(screen.getByText("El plazo corre desde el vencimiento.")).toBeInTheDocument();
        expect(screen.getByText(/^Según Ana Pérez · /)).toBeInTheDocument();
        expect(screen.getByText(/^Criterio · Materia: /)).toBeInTheDocument();
    });

    it("names the practice area in Spanish, though it is stored in English", () => {
        renderEs([event({ criteria: [criterion({ practice: "employment" })] })]);
        expect(screen.getByText(/^Criterio · Materia: Laboral$/)).toBeInTheDocument();
    });

    it("says so for a dissenting opinion, a deleted user, a failure and an empty result", () => {
        renderEs([
            event({ call_id: "a", criteria: [criterion({ kind: "voto_particular", practice: null, rule_id: "r1", author_name: null, author_user_id: null })], truncated: true }),
            event({ call_id: "b", criteria: [] }),
            event({ call_id: "c", criteria: [], error: "x" }),
        ]);
        expect(screen.getByText("Voto particular · Discrepa de una regla de un playbook")).toBeInTheDocument();
        expect(screen.getByText(/^Según un usuario eliminado · /)).toBeInTheDocument();
        expect(screen.getByText(/Hay más criterios que coinciden/)).toBeInTheDocument();
        expect(screen.getByText("Tu despacho no ha escrito un criterio sobre este tema.")).toBeInTheDocument();
        expect(screen.getByText("No se pudieron consultar los criterios del despacho.")).toBeInTheDocument();
        expect(screen.getAllByText(/criterios? consultados?/)).toHaveLength(3);
    });
});
