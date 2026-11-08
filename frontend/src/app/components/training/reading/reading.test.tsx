import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { MentorReadings } from "./MentorReadings";
import { ReadingNotice } from "./ReadingNotice";
import { ReadingPage } from "./ReadingPage";
import { ReadingResult } from "./readingShared";

// The periodic full reading (training layer 3) on screen, in es-MX: the
// reading page without an assistant, the notice in Mi formación, the mentor's
// section and the three lists of the comparison.

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
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
    getMyReading: vi.fn(),
    getMyReadings: vi.fn(),
    getReadingDocument: vi.fn(),
    startReading: vi.fn(),
    swapReading: vi.fn(async () => ({})),
    submitReadingFindings: vi.fn(async () => ({})),
    compareReading: vi.fn(async () => ({})),
    getPupilReadings: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
// The dropdown is Radix; a native select keeps these tests about the page.
vi.mock("@/app/components/modals/ModalSelect", () => ({
    ModalSelect: (props: {
        "aria-label"?: string;
        value: string;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
    }) => (
        <select aria-label={props["aria-label"]} value={props.value} onChange={(event) => props.onChange(event.target.value)}>
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

const FINDINGS = "- La cláusula penal parece excesiva.\n- Falta la fecha de entrega del inmueble.\n- El aval no aparece.";
const available: api.TrainingReadings["generation"] = {
    available: true,
    model: "gpt-5.2",
    credential_options: [{ credential_ref: "user:k1", source: "personal" }],
    default_credential_ref: "user:k1",
};
const unavailable: api.TrainingReadings["generation"] = { available: false, code: "training_review_key_required" };

function reading(overrides: Partial<api.TrainingReading> = {}): api.TrainingReading {
    return {
        id: "rd-1",
        org_id: "org-1",
        trainee_user_id: "pupil-1",
        project_id: "p-1",
        status: "assigned",
        swapped: false,
        findings: null,
        submitted_at: null,
        machine_findings: null,
        comparison: null,
        model_provider: null,
        model: null,
        created_at: "2026-11-01T12:00:00.000Z",
        ...overrides,
    };
}

const compared = reading({
    status: "compared",
    findings: FINDINGS,
    submitted_at: "2026-11-02T12:00:00.000Z",
    model: "gpt-5.2",
    machine_findings: [
        { text: "Pena convencional desproporcionada", excerpt: "La cláusula penal será del diez por ciento mensual" },
        { text: "Sin fecha de entrega", excerpt: "No se menciona la fecha de entrega del inmueble" },
        { text: "Rescisión unilateral", excerpt: "El arrendador podrá rescindir sin aviso previo" },
    ],
    comparison: {
        person_items: ["La cláusula penal parece excesiva.", "Falta la fecha de entrega del inmueble.", "El aval no aparece."],
        both: [
            { person: 0, machine: 0 },
            { person: 1, machine: 1 },
        ],
        only_person: [2],
        only_machine: [2],
        discarded: 2,
    },
});

const document: api.TrainingReadingDocument = {
    reading_id: "rd-1",
    filename: "arrendamiento.docx",
    text: "CONTRATO DE ARRENDAMIENTO. El arrendatario pagará la renta el día cinco de cada mes.",
};

function page(overrides: { reading?: api.TrainingReading; document?: api.TrainingReadingDocument | null; generation?: api.TrainingReadings["generation"] } = {}) {
    vi.mocked(api.getMyReading).mockResolvedValue(overrides.reading ?? reading());
    if (overrides.document === null)
        vi.mocked(api.getReadingDocument).mockRejectedValue(
            new api.MikeApiError({ message: "gone", status: 409, code: "training_reading_document_unavailable" }),
        );
    else vi.mocked(api.getReadingDocument).mockResolvedValue(overrides.document ?? document);
    vi.mocked(api.getMyReadings).mockResolvedValue({
        org_id: "org-1",
        eligibility: { is_junior: true, due: false, open_reading_id: "rd-1", last_submitted_at: null, next_due_at: null },
        generation: overrides.generation ?? available,
        readings: [],
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("the three lists of the comparison", () => {
    it("shows what matched, what only the person saw and what only the machine saw, as text, with passages", () => {
        render(intl(<ReadingResult reading={compared} />));
        const headings = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent);
        expect(headings).toEqual(["Coincidieron", "Solo lo viste tú", "Solo lo vio la máquina"]);
        expect(screen.getByText(/Los hallazgos de la máquina cuentan solo si su cita está en el documento/)).toBeInTheDocument();
        expect(screen.getAllByText(/Tú escribiste/)).toHaveLength(2);
        expect(screen.getByText("El aval no aparece.")).toBeInTheDocument();
        expect(screen.getByText("Rescisión unilateral")).toBeInTheDocument();
        // The pairing is marked as inferred; the passage is the document's own text.
        expect(screen.getAllByText("(inferido)")).toHaveLength(2);
        expect(screen.getByText("La cláusula penal será del diez por ciento mensual")).toBeInTheDocument();
        expect(screen.getAllByText("Pasaje del documento")).toHaveLength(3);
        expect(screen.getByText("Se dejaron fuera 2 hallazgos de la máquina porque su cita no está en el documento.")).toBeInTheDocument();
    });

    it("says so when the machine found nothing it could quote, and when a group is empty", () => {
        render(
            intl(
                <ReadingResult
                    reading={{
                        ...compared,
                        machine_findings: [],
                        comparison: { person_items: ["Algo"], both: [], only_person: [0], only_machine: [], discarded: 1 },
                    }}
                />,
            ),
        );
        expect(screen.getByText("La máquina no encontró nada que pudiera citar del documento.")).toBeInTheDocument();
        expect(screen.getAllByText("Nada aquí.")).toHaveLength(2);
        expect(screen.getByText("Se dejó fuera 1 hallazgo de la máquina porque su cita no está en el documento.")).toBeInTheDocument();
    });

    it("renders nothing before the comparison exists", () => {
        const { container } = render(intl(<ReadingResult reading={reading()} />));
        expect(container).toBeEmptyDOMElement();
    });
});

describe("the reading page", () => {
    it("shows the document and a form, and no assistant", async () => {
        page();
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(screen.getByLabelText("Cargando…")).toHaveAttribute("aria-busy", "true");
        expect(await screen.findByText(/CONTRATO DE ARRENDAMIENTO/)).toBeInTheDocument();
        expect(screen.getByRole("region", { name: /Documento/ })).toHaveAttribute("tabindex", "0");
        expect(screen.getByText(/arrendamiento\.docx/)).toBeInTheDocument();
        expect(screen.getByText(/Esta página no tiene asistente a propósito/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Volver a Formación/ })).toHaveAttribute("href", "/settings/training");
        expect(screen.getByLabelText("Lo que encontraste")).toBeInTheDocument();
        expect(screen.queryByRole("textbox", { name: /pregunta|chat|mensaje/i })).toBeNull();
        expect(api.getMyReadings).toHaveBeenCalledWith("org-1");
    });

    it("sends what the person found only once it is long enough", async () => {
        page();
        render(intl(<ReadingPage readingId="rd-1" />));
        const send = await screen.findByRole("button", { name: "Enviar lo que encontré" });
        expect(send).toBeDisabled();
        expect(screen.getByText("Escribe al menos 20 caracteres.")).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText("Lo que encontraste"), { target: { value: FINDINGS } });
        expect(screen.getByText(`${FINDINGS.length} de 4000 caracteres`)).toBeInTheDocument();
        expect(send).toBeEnabled();
        fireEvent.click(send);
        await waitFor(() => expect(api.submitReadingFindings).toHaveBeenCalledWith("rd-1", FINDINGS));
        await waitFor(() => expect(api.getMyReading).toHaveBeenCalledTimes(2));
    });

    it("lets the person change the document once", async () => {
        page();
        render(intl(<ReadingPage readingId="rd-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Cambiar el documento" }));
        await waitFor(() => expect(api.swapReading).toHaveBeenCalledWith("rd-1"));
        expect(screen.getByText("Puedes cambiarlo una sola vez.")).toBeInTheDocument();
    });

    it("has used its change: the button is off and says why", async () => {
        page({ reading: reading({ swapped: true }) });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByRole("button", { name: "Cambiar el documento" })).toBeDisabled();
        expect(screen.getByText("Ya cambiaste el documento una vez.")).toBeInTheDocument();
    });

    it("explains a refusal of the server in the person's language, and reads the page again", async () => {
        page();
        vi.mocked(api.swapReading).mockRejectedValueOnce(new Error("conflict"));
        render(intl(<ReadingPage readingId="rd-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Cambiar el documento" }));
        await waitFor(() => expect(notifyError).toHaveBeenCalled());
        const options = vi.mocked(notifyError).mock.calls[0][1] as { action: string; codeMessages: Record<string, string> };
        expect(options.action).toBe("cambiar el documento");
        expect(options.codeMessages).toMatchObject({
            training_reading_not_due: "No te toca una lectura completa por ahora.",
            training_reading_swap_used: "Ya cambiaste el documento una vez.",
            training_reading_findings_recorded: "Ya enviaste lo que encontraste; no se puede cambiar.",
        });
        await waitFor(() => expect(api.getMyReading).toHaveBeenCalledTimes(2));
    });

    it("says the document is gone instead of failing the page", async () => {
        page({ document: null });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByText("Este documento ya no está disponible para leerlo.")).toBeInTheDocument();
        expect(screen.getByLabelText("Lo que encontraste")).toBeInTheDocument();
        expect(notifyError).not.toHaveBeenCalled();
    });

    it("keeps what was written and offers the comparison on the person's own key", async () => {
        page({ reading: reading({ status: "submitted", findings: FINDINGS, submitted_at: "2026-11-02T12:00:00.000Z" }) });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByText(/La cláusula penal parece excesiva\./)).toBeInTheDocument();
        expect(screen.queryByRole("textbox")).toBeNull();
        expect(screen.getByText(/Enviado el/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Comparar con la máquina" }));
        await waitFor(() => expect(api.compareReading).toHaveBeenCalledWith("rd-1", "user:k1"));
    });

    it("does not offer the comparison without a key and says where to add one", async () => {
        page({ reading: reading({ status: "submitted", findings: FINDINGS, submitted_at: "2026-11-02T12:00:00.000Z" }), generation: unavailable });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByRole("button", { name: "Comparar con la máquina" })).toBeDisabled();
        expect(screen.getByText(/Para comparar necesitas una llave para tu modelo/)).toBeInTheDocument();
    });

    it("makes the person choose among several keys", async () => {
        page({
            reading: reading({ status: "submitted", findings: FINDINGS, submitted_at: "2026-11-02T12:00:00.000Z" }),
            generation: {
                available: true,
                model: "gpt-5.2",
                credential_options: [
                    { credential_ref: "user:k1", source: "personal" },
                    { credential_ref: "org:k2", source: "organization" },
                ],
                default_credential_ref: null,
            },
        });
        render(intl(<ReadingPage readingId="rd-1" />));
        const compare = await screen.findByRole("button", { name: "Comparar con la máquina" });
        expect(compare).toBeDisabled();
        fireEvent.change(screen.getByLabelText("Llave"), { target: { value: "org:k2" } });
        expect(compare).toBeEnabled();
        fireEvent.click(compare);
        await waitFor(() => expect(api.compareReading).toHaveBeenCalledWith("rd-1", "org:k2"));
    });

    it("lets a failed comparison be tried again", async () => {
        page({ reading: reading({ status: "failed", findings: FINDINGS, submitted_at: "2026-11-02T12:00:00.000Z" }) });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByText(/La comparación falló\. Nada de lo que escribiste cambió/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
        await waitFor(() => expect(api.compareReading).toHaveBeenCalledWith("rd-1", "user:k1"));
    });

    it("shows the comparison of a compared reading, without a button to compare again", async () => {
        page({ reading: compared });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByText("Solo lo vio la máquina")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Comparar/ })).toBeNull();
    });

    it("waits for a comparison that is running and looks again by itself", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        page({ reading: reading({ status: "comparing", findings: FINDINGS, submitted_at: "2026-11-02T12:00:00.000Z" }) });
        render(intl(<ReadingPage readingId="rd-1" />));
        expect(await screen.findByText(/La máquina está leyendo el documento y comparando/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Comparar con la máquina" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Revisar de nuevo" }));
        await waitFor(() => expect(api.getMyReading).toHaveBeenCalledTimes(2));
        vi.mocked(api.getMyReading).mockResolvedValue(compared);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5000);
        });
        expect(await screen.findByText("Coincidieron")).toBeInTheDocument();
    });

    it("offers to try again when the reading cannot be loaded", async () => {
        vi.mocked(api.getMyReading).mockRejectedValueOnce(new Error("down"));
        vi.mocked(api.getMyReading).mockResolvedValue(reading());
        vi.mocked(api.getReadingDocument).mockResolvedValue(document);
        vi.mocked(api.getMyReadings).mockResolvedValue({
            org_id: "org-1",
            eligibility: { is_junior: true, due: false, open_reading_id: "rd-1", last_submitted_at: null, next_due_at: null },
            generation: available,
            readings: [],
        });
        render(intl(<ReadingPage readingId="rd-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText(/CONTRATO DE ARRENDAMIENTO/)).toBeInTheDocument();
    });
});

