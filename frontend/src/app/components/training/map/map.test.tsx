import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { MentorCriterionMap } from "./MentorCriterionMap";
import { MyCriterion } from "./MyCriterion";

// «Mi criterio» and the mentor's map section in es-MX: topics, calibration,
// hints and retakes, as counts of one person.

vi.mock("@/app/lib/mikeApi", () => ({
    MikeApiError: class extends Error {
        code: string | null;
        status: number;
        constructor(args: { message: string; status: number; code?: string | null }) {
            super(args.message);
            this.status = args.status;
            this.code = args.code ?? null;
        }
    },
    getMyCriterion: vi.fn(),
    getPupilCriterion: vi.fn(),
    startRetake: vi.fn(async () => ({})),
    answerRetake: vi.fn(async () => ({})),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
vi.mock("@/app/components/modals/ModalSelect", () => ({
    ModalSelect: (props: {
        "aria-label"?: string;
        value: string;
        placeholder?: string;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
    }) => (
        <select aria-label={props["aria-label"]} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
            <option value="">{props.placeholder}</option>
            {props.options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

const renderEs = (ui: React.ReactElement) =>
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            {ui}
        </IntlClientProvider>,
    );

const available: api.TrainingMyCriterion["generation"] = {
    available: true,
    model: "gpt-5.2",
    credential_options: [{ credential_ref: "user:k1", source: "personal" }],
    default_credential_ref: "user:k1",
};

function topic(overrides: Partial<api.TrainingMapTopic> = {}): api.TrainingMapTopic {
    return {
        key: "prescripcion cambiaria",
        label: "Prescripción cambiaria",
        state: "weak",
        events: 5,
        window_hits: 1,
        window_size: 4,
        last_at: "2026-10-01T12:00:00.000Z",
        last_verdict: "no_coincide",
        retake_due: true,
        ...overrides,
    };
}

function retake(overrides: Partial<api.TrainingRetake> = {}): api.TrainingRetake {
    return {
        id: "rt-1",
        org_id: "org-1",
        topic_key: "prescripcion cambiaria",
        topic_label: "Prescripción cambiaria",
        status: "answered",
        question: "¿En cuánto prescribe la acción cambiaria directa?",
        answer: "En tres años desde el vencimiento del título.",
        contrast: "Coincide: tres años.\nFaltó: la interrupción.",
        verdict: "parcial",
        created_at: "2026-10-20T12:00:00.000Z",
        answered_at: "2026-10-20T13:00:00.000Z",
        text_hidden: false,
        ...overrides,
    };
}

function criterion(overrides: Partial<api.TrainingMyCriterion> = {}): api.TrainingMyCriterion {
    return {
        org_id: "org-1",
        trainee_user_id: "pupil-1",
        map: {
            topics: [topic(), topic({ key: "amparo", label: "Amparo indirecto", state: "few_data", events: 2, retake_due: false })],
            min_events: 3,
            window: 4,
            retake_after_days: 14,
        },
        calibration: {
            min_per_level: 3,
            marked_turns: 11,
            levels: [
                { level: 1, marked: 0, coincided: 0, partial: 0, enough: false },
                { level: 2, marked: 2, coincided: 1, partial: 0, enough: false },
                { level: 3, marked: 1, coincided: 0, partial: 1, enough: false },
                { level: 4, marked: 8, coincided: 5, partial: 1, enough: true },
            ],
        },
        hints: { requested: 2, max_level: 3 },
        retakes: [],
        open_retake_id: null,
        generation: available,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.startRetake).mockResolvedValue(retake({ status: "open", answer: null, contrast: null, verdict: null }));
});

describe("Mi criterio", () => {
    it("shows the topics, the calibration and the hints as counts, with no score", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(criterion());
        const { container } = renderEs(<MyCriterion orgId="org-1" />);
        expect(screen.getByLabelText("Cargando…")).toHaveAttribute("aria-busy", "true");

        expect(await screen.findByRole("heading", { name: "Mi criterio" })).toBeInTheDocument();
        expect(screen.getByText("Prescripción cambiaria")).toBeInTheDocument();
        expect(screen.getByText(/Por reforzar · Coincidió 1 de las últimas 4 veces/)).toBeInTheDocument();
        expect(screen.getByText("Aún pocos datos")).toBeInTheDocument();
        expect(screen.getByText("Listo para retomar")).toBeInTheDocument();
        expect(screen.getByText("Cuando lo marcas, coincidió 5 de 8 veces · 1 en parte")).toBeInTheDocument();
        expect(screen.getByText("Cuando lo marcas, coincidió 1 de 2 veces · aún pocos datos")).toBeInTheDocument();
        expect(screen.getByText("Sin turnos marcados en este nivel")).toBeInTheDocument();
        expect(screen.getByText("Pediste 2 pistas; la más alta fue el escalón 3.")).toBeInTheDocument();
        expect(container.textContent).not.toMatch(/%|promedio|ranking|puntaje/i);
    });

    it("explains an empty map and says there are no hints", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(
            criterion({
                map: { topics: [], min_events: 3, window: 4, retake_after_days: 14 },
                calibration: { min_per_level: 3, marked_turns: 0, levels: [] },
                hints: { requested: 0, max_level: 0 },
            }),
        );
        renderEs(<MyCriterion orgId="org-1" />);
        expect(await screen.findByText(/Todavía no tienes temas/)).toBeInTheDocument();
        expect(screen.getByText(/Todavía no has marcado tu seguridad/)).toBeInTheDocument();
        expect(screen.getByText("No has pedido pistas.")).toBeInTheDocument();
        expect(screen.getByText(/lleva 14 días sin trabajarse/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Retomar/ })).not.toBeInTheDocument();
    });

    it("retries a failed load", async () => {
        vi.mocked(api.getMyCriterion).mockRejectedValueOnce(new Error("down")).mockResolvedValue(criterion());
        renderEs(<MyCriterion orgId="org-1" />);
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Prescripción cambiaria")).toBeInTheDocument();
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ action: "cargar tu criterio" }));
    });

    it("asks for a retake of a weak topic that is due and reloads", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(criterion());
        renderEs(<MyCriterion orgId="org-1" />);
        fireEvent.click(await screen.findByRole("button", { name: "Retomar «Prescripción cambiaria»" }));
        await waitFor(() => expect(api.startRetake).toHaveBeenCalledWith("org-1", "prescripcion cambiaria", "user:k1"));
        await waitFor(() => expect(api.getMyCriterion).toHaveBeenCalledTimes(2));
    });

    it("offers no retake while one is open, or without a key", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(
            criterion({ open_retake_id: "rt-1", retakes: [retake({ status: "pending", question: null, answer: null, contrast: null, verdict: null })] }),
        );
        const { unmount } = renderEs(<MyCriterion orgId="org-1" />);
        expect(await screen.findByText("Generando la pregunta…")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Retomar/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));
        await waitFor(() => expect(api.getMyCriterion).toHaveBeenCalledTimes(2));
        unmount();

        vi.mocked(api.getMyCriterion).mockResolvedValue(
            criterion({ generation: { available: false, code: "training_review_key_required" } }),
        );
        renderEs(<MyCriterion orgId="org-1" />);
        expect(await screen.findByText(/necesitas una llave de IA/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Retomar/ })).not.toBeInTheDocument();
    });

    it("reports a refused retake with its own sentence", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(criterion());
        vi.mocked(api.startRetake).mockRejectedValueOnce(new Error("conflict"));
        renderEs(<MyCriterion orgId="org-1" />);
        fireEvent.click(await screen.findByRole("button", { name: /^Retomar «/ }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.objectContaining({
                    action: "generar la retoma",
                    codeMessages: expect.objectContaining({
                        training_retake_not_due: "Este tema todavía no está listo para retomarse.",
                        training_retake_in_progress: expect.stringContaining("Ya tienes una retoma en curso"),
                    }),
                }),
            ),
        );
    });

    it("answers the open retake only with enough text, once", async () => {
        const open = retake({ status: "open", answer: null, contrast: null, verdict: null });
        vi.mocked(api.getMyCriterion).mockResolvedValue(criterion({ open_retake_id: "rt-1", retakes: [open] }));
        renderEs(<MyCriterion orgId="org-1" />);
        const box = await screen.findByRole("textbox", { name: "Tu respuesta" });
        const send = screen.getByRole("button", { name: "Enviar respuesta" });
        expect(send).toBeDisabled();
        expect(screen.getByText(/0\/60 caracteres/)).toBeInTheDocument();
        const text = "La acción cambiaria directa prescribe en tres años contados desde el día del vencimiento.";
        fireEvent.change(box, { target: { value: text } });
        expect(screen.getByText(`${text.length}/4000 caracteres.`)).toBeInTheDocument();
        fireEvent.click(send);
        await waitFor(() => expect(api.answerRetake).toHaveBeenCalledWith("rt-1", text, null));
        await waitFor(() => expect(api.getMyCriterion).toHaveBeenCalledTimes(2));
    });

    it("asks for another key when the one of the retake is gone", async () => {
        const open = retake({ status: "open", answer: null, contrast: null, verdict: null });
        vi.mocked(api.getMyCriterion).mockResolvedValue(
            criterion({
                open_retake_id: "rt-1",
                retakes: [open],
                generation: {
                    ...available,
                    credential_options: [
                        { credential_ref: "user:k1", source: "personal" },
                        { credential_ref: "org:k2", source: "organization" },
                    ],
                    default_credential_ref: null,
                },
            }),
        );
        vi.mocked(api.answerRetake).mockRejectedValueOnce(
            new api.MikeApiError({ message: "gone", status: 409, code: "chat_route_credential_unavailable" }),
        );
        renderEs(<MyCriterion orgId="org-1" />);
        const text = "La acción cambiaria directa prescribe en tres años contados desde el día del vencimiento.";
        fireEvent.change(await screen.findByRole("textbox", { name: "Tu respuesta" }), { target: { value: text } });
        expect(screen.queryByRole("combobox", { name: "Llave" })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));
        const key = await screen.findByRole("combobox", { name: "Llave" });
        expect(screen.getByRole("button", { name: "Enviar respuesta" })).toBeDisabled();
        fireEvent.change(key, { target: { value: "org:k2" } });
        fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));
        await waitFor(() => expect(api.answerRetake).toHaveBeenLastCalledWith("rt-1", text, "org:k2"));
    });

    it("reports a retake closed for lack of its notes with the catalog sentence and lets the person ask again", async () => {
        const open = retake({ status: "open", answer: null, contrast: null, verdict: null });
        const closed = criterion({
            open_retake_id: null,
            retakes: [retake({ status: "failed", question: null, answer: null, contrast: null, verdict: null })],
        });
        vi.mocked(api.getMyCriterion)
            .mockResolvedValueOnce(criterion({ open_retake_id: "rt-1", retakes: [open] }))
            .mockResolvedValue(closed);
        const gone = new api.MikeApiError({ message: "gone", status: 409, code: "training_retake_source_gone" });
        vi.mocked(api.answerRetake).mockRejectedValueOnce(gone);
        renderEs(<MyCriterion orgId="org-1" />);
        const text = "La acción cambiaria directa prescribe en tres años contados desde el día del vencimiento.";
        fireEvent.change(await screen.findByRole("textbox", { name: "Tu respuesta" }), { target: { value: text } });
        fireEvent.click(screen.getByRole("button", { name: "Enviar respuesta" }));
        await waitFor(() => expect(api.getMyCriterion).toHaveBeenCalledTimes(2));
        const [error, options] = vi.mocked(notifyError).mock.calls[0];
        expect(error).toBe(gone);
        // No override: the catalog sentence for the code is what the person reads.
        expect(options?.codeMessages).not.toHaveProperty("training_retake_source_gone");
        expect(screen.queryByRole("combobox", { name: "Llave" })).not.toBeInTheDocument();

        // The closed retake no longer holds the slot: a new one can be asked for.
        expect(await screen.findByRole("button", { name: /^Retomar «/ })).toBeEnabled();
    });

    it("shows an answered retake with its question, answer, contrast and verdict", async () => {
        vi.mocked(api.getMyCriterion).mockResolvedValue(
            criterion({ retakes: [retake(), retake({ id: "rt-0", status: "failed", question: null, answer: null, contrast: null, verdict: null })] }),
        );
        renderEs(<MyCriterion orgId="org-1" />);
        expect(await screen.findByText("¿En cuánto prescribe la acción cambiaria directa?")).toBeInTheDocument();
        expect(screen.getByText("En tres años desde el vencimiento del título.")).toBeInTheDocument();
        expect(screen.getByText(/Coincide: tres años\./)).toBeInTheDocument();
        expect(screen.getByText(/según el contraste de la IA: Coincide en parte/)).toBeInTheDocument();
        expect(screen.getByText(/No se pudo generar la pregunta/)).toBeInTheDocument();
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
});

