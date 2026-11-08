import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { TrainingBackingCheck, TrainingPupilBacking } from "@mike/contracts";
import { BACKING_LABEL_KEYS } from "@mike/ui";
import enUS from "../../../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

const { getChatBacking, markBackingConclusion, getPupilBacking, getTrainingStage, notifyError } = vi.hoisted(() => ({
    getChatBacking: vi.fn(),
    markBackingConclusion: vi.fn(),
    getPupilBacking: vi.fn(),
    getTrainingStage: vi.fn(),
    notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", () => ({
    getChatBacking,
    markBackingConclusion,
    getPupilBacking,
    getTrainingStage,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({ useWorkspaceOrgId: () => "org-1" }));

import { BackingPanel, BackingSlot } from "./BackingPanel";
import { BackingSection } from "./BackingSection";
import { useWebTrainingBacking } from "@/app/hooks/useWebTrainingBacking";

const inEs = (ui: ReactNode) =>
    render(<IntlClientProvider locale="es-MX" messages={esMX}>{ui}</IntlClientProvider>);
const inEn = (ui: ReactNode) =>
    render(<IntlClientProvider locale="en-US" messages={enUS}>{ui}</IntlClientProvider>);

const lookup = (messages: unknown, key: string): unknown =>
    key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);

const check = (over: Partial<TrainingBackingCheck> = {}): TrainingBackingCheck => ({
    id: "check-1",
    org_id: "org-1",
    trainee_user_id: "pupil-1",
    chat_id: "chat-1",
    message_id: "message-1",
    status: "ready",
    created_at: "2026-11-08T16:30:00Z",
    updated_at: "2026-11-08T16:30:00Z",
    conclusions: [
        {
            id: "c1", text: "El plazo es de tres años", citation_ref: 1, status: "backed",
            passage: { ref: 1, title: "contrato.docx", page: 3, excerpt: "El plazo es de tres años." },
            unverified_references: ["art. 1949"], person_verified: false, person_note: null,
        },
        {
            id: "c2", text: "La demanda prescribió", citation_ref: 2, status: "citation_unverified",
            passage: null, unverified_references: [], person_verified: true, person_note: "Está en la cláusula 5",
        },
        {
            id: "c3", text: "Procede el amparo", citation_ref: null, status: "unbacked",
            passage: null, unverified_references: [], person_verified: false, person_note: null,
        },
    ],
    ...over,
});

describe("the panel's catalog", () => {
    it("has every label key in both languages", () => {
        for (const key of Object.values(BACKING_LABEL_KEYS)) {
            expect(typeof lookup(enUS, key), `en-US ${key}`).toBe("string");
            expect(typeof lookup(esMX, key), `es-MX ${key}`).toBe("string");
        }
    });
    it("speaks Mexican Spanish with «tú» and the glossary", () => {
        const text = JSON.stringify(lookup(esMX, "training.criterion.backing"));
        expect(text).not.toMatch(/\busted\b|\bsu mentor\b/i);
        expect(text).toContain("asunto");
        expect(text).toContain("tu mentor");
    });
});

describe("BackingPanel in the web app", () => {
    it("speaks es-MX, with the passage and the law that is not shown", () => {
        inEs(<BackingPanel check={check()} onMark={vi.fn()} />);
        expect(screen.getByRole("region", { name: "Tus conclusiones y su fuente" })).toBeInTheDocument();
        expect(screen.getByText("Respaldada")).toBeInTheDocument();
        expect(screen.getByText("Sin respaldo")).toBeInTheDocument();
        expect(screen.getByText(/Cita sin verificar · Cita 2/)).toBeInTheDocument();
        expect(screen.getByText("Pasaje exacto · contrato.docx, página 3")).toBeInTheDocument();
        expect(screen.getByText("Sin verificar: art. 1949. Confírmalo en la fuente oficial.")).toBeInTheDocument();
        expect(screen.getAllByRole("checkbox", { name: "Lo verifiqué" })).toHaveLength(3);
        expect(screen.getAllByRole("textbox", { name: "Por qué la conservas" })).toHaveLength(2);
        // What the person wrote is shown as written.
        expect(screen.getByDisplayValue("Está en la cláusula 5")).toBeInTheDocument();
    });

    it("speaks en-US too", () => {
        inEn(<BackingPanel check={check()} onMark={vi.fn()} />);
        expect(screen.getByRole("region", { name: "Your conclusions and their sources" })).toBeInTheDocument();
        expect(screen.getByText("Backed")).toBeInTheDocument();
        expect(screen.getByText("Without backing")).toBeInTheDocument();
        expect(screen.getByText("Exact passage · contrato.docx, page 3")).toBeInTheDocument();
        expect(screen.getAllByRole("checkbox", { name: "I verified it" })).toHaveLength(3);
    });

    it("hands the mark to the host with its check", async () => {
        const onMark = vi.fn().mockResolvedValue(undefined);
        const row = check();
        inEs(<BackingPanel check={row} onMark={onMark} />);
        fireEvent.click(screen.getAllByRole("checkbox", { name: "Lo verifiqué" })[0]);
        await waitFor(() => expect(onMark).toHaveBeenCalledWith(row, "c1", { person_verified: true }));
    });

    it("names a passage without a page or a title", () => {
        inEs(
            <BackingPanel
                check={check({
                    conclusions: [
                        {
                            id: "c1", text: "t", citation_ref: 1, status: "backed", unverified_references: [],
                            passage: { ref: 1, title: null, page: null, excerpt: "pasaje" },
                            person_verified: false, person_note: null,
                        },
                    ],
                })}
                readOnly
            />,
        );
        expect(screen.getByText("Pasaje exacto · Documento citado")).toBeInTheDocument();
    });
});

describe("BackingSlot", () => {
    it("shows the check of the message, and nothing for another or for none", () => {
        const backing = { checks: new Map([["message-1", check()]]), mark: vi.fn() };
        const { container, rerender } = inEs(<BackingSlot backing={backing} messageId="message-1" />);
        expect(screen.getByRole("region")).toBeInTheDocument();
        rerender(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <BackingSlot backing={backing} messageId="message-2" />
            </IntlClientProvider>,
        );
        expect(container).toBeEmptyDOMElement();
        rerender(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <BackingSlot backing={backing} messageId={undefined} />
            </IntlClientProvider>,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe("useWebTrainingBacking", () => {
    beforeEach(() => {
        for (const fn of [getChatBacking, markBackingConclusion, getTrainingStage, notifyError]) fn.mockReset();
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
        <IntlClientProvider locale="es-MX" messages={esMX}>{children}</IntlClientProvider>
    );

    it("reads only for a junior", async () => {
        getTrainingStage.mockResolvedValue({ stage: "pasante", attempt_required: true, urgency_pass: null });
        getChatBacking.mockResolvedValue([check()]);
        const { result } = renderHook(
            () => useWebTrainingBacking({ chatId: "chat-1", projectId: null, isResponseLoading: false }),
            { wrapper },
        );
        await waitFor(() => expect(getTrainingStage).toHaveBeenCalled());
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(getChatBacking).not.toHaveBeenCalled();
        expect(result.current.checks.size).toBe(0);
    });

    it("reads for a junior and tells the person why a save failed", async () => {
        getTrainingStage.mockResolvedValue({ stage: "junior", attempt_required: false, urgency_pass: null });
        getChatBacking.mockResolvedValue([check()]);
        markBackingConclusion.mockRejectedValue(new Error("network"));
        const { result } = renderHook(
            () => useWebTrainingBacking({ chatId: "chat-1", projectId: "project-1", isResponseLoading: false }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.checks.get("message-1")).toBeDefined());
        await expect(result.current.mark(check(), "c1", { person_verified: true })).rejects.toThrow("network");
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
            action: "guardar tu marca en esta conclusión",
            operation: "training.read",
        });
    });
});

describe("BackingSection (the mentor's)", () => {
    beforeEach(() => {
        getPupilBacking.mockReset();
        notifyError.mockReset();
    });
    const data = (over: Partial<TrainingPupilBacking> = {}): TrainingPupilBacking => ({
        org_id: "org-1",
        trainee_user_id: "pupil-1",
        works: [{ surface: "chat", chat_id: "chat-1", project_id: "project-1", title: "Plazo de prescripción", checks: [check()] }],
        works_without_access: 2,
        ...over,
    });

    it("shows the work, each conclusion with its status and what the person did, read-only, in es-MX", async () => {
        getPupilBacking.mockResolvedValue(data());
        inEs(<BackingSection orgId="org-1" traineeId="pupil-1" />);
        expect(await screen.findByText("Plazo de prescripción")).toBeInTheDocument();
        expect(getPupilBacking).toHaveBeenCalledWith("org-1", "pupil-1");
        expect(screen.getByRole("heading", { name: "Rendición de cuentas" })).toBeInTheDocument();
        expect(screen.getByText(/3 conclusiones · 1 respaldadas · 1 sin respaldo · 1 con cita sin verificar/)).toBeInTheDocument();
        expect(screen.getByText(/Respuesta del/)).toBeInTheDocument();
        expect(screen.getByText("La persona la verificó")).toBeInTheDocument();
        expect(screen.getByText(/Está en la cláusula 5/)).toBeInTheDocument();
        expect(screen.queryByRole("checkbox")).toBeNull();
        expect(screen.getByText("2 trabajos están en asuntos que no puedes abrir, por eso no se muestran.")).toBeInTheDocument();
    });

    it("says there is nothing yet, in each language", async () => {
        getPupilBacking.mockResolvedValue(data({ works: [], works_without_access: 1 }));
        inEn(<BackingSection orgId="org-1" traineeId="pupil-1" />);
        expect(await screen.findByText("There are no accountability checks yet.")).toBeInTheDocument();
        expect(screen.getByText("1 work is in a matter you can't open, so it isn't shown.")).toBeInTheDocument();
    });

    it("shows a loading state, then the error with a retry and a toast", async () => {
        getPupilBacking.mockRejectedValueOnce(new Error("down")).mockResolvedValue(data());
        inEs(<BackingSection orgId="org-1" traineeId="pupil-1" />);
        expect(screen.getByLabelText("Cargando…")).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Reintentar" })).toBeInTheDocument();
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
            action: "cargar las revisiones de rendición de cuentas",
            operation: "training.manage",
        });
        fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
        expect(await screen.findByText("Plazo de prescripción")).toBeInTheDocument();
    });

    it("titles an untitled chat and names the surface; long text wraps", async () => {
        const long = "y".repeat(300);
        getPupilBacking.mockResolvedValue(
            data({
                works: [
                    { surface: "tabular", chat_id: "chat-2", project_id: null, title: null, checks: [check({ id: "check-2" })] },
                    { surface: "word", chat_id: "chat-3", project_id: null, title: long, checks: [check({ id: "check-3" })] },
                ],
                works_without_access: 0,
            }),
        );
        inEs(<BackingSection orgId="org-1" traineeId="pupil-1" />);
        expect(await screen.findByText("Chat sin título")).toBeInTheDocument();
        expect(screen.getByText("Revisión tabular")).toBeInTheDocument();
        expect(screen.getByText(long).className).toContain("break-words");
        expect(screen.queryByText(/no puedes abrir/)).toBeNull();
        const first = screen.getAllByRole("listitem")[0];
        expect(within(first).getByText("Chat sin título")).toBeInTheDocument();
    });
});
