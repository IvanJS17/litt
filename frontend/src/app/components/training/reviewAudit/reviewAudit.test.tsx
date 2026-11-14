import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { MentorReviewAudits } from "./MentorReviewAudits";
import { ReviewAuditPage } from "./ReviewAuditPage";
import { splitReasoning } from "./reviewAuditShared";
import { useReviewAuditEntry } from "./useReviewAuditEntry";

vi.mock("@/app/lib/mikeApi", () => ({
    getReviewAudit: vi.fn(),
    startReviewAudit: vi.fn(),
    markReviewAuditCell: vi.fn(),
    completeReviewAudit: vi.fn(),
    getPupilReviewAudits: vi.fn(),
    evaluateReviewAudit: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));

const LONG = "Cláusula décima-primera-con-un-texto-largo-sin-espacios-que-no-cabe-en-320px-".repeat(4);
const columns: api.TrainingAuditColumn[] = [
    { index: 0, name: "Rescisión", prompt: "Resume la cláusula de rescisión del contrato" },
    { index: 1, name: "", prompt: "" },
];

function cell(overrides: Partial<api.TrainingAuditCell> = {}): api.TrainingAuditCell {
    return {
        row_id: "row-1",
        column_index: 0,
        column_name: "Rescisión",
        row_label: "Contrato Ruiz.pdf",
        summary: "Procede la rescisión por falta de pago",
        reasoning: "Se funda en la cláusula [[document:d1||page:3||quote:el arrendatario pagará dentro de los primeros cinco días]] del contrato.",
        withheld: false,
        mark: null,
        note: null,
        mentor_mark: null,
        ...overrides,
    };
}

function audit(overrides: Partial<api.TrainingReviewAudit> = {}): api.TrainingReviewAudit {
    return {
        id: "a1",
        tabular_review_id: "r1",
        status: "open",
        columns,
        lint: [{ code: "empty_instruction", column_index: 1 }],
        cells: [cell(), cell({ row_id: "row-2", column_index: 1, column_name: "", row_label: "Otro.pdf", summary: LONG, reasoning: "", withheld: false })],
        withheld: 0,
        created_at: "2026-11-08T10:00:00.000Z",
        completed_at: null,
        tally: null,
        evaluation: null,
        ...overrides,
    };
}

function state(overrides: Partial<api.TrainingReviewAuditState> = {}): api.TrainingReviewAuditState {
    return { applies: true, ready: true, columns, lint: [{ code: "no_format", column_index: 0 }], audit: null, ...overrides };
}

const renderEs = (ui: React.ReactElement) =>
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            {ui}
        </IntlClientProvider>,
    );

beforeEach(() => {
    vi.resetAllMocks();
});