describe("Mapa y calibración del mentor", () => {
    const pupil = (overrides: Partial<api.TrainingPupilCriterion> = {}): api.TrainingPupilCriterion => {
        const { generation: _generation, ...mine } = criterion();
        void _generation;
        return { ...mine, notes_without_access: 0, retakes_without_access: 0, ...overrides };
    };

    it("reads the pupil's map without a way to start a retake", async () => {
        vi.mocked(api.getPupilCriterion).mockResolvedValue(
            pupil({ retakes: [retake(), retake({ id: "rt-2", question: null, answer: null, contrast: null })], notes_without_access: 2, retakes_without_access: 3 }),
        );
        renderEs(<MentorCriterionMap orgId="org-1" pupilId="pupil-1" />);
        expect(screen.getByLabelText("Cargando…")).toHaveAttribute("aria-busy", "true");
        expect(await screen.findByRole("heading", { name: "Mapa y calibración" })).toBeInTheDocument();
        expect(api.getPupilCriterion).toHaveBeenCalledWith("org-1", "pupil-1");
        expect(screen.getByText("Pidió 2 pistas; la más alta fue el escalón 3.")).toBeInTheDocument();
        expect(screen.getByText("Cuando lo marcas, coincidió 5 de 8 veces · 1 en parte")).toBeInTheDocument();
        expect(screen.getByText("¿En cuánto prescribe la acción cambiaria directa?")).toBeInTheDocument();
        expect(screen.getByText(/3 retomas son de trabajos en asuntos que no puedes abrir/)).toBeInTheDocument();
        expect(screen.getByText(/2 notas son de trabajos en asuntos que no puedes abrir/)).toBeInTheDocument();
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("says when there are no retakes and retries a failed load", async () => {
        vi.mocked(api.getPupilCriterion).mockRejectedValueOnce(new Error("404")).mockResolvedValue(pupil({ hints: { requested: 0, max_level: 0 } }));
        renderEs(<MentorCriterionMap orgId="org-1" pupilId="pupil-1" />);
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Este pupilo no tiene retomas.")).toBeInTheDocument();
        expect(screen.getByText("Este pupilo no ha pedido pistas.")).toBeInTheDocument();
    });
});