function readings(overrides: Partial<api.TrainingReadings> = {}): api.TrainingReadings {
    return {
        org_id: "org-1",
        eligibility: { is_junior: true, due: true, open_reading_id: null, last_submitted_at: null, next_due_at: null },
        generation: available,
        readings: [],
        ...overrides,
    };
}

describe("the notice in Mi formación", () => {
    it("offers the reading that is due and opens it", async () => {
        vi.mocked(api.getMyReadings).mockResolvedValue(readings());
        vi.mocked(api.startReading).mockResolvedValue(reading({ id: "rd-9" }));
        render(intl(<ReadingNotice orgId="org-1" />));
        expect(await screen.findByText("Te toca una lectura completa.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Empezar la lectura" }));
        await waitFor(() => expect(api.startReading).toHaveBeenCalledWith("org-1"));
        await waitFor(() => expect(push).toHaveBeenCalledWith("/settings/training/reading/rd-9"));
    });

    it("explains why a reading could not start and stays", async () => {
        vi.mocked(api.getMyReadings).mockResolvedValue(readings());
        vi.mocked(api.startReading).mockRejectedValue(new Error("no document"));
        render(intl(<ReadingNotice orgId="org-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Empezar la lectura" }));
        await waitFor(() => expect(notifyError).toHaveBeenCalled());
        expect(vi.mocked(notifyError).mock.calls[0][1]).toMatchObject({
            action: "empezar la lectura completa",
            codeMessages: { training_reading_no_document: "Todavía no hay un documento que proponerte. Trabaja en un asunto y vuelve." },
        });
        expect(push).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Empezar la lectura" })).toBeEnabled();
    });

    it("continues the reading in progress", async () => {
        vi.mocked(api.getMyReadings).mockResolvedValue(
            readings({
                eligibility: { is_junior: true, due: false, open_reading_id: "rd-1", last_submitted_at: null, next_due_at: null },
                readings: [reading()],
            }),
        );
        render(intl(<ReadingNotice orgId="org-1" />));
        expect(await screen.findByText("Tienes una lectura completa en curso.")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Continuar la lectura" }));
        expect(push).toHaveBeenCalledWith("/settings/training/reading/rd-1");
        expect(api.startReading).not.toHaveBeenCalled();
    });

    it("says when the next one is, and lists the earlier ones with their state", async () => {
        vi.mocked(api.getMyReadings).mockResolvedValue(
            readings({
                eligibility: {
                    is_junior: true,
                    due: false,
                    open_reading_id: null,
                    last_submitted_at: compared.submitted_at,
                    next_due_at: "2026-12-02T12:00:00.000Z",
                },
                readings: [compared],
            }),
        );
        render(intl(<ReadingNotice orgId="org-1" />));
        expect(await screen.findByText(/Tu próxima lectura completa es a partir del/)).toBeInTheDocument();
        const history = screen.getByRole("heading", { name: "Tus lecturas completas" }).parentElement!;
        expect(within(history).getByText(/: Comparada$/)).toBeInTheDocument();
        fireEvent.click(within(history).getByRole("button", { name: /^Ver la lectura del/ }));
        expect(push).toHaveBeenCalledWith("/settings/training/reading/rd-1");
        expect(screen.queryByRole("button", { name: "Empezar la lectura" })).toBeNull();
    });

    it("shows nothing to somebody who is not a junior and has no readings", async () => {
        vi.mocked(api.getMyReadings).mockResolvedValue(
            readings({ eligibility: { is_junior: false, due: false, open_reading_id: null, last_submitted_at: null, next_due_at: null } }),
        );
        const { container } = render(intl(<ReadingNotice orgId="org-1" />));
        await waitFor(() => expect(api.getMyReadings).toHaveBeenCalled());
        await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it("shows a loading state in the same shape, and a retry when it fails", async () => {
        vi.mocked(api.getMyReadings).mockRejectedValueOnce(new Error("down")).mockResolvedValue(readings());
        render(intl(<ReadingNotice orgId="org-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Te toca una lectura completa.")).toBeInTheDocument();
    });
});

describe("the mentor's section", () => {
    const pupil = (overrides: Partial<api.TrainingPupilReadings> = {}): api.TrainingPupilReadings => ({
        org_id: "org-1",
        trainee_user_id: "pupil-1",
        readings: [compared, reading({ id: "rd-2" })],
        readings_without_access: 0,
        ...overrides,
    });

    it("shows what the pupil found and what the machine found, per reading", async () => {
        vi.mocked(api.getPupilReadings).mockResolvedValue(pupil());
        render(intl(<MentorReadings orgId="org-1" pupilId="pupil-1" />));
        expect(await screen.findByRole("heading", { name: "Lecturas completas" })).toBeInTheDocument();
        expect(api.getPupilReadings).toHaveBeenCalledWith("org-1", "pupil-1");
        expect(screen.getByText("Comparada")).toBeInTheDocument();
        expect(screen.getByText("En lectura")).toBeInTheDocument();
        expect(screen.getByText(/Enviada el/)).toBeInTheDocument();
        expect(screen.getByText(/Iniciada el/)).toBeInTheDocument();
        expect(screen.getByText("Comparada con gpt-5.2")).toBeInTheDocument();
        expect(screen.getByText("Aún sin enviar")).toBeInTheDocument();
        expect(screen.getByText("Solo lo vio la máquina")).toBeInTheDocument();
        // Evidence, not a score: no number or percentage in the section.
        expect(screen.queryByText(/%|puntaje|promedio/i)).toBeNull();
    });

    it("counts, without showing, the readings in matters the mentor cannot open", async () => {
        vi.mocked(api.getPupilReadings).mockResolvedValue(pupil({ readings: [], readings_without_access: 2 }));
        render(intl(<MentorReadings orgId="org-1" pupilId="pupil-1" />));
        expect(await screen.findByText("Todavía no hay lecturas completas.")).toBeInTheDocument();
        expect(screen.getByText("2 lecturas están en asuntos que no puedes abrir.")).toBeInTheDocument();
    });

    it("says so in the singular, and offers a retry when it cannot load", async () => {
        vi.mocked(api.getPupilReadings)
            .mockRejectedValueOnce(new Error("down"))
            .mockResolvedValue(pupil({ readings: [], readings_without_access: 1 }));
        render(intl(<MentorReadings orgId="org-1" pupilId="pupil-1" />));
        fireEvent.click(await screen.findByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("1 lectura está en un asunto que no puedes abrir.")).toBeInTheDocument();
    });
});