describe("the junior's page", () => {
    it("shows a skeleton, then says the audit does not apply", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue({ applies: false, ready: false, columns: [], lint: [], audit: null });
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(screen.getByLabelText("Cargando…")).toHaveAttribute("aria-busy", "true");
        expect(await screen.findByText(/Esta auditoría es para personas en etapa junior/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Volver a la revisión" })).toHaveAttribute("href", "/tabular-reviews/r1");
        expect(screen.queryByRole("button", { name: "Empezar la auditoría" })).toBeNull();
    });

    it("reads the load failure with notifyError and offers to retry", async () => {
        vi.mocked(api.getReviewAudit).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(state());
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(await screen.findByText("No se pudo cargar.")).toBeInTheDocument();
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "cargar la auditoría", operation: "training.read" });
        fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        expect(await screen.findByRole("heading", { name: "Auditoría a mano" })).toBeInTheDocument();
    });

    it("reviews the questions with plain-text notes and starts the audit", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ lint: [{ code: "duplicate_name", column_index: 1, other_index: 0 }, { code: "empty_name", column_index: 1 }] }));
        vi.mocked(api.startReviewAudit).mockResolvedValue(audit());
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(await screen.findByText("Columna 2 tiene el mismo nombre que “Rescisión”.")).toBeInTheDocument();
        expect(screen.getByText("Columna 2 no tiene nombre.")).toBeInTheDocument();
        expect(screen.getByText("Instrucción: Resume la cláusula de rescisión del contrato")).toBeInTheDocument();
        expect(screen.getByText("Sin instrucción")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Empezar la auditoría" }));
        expect(await screen.findByText("Marcaste 0 de 2.")).toBeInTheDocument();
        expect(screen.getByText("LiTT eligió 2 respuestas", { exact: false })).toBeInTheDocument();
    });

    it("says there is nothing to audit before the review is generated", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ ready: false, lint: [] }));
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(await screen.findByText(/Primero genera la revisión/)).toBeInTheDocument();
        expect(screen.getByText(/Sin observaciones/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Empezar la auditoría" })).toBeNull();
    });

    it("shows each answer with its cited passage and saves a mark with its note", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ audit: audit() }));
        const marked = audit({ cells: [cell({ mark: "incorrect", note: "Falta el plazo" }), audit().cells[1]] });
        vi.mocked(api.markReviewAuditCell).mockResolvedValue(marked);
        renderEs(<ReviewAuditPage reviewId="r1" />);
        const card = (await screen.findByRole("article", { name: "Contrato Ruiz.pdf · “Rescisión”" })) as HTMLElement;
        expect(within(card).getByText("Procede la rescisión por falta de pago")).toBeInTheDocument();
        expect(within(card).getByText("el arrendatario pagará dentro de los primeros cinco días")).toBeInTheDocument();
        expect(within(card).getByText("página 3")).toBeInTheDocument();
        expect(within(card).getByText(/Se funda en la cláusula/)).toBeInTheDocument();
        fireEvent.change(within(card).getByLabelText("Tu nota (opcional)"), { target: { value: "  Falta el plazo " } });
        fireEvent.click(within(card).getByRole("radio", { name: "Incorrecta" }));
        await waitFor(() =>
            expect(api.markReviewAuditCell).toHaveBeenCalledWith("r1", expect.objectContaining({ row_id: "row-1", column_index: 0 }), {
                mark: "incorrect",
                note: "Falta el plazo",
            }),
        );
        expect(await screen.findByText("Marcaste 1 de 2.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Terminar la auditoría" })).toBeDisabled();
        // A long unbroken answer is shown whole and wraps.
        expect(screen.getByText(LONG).className).toContain("break-words");
    });

    it("saves a changed note on blur only once the cell has a mark", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ audit: audit({ cells: [cell({ mark: "correct", note: "uno" }), audit().cells[1]] }) }));
        vi.mocked(api.markReviewAuditCell).mockResolvedValue(audit());
        renderEs(<ReviewAuditPage reviewId="r1" />);
        const notes = await screen.findAllByLabelText("Tu nota (opcional)");
        fireEvent.blur(notes[0]);
        expect(api.markReviewAuditCell).not.toHaveBeenCalled();
        fireEvent.change(notes[0], { target: { value: "dos" } });
        fireEvent.blur(notes[0]);
        await waitFor(() => expect(api.markReviewAuditCell).toHaveBeenCalledWith("r1", expect.anything(), { mark: "correct", note: "dos" }));
        // An unmarked cell keeps its note local until it is marked.
        fireEvent.change(notes[1], { target: { value: "algo" } });
        fireEvent.blur(notes[1]);
        expect(api.markReviewAuditCell).toHaveBeenCalledTimes(1);
    });

    it("finishes once every cell is marked and shows the counts of the same person", async () => {
        const full = audit({ cells: [cell({ mark: "incorrect" }), cell({ row_id: "row-2", column_index: 1, column_name: "", mark: "correct" })] });
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ audit: full }));
        vi.mocked(api.completeReviewAudit).mockResolvedValue({
            ...full,
            status: "complete",
            completed_at: "2026-11-08T11:00:00.000Z",
            tally: [
                { column_index: 0, column_name: "Rescisión", marked: 1, incorrect: 1, incomplete: 0 },
                { column_index: 1, column_name: "", marked: 1, incorrect: 0, incomplete: 0 },
            ],
            evaluation: { outcome: "needs_work", note: "Precisa el plazo", evaluated_at: "2026-11-09T10:00:00.000Z" },
        });
        renderEs(<ReviewAuditPage reviewId="r1" />);
        const finish = await screen.findByRole("button", { name: "Terminar la auditoría" });
        expect(finish).toBeEnabled();
        fireEvent.click(finish);
        expect(await screen.findByRole("heading", { name: "Tu resultado" })).toBeInTheDocument();
        expect(screen.getByText("“Rescisión”: marcadas 1, incorrectas 1, incompletas 0.")).toBeInTheDocument();
        expect(screen.getByText("Columna 2: marcadas 1, incorrectas 0, incompletas 0.")).toBeInTheDocument();
        expect(screen.getByText(/Terminaste esta auditoría el/)).toBeInTheDocument();
        expect(screen.getByText("Lo que dijo tu mentor: Por mejorar")).toBeInTheDocument();
        expect(screen.getByText("Precisa el plazo")).toBeInTheDocument();
        // A finished audit cannot be marked any more.
        for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    });

    it("tells when the mentor corrected a mark and when an answer is withheld", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(
            state({
                audit: audit({
                    status: "complete",
                    cells: [cell({ mark: "correct", mentor_mark: "incorrect" }), cell({ row_id: "row-2", withheld: true, summary: null, reasoning: null })],
                    tally: [],
                }),
            }),
        );
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(await screen.findByText("Tu mentor marcó esta respuesta como incorrecta.")).toBeInTheDocument();
        expect(screen.getByText("No puedes leer los documentos de esta respuesta, así que no se muestra.")).toBeInTheDocument();
    });

    it("explains an expired audit and draws another", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ audit: audit({ status: "stale", cells: [] }) }));
        vi.mocked(api.startReviewAudit).mockResolvedValue(audit({ id: "a2" }));
        renderEs(<ReviewAuditPage reviewId="r1" />);
        expect(await screen.findByText(/venció/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Elegir una muestra nueva" }));
        expect(await screen.findByText("Marcaste 0 de 2.")).toBeInTheDocument();
    });

    it("reports a failed mark with the stale-audit sentence and reads the audit again", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ audit: audit() }));
        vi.mocked(api.markReviewAuditCell).mockRejectedValue(new Error("stale"));
        renderEs(<ReviewAuditPage reviewId="r1" />);
        fireEvent.click((await screen.findAllByRole("radio", { name: "Correcta" }))[0]);
        await waitFor(() => expect(notifyError).toHaveBeenCalled());
        expect(vi.mocked(notifyError).mock.calls[0][1]).toEqual({
            action: "guardar tu marca",
            operation: "training.manage",
            codeMessages: { training_review_audit_stale: expect.stringContaining("Elige una muestra nueva") },
        });
        await waitFor(() => expect(api.getReviewAudit).toHaveBeenCalledTimes(2));
    });
});

