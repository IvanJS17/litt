import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { ContrastPage } from "./ContrastPage";
import { MentorCriteriaContrasts } from "./MentorCriteriaContrasts";
import { comparisonParts } from "./contrastShared";

// The criteria contrast (training layer 3) on screen, in es-MX: starting it,
// the two analyses side by side with the person's own explanation first, the
// comparison, a route that could not run, and the mentor's section.

vi.mock("@/app/lib/mikeApi", () => ({
    getMyTraining: vi.fn(),
    getMyCriteriaContrasts: vi.fn(),
    getTrainingStage: vi.fn(),
    getSubagentRoutes: vi.fn(),
    runCriteriaContrastTurn: vi.fn(),
    getPupilCriteriaContrasts: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
// The dropdown is Radix; a native select keeps these tests about the page.
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

const intl = (ui: React.ReactElement) => (
    <IntlClientProvider locale="es-MX" messages={esMX}>
        {ui}
    </IntlClientProvider>
);

const ORG = "org-1";
const route = (name: string, over: Partial<api.TrainingCriteriaContrastRoute> = {}): api.TrainingCriteriaContrastRoute => ({
    name,
    provider: "gemini",
    model: `modelo-${name}`,
    status: "completed",
    ...over,
});
const contrast = (over: Partial<api.TrainingCriteriaContrast> = {}): api.TrainingCriteriaContrast => ({
    id: "k1",
    org_id: ORG,
    chat_id: "chat-1",
    status: "awaiting_person",
    routes: [route("rapida"), route("profunda")],
    briefs: ["El plazo corre desde la notificación.", "El plazo corre desde el emplazamiento."],
    person_explanation: null,
    comparison: null,
    created_at: "2026-11-08T12:00:00.000Z",
    ...over,
});
const EXPLANATION = "Creo que divergen porque uno cuenta el plazo desde la notificación y el otro desde el emplazamiento.";

function setup(opts: { stage?: string; modes?: string[]; routes?: string[]; contrasts?: api.TrainingCriteriaContrast[] } = {}) {
    vi.mocked(api.getMyTraining).mockResolvedValue(
        opts.stage === "none" ? [] : ([{ org_id: ORG, is_mentor: false, mentor_user_id: "m", stages: [{ practice: null, stage: opts.stage ?? "junior" }] }] as never),
    );
    vi.mocked(api.getTrainingStage).mockResolvedValue({
        stage: "junior",
        attempt_required: false,
        urgency_pass: null,
        modes: (opts.modes ?? ["criteria_contrast"]) as never,
    });
    vi.mocked(api.getSubagentRoutes).mockResolvedValue({
        routes: (opts.routes ?? ["rapida", "profunda"]).map((name) => ({ name, description: name, model: "m" })),
        default: null,
    });
    vi.mocked(api.getMyCriteriaContrasts).mockResolvedValue({ contrasts: opts.contrasts ?? [] });
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe("starting a contrast", () => {
    it("asks for two distinct routes of the person's own and sends the assignment to the server", async () => {
        setup();
        vi.mocked(api.runCriteriaContrastTurn).mockResolvedValue({ failure: null });
        render(intl(<ContrastPage />));
        const start = await screen.findByRole("button", { name: "Comparar" });
        expect(start).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Encargo"), { target: { value: "¿Desde cuándo corre el plazo de prescripción de este pagaré?" } });
        expect(start).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Primer análisis"), { target: { value: "rapida" } });
        fireEvent.change(screen.getByLabelText("Segundo análisis"), { target: { value: "rapida" } });
        // The same route twice is not offered as the second choice.
        expect(within(screen.getByLabelText("Segundo análisis")).queryByRole("option", { name: "rapida" })).toBeNull();
        fireEvent.change(screen.getByLabelText("Segundo análisis"), { target: { value: "profunda" } });
        expect(start).toBeEnabled();
        fireEvent.click(start);
        await waitFor(() =>
            expect(api.runCriteriaContrastTurn).toHaveBeenCalledWith({
                text: "¿Desde cuándo corre el plazo de prescripción de este pagaré?",
                orgId: ORG,
                mode: "criteria_contrast",
                routes: ["rapida", "profunda"],
            }),
        );
        await waitFor(() => expect(api.getMyCriteriaContrasts).toHaveBeenCalledTimes(2));
    });

    it("with fewer than two routes, says it uses two neutral approaches and asks for no route", async () => {
        setup({ routes: ["sola"] });
        vi.mocked(api.runCriteriaContrastTurn).mockResolvedValue({ failure: null });
        render(intl(<ContrastPage />));
        expect(await screen.findByText(/dos enfoques neutros, literal y sistemático/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Primer análisis")).toBeNull();
        fireEvent.change(screen.getByLabelText("Encargo"), { target: { value: "¿Desde cuándo corre el plazo de prescripción de este pagaré?" } });
        fireEvent.click(screen.getByRole("button", { name: "Comparar" }));
        await waitFor(() =>
            expect(api.runCriteriaContrastTurn).toHaveBeenCalledWith({
                text: "¿Desde cuándo corre el plazo de prescripción de este pagaré?",
                orgId: ORG,
                mode: "criteria_contrast",
            }),
        );
    });

    it("shows what the server said when the turn failed, and keeps the text", async () => {
        setup({ routes: [] });
        vi.mocked(api.runCriteriaContrastTurn).mockResolvedValue({ failure: "Select a model before sending a message." });
        render(intl(<ContrastPage />));
        const text = "¿Desde cuándo corre el plazo de prescripción de este pagaré?";
        fireEvent.change(await screen.findByLabelText("Encargo"), { target: { value: text } });
        fireEvent.click(screen.getByRole("button", { name: "Comparar" }));
        expect(await screen.findByRole("alert")).toHaveTextContent("El contraste no pudo empezar: Select a model before sending a message.");
        expect(screen.getByLabelText("Encargo")).toHaveValue(text);
    });

    it("offers nothing to somebody who is not a junior, or where the server does not offer it", async () => {
        setup({ stage: "none" });
        const { unmount } = render(intl(<ContrastPage />));
        expect(await screen.findByText(/es para quienes están en etapa de junior/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Encargo")).toBeNull();
        unmount();
        setup({ modes: [] });
        render(intl(<ContrastPage />));
        expect(await screen.findByText(/no está disponible por ahora/)).toBeInTheDocument();
        expect(screen.queryByLabelText("Encargo")).toBeNull();
    });
});

describe("the two columns and the explanation", () => {
    it("shows both analyses side by side with their routes, and asks for the person's own explanation first", async () => {
        setup({ contrasts: [contrast()] });
        render(intl(<ContrastPage />));
        const first = await screen.findByRole("region", { name: "Análisis 1" });
        const second = screen.getByRole("region", { name: "Análisis 2" });
        expect(first).toHaveTextContent("El plazo corre desde la notificación.");
        expect(second).toHaveTextContent("El plazo corre desde el emplazamiento.");
        expect(first).toHaveAttribute("tabindex", "0");
        expect(screen.getAllByText(/Ruta: rapida/)[0]).toBeInTheDocument();
        expect(screen.getByText("Esperando tu explicación")).toBeInTheDocument();
        // The AI's explanation and the comparison are not there yet.
        expect(screen.queryByText(/Tu explicación comparada/)).toBeNull();
        const send = screen.getByRole("button", { name: "Enviar mi explicación" });
        expect(send).toBeDisabled();
        fireEvent.change(screen.getByLabelText("¿Por qué crees que divergen los dos análisis?"), { target: { value: "corta" } });
        expect(send).toBeDisabled();
        expect(screen.getByText("Escribe al menos 60 caracteres.")).toBeInTheDocument();
    });

    it("sends the explanation in the same conversation", async () => {
        setup({ contrasts: [contrast()] });
        vi.mocked(api.runCriteriaContrastTurn).mockResolvedValue({ failure: null });
        render(intl(<ContrastPage />));
        fireEvent.change(await screen.findByLabelText("¿Por qué crees que divergen los dos análisis?"), { target: { value: EXPLANATION } });
        fireEvent.click(screen.getByRole("button", { name: "Enviar mi explicación" }));
        await waitFor(() =>
            expect(api.runCriteriaContrastTurn).toHaveBeenCalledWith({ text: EXPLANATION, chatId: "chat-1", mode: "criteria_explain" }),
        );
        await waitFor(() => expect(api.getMyCriteriaContrasts).toHaveBeenCalledTimes(2));
    });

    it("reports a refusal through the shared error path", async () => {
        setup({ contrasts: [contrast()] });
        vi.mocked(api.runCriteriaContrastTurn).mockRejectedValue(new Error("training_mode_not_allowed"));
        render(intl(<ContrastPage />));
        fireEvent.change(await screen.findByLabelText("¿Por qué crees que divergen los dos análisis?"), { target: { value: EXPLANATION } });
        fireEvent.click(screen.getByRole("button", { name: "Enviar mi explicación" }));
        await waitFor(() => expect(notifyError).toHaveBeenCalled());
    });

    it("an explained contrast shows the person's words, the three sections and a link to the AI's explanation", async () => {
        setup({
            contrasts: [
                contrast({
                    status: "explained",
                    person_explanation: EXPLANATION,
                    comparison: "Coincide\n- Ambos señalan el inicio del plazo.\nNo coincide\n- La ley supletoria.\nFaltó\n- Nada.",
                }),
            ],
        });
        render(intl(<ContrastPage />));
        expect(await screen.findByText(EXPLANATION)).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Coincide" })).toBeInTheDocument();
        expect(screen.getByText("Ambos señalan el inicio del plazo.")).toBeInTheDocument();
        expect(screen.getByText("La ley supletoria.")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Leer la explicación de la IA en la conversación" })).toHaveAttribute("href", "/assistant/chat/chat-1");
        // No score, no rank.
        expect(document.body.textContent).not.toMatch(/puntaje:|calificaci[oó]n|ranking/i);
    });

    it("a route that could not run is shown as failed and not replaced", async () => {
        setup({
            contrasts: [
                contrast({
                    status: "failed",
                    routes: [route("rapida"), route("profunda", { status: "failed", provider: undefined, model: undefined })],
                    briefs: ["Solo corrió este.", ""],
                }),
            ],
        });
        render(intl(<ContrastPage />));
        expect(await screen.findByText("No terminó")).toBeInTheDocument();
        expect(screen.getByText(/Este análisis no corrió \(falló\)\. No se reemplazó por otra ruta\./)).toBeInTheDocument();
        expect(screen.getByText(/Nada la reemplazó/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Enviar mi explicación" })).toBeNull();
    });

    it("says a subagent that never started never started", async () => {
        setup({ contrasts: [contrast({ status: "failed", routes: [{ status: "not_run", approach: "literal" }, { status: "not_run", approach: "systematic" }], briefs: null })] });
        render(intl(<ContrastPage />));
        expect((await screen.findAllByText(/nunca se inició/)).length).toBe(2);
        expect(screen.getByText("Enfoque literal")).toBeInTheDocument();
        expect(screen.getByText("Enfoque sistemático")).toBeInTheDocument();
    });
});

describe("the comparison parser", () => {
    it("reads the three sections and drops «Nada»", () => {
        expect(comparisonParts("Coincide\n- a\n- b\nNo coincide\n- Nada\nFaltó\n1. c")).toEqual({
            coincide: ["a", "b"],
            noCoincide: [],
            falto: ["c"],
        });
    });
});

describe("the mentor's section", () => {
    it("lists the contrasts of openable works with the person's words, counts the rest and shows no analyses", async () => {
        vi.mocked(api.getPupilCriteriaContrasts).mockResolvedValue({
            org_id: ORG,
            trainee_user_id: "pupil-1",
            contrasts_without_access: 2,
            contrasts: [
                {
                    id: "k1",
                    chat_id: "chat-1",
                    project_id: "p-1",
                    title: "Plazo del pagaré",
                    status: "explained",
                    routes: [route("rapida"), { approach: "systematic", status: "completed", model: "m" }],
                    person_explanation: EXPLANATION,
                    comparison: "Coincide\n- Algo.\nNo coincide\n- Nada\nFaltó\n- Nada",
                    created_at: "2026-11-08T12:00:00.000Z",
                },
                {
                    id: "k2",
                    chat_id: "chat-2",
                    project_id: "p-1",
                    title: null,
                    status: "awaiting_person",
                    routes: [],
                    person_explanation: null,
                    comparison: null,
                    created_at: "2026-11-07T12:00:00.000Z",
                },
            ],
        });
        render(intl(<MentorCriteriaContrasts orgId={ORG} pupilId="pupil-1" />));
        expect(await screen.findByText("Contrastes de criterios")).toBeInTheDocument();
        expect(screen.getByText(EXPLANATION)).toBeInTheDocument();
        expect(screen.getByText("Plazo del pagaré")).toBeInTheDocument();
        expect(screen.getByText("Esperando la explicación de la persona.")).toBeInTheDocument();
        expect(screen.getByText("2 contrastes están en un asunto que no puedes abrir.")).toBeInTheDocument();
        expect(screen.getByText(/Enfoque sistemático/)).toBeInTheDocument();
        expect(api.getPupilCriteriaContrasts).toHaveBeenCalledWith(ORG, "pupil-1");
    });

    it("says there are none yet", async () => {
        vi.mocked(api.getPupilCriteriaContrasts).mockResolvedValue({ org_id: ORG, trainee_user_id: "p", contrasts: [], contrasts_without_access: 0 });
        render(intl(<MentorCriteriaContrasts orgId={ORG} pupilId="p" />));
        expect(await screen.findByText("Todavía no hay contrastes de criterios.")).toBeInTheDocument();
    });
});