describe("the mentor's section", () => {
    const listed = (audits: api.TrainingPupilReviewAudits["audits"], without_access = 0): api.TrainingPupilReviewAudits => ({ audits, without_access });

    it("loads with a skeleton, an empty state and a failure with retry", async () => {
        vi.mocked(api.getPupilReviewAudits).mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(listed([]));
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText("No se pudo cargar.")).toBeInTheDocument();
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "cargar las revisiones masivas", operation: "training.manage" });
        fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Este aprendiz todavía no tiene auditorías.")).toBeInTheDocument();
    });

    it("counts the audits of matters the mentor cannot open without showing them", async () => {
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(listed([], 2));
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText(/2 auditorías son de revisiones en asuntos que no puedes abrir/)).toBeInTheDocument();
        expect(screen.queryByText("Este aprendiz todavía no tiene auditorías.")).toBeNull();
    });

    it("waits for the pupil to finish and shows the sample as marked", async () => {
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(
            listed([{ ...audit({ cells: [cell({ mark: "correct", note: "bien" }), cell({ row_id: "row-2", mark: null, withheld: true, summary: null })], withheld: 1 }), review_title: null }]),
        );
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText("Revisión sin título")).toBeInTheDocument();
        expect(screen.getByText(/En curso/)).toBeInTheDocument();
        expect(screen.getByText("Su marca: correcta")).toBeInTheDocument();
        expect(screen.getByText("Sin marcar todavía")).toBeInTheDocument();
        expect(screen.getByText("bien")).toBeInTheDocument();
        expect(screen.getByText("Podrás evaluarla cuando el aprendiz termine la auditoría.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Guardar evaluación" })).toBeNull();
    });

    it("evaluates a finished audit, correcting a mark as the mentor's", async () => {
        const done = {
            ...audit({
                status: "complete",
                completed_at: "2026-11-08T11:00:00.000Z",
                cells: [cell({ mark: "correct" }), cell({ row_id: "row-2", column_index: 1, mark: "incorrect", mentor_mark: "incomplete" })],
            }),
            review_title: "Contratos de arrendamiento",
        };
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(listed([done]));
        vi.mocked(api.evaluateReviewAudit).mockResolvedValue(done);
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText("Contratos de arrendamiento")).toBeInTheDocument();
        const save = screen.getByRole("button", { name: "Guardar evaluación" });
        expect(save).toBeDisabled();
        const [first, second] = screen.getAllByLabelText("Tu marca");
        expect(second).toHaveValue("incomplete");
        fireEvent.change(first, { target: { value: "incorrect" } });
        fireEvent.change(first, { target: { value: "" } });
        fireEvent.change(first, { target: { value: "incorrect" } });
        fireEvent.click(screen.getByRole("radio", { name: "Por mejorar" }));
        fireEvent.change(screen.getByLabelText("Nota para el aprendiz (opcional)"), { target: { value: " Precisa el plazo " } });
        fireEvent.click(save);
        await waitFor(() =>
            expect(api.evaluateReviewAudit).toHaveBeenCalledWith("o1", "p1", "a1", {
                outcome: "needs_work",
                note: "Precisa el plazo",
                corrections: [{ row_id: "row-1", column_index: 0, mark: "incorrect" }],
            }),
        );
        await waitFor(() => expect(api.getPupilReviewAudits).toHaveBeenCalledTimes(2));
    });

    it("takes the mentor's own mark back with null", async () => {
        const done = {
            ...audit({
                status: "complete",
                completed_at: "2026-11-08T11:00:00.000Z",
                evaluation: { outcome: "adequate", note: null, evaluated_at: "2026-11-09T10:00:00.000Z" },
                cells: [cell({ mark: "correct" }), cell({ row_id: "row-2", column_index: 1, mark: "incorrect", mentor_mark: "incomplete" })],
            }),
            review_title: "Contratos de arrendamiento",
        };
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(listed([done]));
        vi.mocked(api.evaluateReviewAudit).mockResolvedValue(done);
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText("Contratos de arrendamiento")).toBeInTheDocument();
        const [first, second] = screen.getAllByLabelText("Tu marca");
        // Only a cell with a mark of the mentor offers to take it back.
        expect(within(first).queryByRole("option", { name: "Quitar mi marca" })).toBeNull();
        fireEvent.change(second, { target: { value: "clear" } });
        fireEvent.click(screen.getByRole("button", { name: "Guardar evaluación" }));
        await waitFor(() =>
            expect(api.evaluateReviewAudit).toHaveBeenCalledWith("o1", "p1", "a1", {
                outcome: "adequate",
                note: null,
                corrections: [{ row_id: "row-2", column_index: 1, mark: null }],
            }),
        );
    });

    it("shows a recorded evaluation and reports a stale audit by its own sentence", async () => {
        const done = {
            ...audit({
                status: "complete",
                cells: [cell({ mark: "correct" })],
                evaluation: { outcome: "adequate", note: "Buen criterio", evaluated_at: "2026-11-09T10:00:00.000Z" },
            }),
            review_title: "Revisión",
        };
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(listed([done]));
        vi.mocked(api.evaluateReviewAudit).mockRejectedValue(new Error("stale"));
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText(/Evaluada el/)).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "Adecuado" })).toBeChecked();
        expect(screen.getByLabelText("Nota para el aprendiz (opcional)")).toHaveValue("Buen criterio");
        fireEvent.click(screen.getByRole("button", { name: "Guardar evaluación" }));
        await waitFor(() => expect(notifyError).toHaveBeenCalled());
        expect(vi.mocked(notifyError).mock.calls[0][1]).toMatchObject({
            action: "guardar la evaluación",
            codeMessages: { training_review_audit_stale: expect.stringContaining("ya no se puede evaluar") },
        });
    });

    it("shows an expired audit as expired and offers no evaluation", async () => {
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue(listed([{ ...audit({ status: "stale", cells: [] }), review_title: "R" }]));
        renderEs(<MentorReviewAudits orgId="o1" pupilId="p1" />);
        expect(await screen.findByText(/Vencida: la revisión se volvió a generar/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Guardar evaluación" })).toBeNull();
        expect(screen.queryByText("Podrás evaluarla cuando el aprendiz termine la auditoría.")).toBeNull();
    });
});

describe("splitReasoning", () => {
    it("separates the prose from the cited passages", () => {
        expect(splitReasoning(null)).toEqual({ prose: "", passages: [] });
        expect(splitReasoning("Sin cita.")).toEqual({ prose: "Sin cita.", passages: [] });
        expect(splitReasoning("Va [[page:2||quote:dice así]] y sigue.")).toEqual({
            prose: "Va y sigue.",
            passages: [{ page: 2, quote: "dice así" }],
        });
    });
});

describe("useReviewAuditEntry", () => {
    it("is true only for a review the caller audits, and quiet when it cannot know", async () => {
        vi.mocked(api.getReviewAudit).mockResolvedValue(state());
        const yes = renderHook(() => useReviewAuditEntry("r1"));
        await waitFor(() => expect(yes.result.current).toBe(true));
        vi.mocked(api.getReviewAudit).mockResolvedValue(state({ applies: false }));
        const no = renderHook(() => useReviewAuditEntry("r2"));
        await waitFor(() => expect(api.getReviewAudit).toHaveBeenCalledWith("r2"));
        expect(no.result.current).toBe(false);
        vi.mocked(api.getReviewAudit).mockRejectedValue(new Error("x"));
        const failed = renderHook(() => useReviewAuditEntry("r3"));
        await waitFor(() => expect(api.getReviewAudit).toHaveBeenCalledWith("r3"));
        expect(failed.result.current).toBe(false);
        const off = renderHook(() => useReviewAuditEntry("r4", false));
        expect(off.result.current).toBe(false);
        expect(api.getReviewAudit).not.toHaveBeenCalledWith("r4");
        // The answer belongs to its review: another id is false until it answers.
        yes.rerender();
    });
});
