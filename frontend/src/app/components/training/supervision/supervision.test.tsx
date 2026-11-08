import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { DefensesTab } from "./DefensesTab";
import { MentorPanel } from "./MentorPanel";
import { MentorSeesMe } from "./MentorSeesMe";
import { PassesTab } from "./PassesTab";
import { PromotionTab } from "./PromotionTab";
import { WorksTab } from "./WorksTab";

vi.mock("@/app/lib/mikeApi", () => ({
    getMyTraining: vi.fn(),
    getMyPupils: vi.fn(),
    listOrgMembers: vi.fn(),
    listProjects: vi.fn(),
    getPupilWorks: vi.fn(),
    generateWorkReview: vi.fn(async () => ({})),
    markWorkReviewed: vi.fn(async () => ({})),
    approveTrainingVersion: vi.fn(async () => ({})),
    getPupilDefenses: vi.fn(),
    createDefense: vi.fn(async () => ({})),
    generateDefenseQuestions: vi.fn(async () => ({})),
    recordDefenseOutcome: vi.fn(async () => ({})),
    getPupilPasses: vi.fn(),
    grantUrgencyPass: vi.fn(async () => ({})),
    revokeUrgencyPass: vi.fn(async () => undefined),
    getPupilPromotion: vi.fn(),
    acceptPromotion: vi.fn(async () => ({})),
    getMySupervision: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
    useWorkspace: () => ({ organizations: [{ id: "org-1", name: "Despacho Ruiz" }] }),
}));
// The dropdown is Radix; a native select keeps these tests about the panel.
vi.mock("@/app/components/modals/ModalSelect", () => ({
    ModalSelect: (props: {
        "aria-label"?: string;
        value: string;
        placeholder?: string;
        options: { value: string; label: string }[];
        onChange: (value: string) => void;
        disabled?: boolean;
    }) => (
        <select
            aria-label={props["aria-label"]}
            value={props.value}
            disabled={props.disabled}
            onChange={(event) => props.onChange(event.target.value)}
        >
            <option value="">{props.placeholder}</option>
            {props.options.map((option) => (
                <option key={option.value} value={option.value}>
                    {option.label}
                </option>
            ))}
        </select>
    ),
}));

const LONG_EMAIL = "luis.pasante.con.un.correo.muy.largo@despacho-ruiz.example.mx";
const HOUR = 3_600_000;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

const members = [
    { user_id: "pupil-1", display_name: "Luis Pasante", email: LONG_EMAIL, role: "member" },
    { user_id: "pupil-2", display_name: "", email: "eva@despacho-ruiz.example.mx", role: "member" },
] as unknown as api.OrgMember[];

const readyReview: api.TrainingWorkReview = {
    id: "rev-1",
    org_id: "org-1",
    trainee_user_id: "pupil-1",
    surface: "chat",
    chat_id: "chat-1",
    word_chat_id: null,
    tabular_chat_id: null,
    status: "ready",
    covered_through: iso(-HOUR),
    proposed: [{ source: "attempt", text: "Propongo rescindir el contrato." }],
    ai_corrected: [{ source: "contrast", text: "Faltó el plazo de aviso." }],
    doubts: [{ source: "inferred", text: "Dudó sobre la cláusula penal." }],
    unverified: [],
    signals: {
        notes: 2,
        contrasts_ready: 2,
        citations: 1,
        citations_unverified: 0,
        edits_accepted: 0,
        edits_rejected: 1,
        edits_pending: 0,
        held_versions: 2,
    },
    model_provider: "openai",
    model: "gpt-5.2",
    generated_at: iso(-HOUR),
    reviewed_at: null,
};

const generation: api.TrainingReviewGeneration = {
    available: true,
    model: "gpt-5.2",
    credential_options: [
        { credential_ref: "user:k1", source: "personal" },
        { credential_ref: "org:k2", source: "organization" },
    ],
    default_credential_ref: null,
};

function works(overrides: Partial<api.TrainingPupilWorks> = {}): api.TrainingPupilWorks {
    return {
        org_id: "org-1",
        trainee_user_id: "pupil-1",
        works: [
            {
                surface: "chat",
                chat_id: "chat-1",
                project_id: "proj-1",
                title: "Rescisión del arrendamiento",
                notes: 2,
                last_note_at: iso(-HOUR),
                review: readyReview,
                has_new_work: true,
            },
            {
                surface: "tabular",
                chat_id: "tab-1",
                project_id: null,
                title: null,
                notes: 1,
                last_note_at: iso(-2 * HOUR),
                review: null,
                has_new_work: false,
            },
        ],
        works_without_access: 1,
        generation,
        ...overrides,
    };
}

const pass = (overrides: Partial<api.TrainingUrgencyPass> = {}): api.TrainingUrgencyPass => ({
    id: "pass-1",
    org_id: "org-1",
    trainee_user_id: "pupil-1",
    project_id: "proj-1",
    starts_at: iso(-HOUR),
    expires_at: iso(4 * HOUR),
    reason_code: "audiencia",
    reason_note: "Audiencia mañana a las 9.",
    revoked_at: null,
    ...overrides,
});

const defense = (overrides: Partial<api.TrainingDefense> = {}): api.TrainingDefense => ({
    id: "def-1",
    org_id: "org-1",
    trainee_user_id: "pupil-1",
    practice: null,
    work_review_id: null,
    questions_status: "none",
    questions: null,
    model_provider: null,
    model: null,
    outcome: null,
    outcome_reason: null,
    outcome_note: null,
    held_at: null,
    created_at: iso(-HOUR),
    ...overrides,
});

const questions: api.TrainingDefenseQuestion[] = [
    ...[1, 2, 3, 4].map((n) => ({ kind: "base" as const, text: `¿Por qué ${n}?`, listen_for: `Razón ${n}` })),
    { kind: "cambio_de_hechos", text: "¿Y si el aviso llegó tarde?", listen_for: "El plazo" },
];

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listOrgMembers).mockResolvedValue(members);
    vi.mocked(api.listProjects).mockResolvedValue([
        { id: "proj-1", name: "Arrendamiento Ruiz", org_id: "org-1" },
        { id: "proj-other", name: "Otro despacho", org_id: "org-2" },
    ] as unknown as Awaited<ReturnType<typeof api.listProjects>>);
});

describe("Mentor panel", () => {
    it("lists the pupils by latest work, with pending reviews, the pass in force and the whole email", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([
            { org_id: "org-1", is_mentor: true, mentor_user_id: null, stages: [] },
        ]);
        vi.mocked(api.getMyPupils).mockResolvedValue({
            pupils: [
                { user_id: "pupil-2", stages: [] },
                { user_id: "pupil-1", stages: [] },
            ],
            candidates: [],
        });
        vi.mocked(api.getPupilWorks).mockImplementation(async (_org, userId) =>
            userId === "pupil-1" ? works() : works({ works: [] }),
        );
        vi.mocked(api.getPupilPasses).mockImplementation(async (_org, userId) => ({
            passes: userId === "pupil-1" ? [pass(), pass({ id: "old", expires_at: iso(-HOUR) })] : [],
        }));
        render(<MentorPanel />);
        expect(screen.getByLabelText("Loading…")).toHaveAttribute("aria-busy", "true");

        const buttons = await screen.findAllByRole("button", { name: /^Supervise / });
        expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
            "Supervise Luis Pasante",
            "Supervise eva@despacho-ruiz.example.mx",
        ]);
        expect(screen.getByText(LONG_EMAIL)).toBeInTheDocument();
        expect(screen.getByText("2 works waiting for review")).toBeInTheDocument();
        expect(screen.getByText("No work waiting for review")).toBeInTheDocument();
        expect(screen.getByText(/^Urgency pass in force until/)).toBeInTheDocument();
        expect(screen.getByText("No work yet")).toBeInTheDocument();
        expect(screen.getByText("Despacho Ruiz")).toBeInTheDocument();

        fireEvent.click(buttons[0]);
        const tabs = screen.getByRole("group", { name: "Supervision sections" });
        expect(within(tabs).getByRole("button", { name: "Works" })).toHaveAttribute("aria-pressed", "true");
        expect(await screen.findByText("Rescisión del arrendamiento")).toBeInTheDocument();

        vi.mocked(api.getPupilDefenses).mockResolvedValue({ defenses: [], generation });
        fireEvent.click(within(tabs).getByRole("button", { name: "Oral defense" }));
        expect(await screen.findByText("No defenses yet.")).toBeInTheDocument();
        fireEvent.click(within(tabs).getByRole("button", { name: "Urgency pass" }));
        expect(await screen.findAllByText("Arrendamiento Ruiz", { selector: "p" })).toHaveLength(2);
        vi.mocked(api.getPupilPromotion).mockResolvedValue({ proposals: [] });
        fireEvent.click(within(tabs).getByRole("button", { name: "Promotion" }));
        expect(await screen.findByText("This pupil has no stage to promote.")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "All pupils" }));
        expect(await screen.findAllByRole("button", { name: /^Supervise / })).toHaveLength(2);
    });

    it("tells a member who mentors no one, and an organization without pupils", async () => {
        vi.mocked(api.getMyTraining).mockResolvedValue([]);
        const { unmount } = render(<MentorPanel />);
        expect(await screen.findByText(/You are not a mentor in any organization/)).toBeInTheDocument();
        unmount();

        vi.mocked(api.getMyTraining).mockResolvedValue([
            { org_id: "org-1", is_mentor: true, mentor_user_id: null, stages: [] },
        ]);
        vi.mocked(api.getMyPupils).mockResolvedValue({ pupils: [], candidates: [] });
        render(<MentorPanel />);
        expect(await screen.findByText(/You have no pupils here yet/)).toBeInTheDocument();
    });

    it("reports a failed load with a toast and offers Retry", async () => {
        const failure = new Error("boom");
        vi.mocked(api.getMyTraining).mockRejectedValueOnce(failure).mockResolvedValue([]);
        render(<MentorPanel />);
        fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
        expect(notifyError).toHaveBeenCalledWith(failure, { action: "load your pupils", operation: "training.manage" });
        expect(await screen.findByText(/You are not a mentor/)).toBeInTheDocument();
    });
});

const heldLine = {
    source: "version",
    text: "Borrador de pasante sin aprobar: borrador.docx",
    ref: "ver-1",
    document_id: "doc-1",
};

describe("Works tab", () => {
    it("shows the four rows, marks inferred lines, and generates on the chosen key", async () => {
        vi.mocked(api.getPupilWorks).mockResolvedValue(works());
        render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText("Propongo rescindir el contrato.")).toBeInTheDocument();
        for (const row of ["What they proposed", "What the AI corrected", "Where they hesitated", "What was left unverified"])
            expect(screen.getAllByText(row)[0]).toBeInTheDocument();
        expect(screen.getByText("Dudó sobre la cláusula penal.").textContent).toContain("(inferred)");
        expect(screen.getByText("Nothing.")).toBeInTheDocument();
        expect(screen.getByText("There is new work since this review.")).toBeInTheDocument();
        expect(screen.getByText(/2 sealed drafts still wait for approval/)).toBeInTheDocument();
        expect(screen.getByText(/^1 work is in a matter you cannot open/)).toBeInTheDocument();
        expect(screen.getByText("Untitled work")).toBeInTheDocument();
        expect(screen.getByText(/^Tabular review · 1 note ·/)).toBeInTheDocument();

        // No default key: the mentor must choose one before generating.
        const generate = screen.getByRole("button", { name: "Generate review" });
        expect(generate).toBeDisabled();
        fireEvent.change(screen.getByRole("combobox", { name: "Key" }), { target: { value: "org:k2" } });
        fireEvent.click(generate);
        await waitFor(() =>
            expect(api.generateWorkReview).toHaveBeenCalledWith(
                "org-1",
                "pupil-1",
                { surface: "tabular", chatId: "tab-1" },
                "org:k2",
            ),
        );

        fireEvent.click(await screen.findByRole("button", { name: "Mark as reviewed" }));
        await waitFor(() =>
            expect(api.markWorkReviewed).toHaveBeenCalledWith("org-1", "pupil-1", { surface: "chat", chatId: "chat-1" }),
        );
    });

    describe("approving a held draft in its row", () => {
        const withHeld = () =>
            works({ works: [{ ...works().works[0], review: { ...readyReview, unverified: [heldLine] } }] });

        it("asks for confirmation, then uses the existing approval and marks the line approved", async () => {
            vi.mocked(api.getPupilWorks).mockResolvedValue(withHeld());
            render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
            const approve = await screen.findByRole("button", {
                name: "Approve this version: Borrador de pasante sin aprobar: borrador.docx",
            });
            fireEvent.click(approve);
            const dialog = await screen.findByRole("dialog", { name: "Approve this version?" });
            expect(api.approveTrainingVersion).not.toHaveBeenCalled();

            fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
            expect(api.approveTrainingVersion).not.toHaveBeenCalled();

            fireEvent.click(approve);
            fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
            await waitFor(() => expect(api.approveTrainingVersion).toHaveBeenCalledExactlyOnceWith("doc-1", "ver-1"));
            expect(await screen.findByText(/Approved$/)).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Approve this version/ })).toBeNull();
            expect(notifyError).not.toHaveBeenCalled();
        });

        it("offers the button again when the review is regenerated, whatever the version id", async () => {
            const held = (generatedAt: string) =>
                works({
                    works: [
                        {
                            ...works().works[0],
                            review: { ...readyReview, generated_at: generatedAt, unverified: [heldLine] },
                        },
                    ],
                });
            // One date, taken once: `iso` reads the clock, and a second reading
            // would be another generation.
            const first = held(iso(-3 * HOUR));
            vi.mocked(api.getPupilWorks)
                .mockResolvedValueOnce(first)
                // The reload after approving: the same review, still marked.
                .mockResolvedValueOnce(first)
                // A regeneration reads the server again: the same version id is held.
                .mockResolvedValue(held(iso(-HOUR)));
            render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
            fireEvent.click(await screen.findByRole("button", { name: /^Approve this version: / }));
            fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
            expect(await screen.findByText(/Approved$/)).toBeInTheDocument();
            await waitFor(() => expect(api.getPupilWorks).toHaveBeenCalledTimes(2));
            expect(await screen.findByText(/Approved$/)).toBeInTheDocument();

            fireEvent.change(screen.getByRole("combobox", { name: "Key" }), { target: { value: "org:k2" } });
            fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
            expect(await screen.findByRole("button", { name: /^Approve this version: / })).toBeInTheDocument();
            expect(screen.queryByText(/Approved$/)).toBeNull();
        });

        it("hands a refusal to notifyError and keeps the button", async () => {
            const refused = new Error("403");
            vi.mocked(api.getPupilWorks).mockResolvedValue(withHeld());
            vi.mocked(api.approveTrainingVersion).mockRejectedValueOnce(refused);
            render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
            fireEvent.click(await screen.findByRole("button", { name: /^Approve this version: / }));
            fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
            await waitFor(() =>
                expect(notifyError).toHaveBeenCalledWith(
                    refused,
                    expect.objectContaining({ action: "approve the version" }),
                ),
            );
            expect(screen.getByRole("button", { name: /^Approve this version: / })).toBeInTheDocument();
        });

        it("offers nothing on a line without a document (an older review) or on other sources", async () => {
            vi.mocked(api.getPupilWorks).mockResolvedValue(
                works({
                    works: [
                        {
                            ...works().works[0],
                            review: {
                                ...readyReview,
                                unverified: [
                                    { source: "version", text: "Borrador antiguo", ref: "ver-0" },
                                    { source: "citation", text: "Cita sin verificar", ref: "m1", document_id: "doc-9" },
                                ],
                            },
                        },
                    ],
                }),
            );
            render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
            expect(await screen.findByText("Borrador antiguo")).toBeInTheDocument();
            expect(screen.queryByRole("button", { name: /^Approve this version/ })).toBeNull();
        });
    });

    it("explains the missing key, generation states and the codes it can meet", async () => {
        vi.mocked(api.getPupilWorks).mockResolvedValue(
            works({
                generation: { available: false, code: "training_review_key_required" },
                works_without_access: 0,
                works: [
                    { ...works().works[0], review: { ...readyReview, status: "pending" }, has_new_work: false },
                    { ...works().works[1], review: { ...readyReview, status: "failed", reviewed_at: iso(0) } },
                ],
            }),
        );
        render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText(/you need an AI key you can use in this organization/)).toBeInTheDocument();
        expect(screen.getByText("Generating the review…")).toBeInTheDocument();
        expect(screen.getByText(/The review could not be generated/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /review|Regenerate/ })).toBeNull();
    });

    it("hands a refused generation to notifyError with its messages", async () => {
        const refused = new Error("409");
        vi.mocked(api.getPupilWorks).mockResolvedValue(
            works({ generation: { ...generation, credential_options: [generation.credential_options[0]] } }),
        );
        vi.mocked(api.generateWorkReview).mockRejectedValueOnce(refused);
        render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText("Propongo rescindir el contrato.")).toBeInTheDocument();
        expect(screen.queryByRole("combobox", { name: "Key" })).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                refused,
                expect.objectContaining({
                    action: "generate the review",
                    codeMessages: expect.objectContaining({
                        training_review_in_progress: expect.stringContaining("already being generated"),
                        chat_route_credential_unavailable: expect.stringContaining("no longer available"),
                    }),
                }),
            ),
        );
        expect(api.generateWorkReview).toHaveBeenCalledWith("org-1", "pupil-1", { surface: "chat", chatId: "chat-1" }, "user:k1");
    });

    it("shows an empty list", async () => {
        vi.mocked(api.getPupilWorks).mockResolvedValue(works({ works: [], works_without_access: 0 }));
        render(<WorksTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText("This pupil has no work with turn notes yet.")).toBeInTheDocument();
    });
});

describe("Oral defense tab", () => {
    it("creates a defense from a work or a practice area", async () => {
        vi.mocked(api.getPupilDefenses).mockResolvedValue({ defenses: [], generation });
        vi.mocked(api.getPupilWorks).mockResolvedValue(works());
        render(<DefensesTab orgId="org-1" pupilId="pupil-1" />);
        const work = await screen.findByRole("combobox", { name: "Work" });
        fireEvent.change(work, { target: { value: "rev-1" } });
        expect(screen.getByRole("combobox", { name: "Practice area" })).toHaveValue("__work__");
        fireEvent.click(screen.getByRole("button", { name: "Create defense" }));
        await waitFor(() =>
            expect(api.createDefense).toHaveBeenCalledWith("org-1", "pupil-1", { work_review_id: "rev-1" }),
        );

        fireEvent.change(await screen.findByRole("combobox", { name: "Practice area" }), {
            target: { value: "__other__" },
        });
        const create = screen.getByRole("button", { name: "Create defense" });
        expect(create).toBeDisabled();
        fireEvent.change(screen.getByRole("textbox", { name: "Practice area name" }), { target: { value: " Agrario " } });
        fireEvent.click(create);
        await waitFor(() => expect(api.createDefense).toHaveBeenLastCalledWith("org-1", "pupil-1", { practice: "Agrario" }));

        fireEvent.change(screen.getByRole("combobox", { name: "Work" }), { target: { value: "rev-1" } });
        fireEvent.change(screen.getByRole("combobox", { name: "Practice area" }), { target: { value: "__all__" } });
        fireEvent.click(screen.getByRole("button", { name: "Create defense" }));
        await waitFor(() =>
            expect(api.createDefense).toHaveBeenLastCalledWith("org-1", "pupil-1", { practice: null, work_review_id: "rev-1" }),
        );
        fireEvent.change(screen.getByRole("combobox", { name: "Work" }), { target: { value: "rev-1" } });
        fireEvent.change(screen.getByRole("combobox", { name: "Work" }), { target: { value: "__none__" } });
        expect(screen.getByRole("combobox", { name: "Practice area" })).toHaveValue("__all__");
    });

    it("generates the questions and records the outcome only after confirming", async () => {
        vi.mocked(api.getPupilDefenses).mockResolvedValue({
            defenses: [defense(), defense({ id: "def-2", practice: "civil", questions_status: "failed" })],
            generation: { ...generation, default_credential_ref: "user:k1" },
        });
        vi.mocked(api.getPupilWorks).mockResolvedValue(works());
        render(<DefensesTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText(/The questions could not be generated/)).toBeInTheDocument();
        const first = screen.getByText("All practice areas", { selector: "h3" }).closest("article")!;
        fireEvent.click(within(first).getByRole("button", { name: "Generate questions" }));
        await waitFor(() =>
            expect(api.generateDefenseQuestions).toHaveBeenCalledWith("org-1", "pupil-1", "def-1", "user:k1"),
        );

        const record = within(first).getByRole("button", { name: "Record outcome" });
        expect(record).toBeDisabled();
        fireEvent.click(within(first).getByRole("radio", { name: "Not approved" }));
        fireEvent.change(within(first).getByRole("combobox", { name: "Reason" }), {
            target: { value: "cambio_de_hechos_no_resuelto" },
        });
        fireEvent.change(within(first).getByRole("textbox", { name: "Note (optional)" }), {
            target: { value: "  Repasa el plazo.  " },
        });
        fireEvent.click(record);
        const dialog = await screen.findByRole("dialog", { name: "Record this outcome?" });
        expect(dialog).toHaveTextContent("Not approved: Did not resolve the change of facts");
        expect(api.recordDefenseOutcome).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog")).toBeNull();

        fireEvent.click(record);
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Record outcome" }));
        await waitFor(() =>
            expect(api.recordDefenseOutcome).toHaveBeenCalledWith("org-1", "pupil-1", "def-1", {
                outcome: "not_approved",
                reason: "cambio_de_hechos_no_resuelto",
                note: "Repasa el plazo.",
            }),
        );
    });

    it("shows a recorded defense with its five questions and the change of facts named", async () => {
        const refused = new Error("409");
        vi.mocked(api.getPupilDefenses).mockResolvedValue({
            defenses: [
                defense({
                    questions_status: "ready",
                    questions,
                    outcome: "approved",
                    outcome_reason: "razonamiento_solido",
                    outcome_note: "Bien defendido.",
                    held_at: iso(-HOUR),
                }),
                defense({ id: "def-3", questions_status: "pending" }),
            ],
            generation: { available: false, code: "training_review_key_required" },
        });
        vi.mocked(api.getPupilWorks).mockResolvedValue(works({ works: [] }));
        vi.mocked(api.recordDefenseOutcome).mockRejectedValueOnce(refused);
        render(<DefensesTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText(/^Approved on .* · Sound reasoning$/)).toBeInTheDocument();
        expect(screen.getByText("Bien defendido.")).toBeInTheDocument();
        expect(screen.getByText("Question 5 · Change of facts")).toBeInTheDocument();
        expect(screen.getByText("Listen for: El plazo")).toBeInTheDocument();
        expect(screen.getByText("Generating the questions…")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Generate questions" })).toBeNull();

        const pending = screen.getByText("Generating the questions…").closest("article")!;
        fireEvent.click(within(pending).getByRole("radio", { name: "Approved" }));
        fireEvent.change(within(pending).getByRole("combobox", { name: "Reason" }), { target: { value: "otro" } });
        fireEvent.click(within(pending).getByRole("button", { name: "Record outcome" }));
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Record outcome" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                refused,
                expect.objectContaining({
                    codeMessages: { training_defense_already_recorded: expect.stringContaining("already has an outcome") },
                }),
            ),
        );
        expect(api.recordDefenseOutcome).toHaveBeenCalledWith("org-1", "pupil-1", "def-3", {
            outcome: "approved",
            reason: "otro",
            note: null,
        });
    });
});

describe("Urgency pass tab", () => {
    it("grants a pass on one of the organization's matters", async () => {
        vi.mocked(api.getPupilPasses).mockResolvedValue({ passes: [] });
        render(<PassesTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText("No passes yet.")).toBeInTheDocument();
        const matter = screen.getByRole("combobox", { name: "Matter" });
        expect(within(matter).queryByText("Otro despacho")).toBeNull();
        expect(screen.getByRole("combobox", { name: "Duration" })).toHaveValue("480");
        expect(within(screen.getByRole("combobox", { name: "Duration" })).getByText("30 minutes")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Grant pass" })).toBeDisabled();

        fireEvent.change(matter, { target: { value: "proj-1" } });
        fireEvent.change(screen.getByRole("combobox", { name: "Duration" }), { target: { value: "120" } });
        fireEvent.change(screen.getByRole("combobox", { name: "Reason" }), { target: { value: "cliente_urgente" } });
        fireEvent.change(screen.getByRole("textbox", { name: "Note (optional)" }), { target: { value: "Firma hoy" } });
        fireEvent.click(screen.getByRole("button", { name: "Grant pass" }));
        await waitFor(() =>
            expect(api.grantUrgencyPass).toHaveBeenCalledWith("org-1", "pupil-1", {
                project_id: "proj-1",
                duration_minutes: 120,
                reason_code: "cliente_urgente",
                reason_note: "Firma hoy",
            }),
        );
        await waitFor(() => expect(screen.getByRole("combobox", { name: "Matter" })).toHaveValue(""));
    });

    it("offers only the matters the pupil can open too", async () => {
        vi.mocked(api.listProjects).mockResolvedValue([
            { id: "proj-1", name: "Arrendamiento Ruiz", org_id: "org-1" },
            { id: "proj-closed", name: "Asunto cerrado al pupilo", org_id: "org-1" },
            { id: "proj-other", name: "Otro despacho", org_id: "org-2" },
        ] as unknown as Awaited<ReturnType<typeof api.listProjects>>);
        vi.mocked(api.getPupilPasses).mockResolvedValue({ passes: [], grantable_project_ids: ["proj-1"] });
        render(<PassesTab orgId="org-1" pupilId="pupil-1" />);
        const matter = await screen.findByRole("combobox", { name: "Matter" });
        expect(api.getPupilPasses).toHaveBeenCalledWith("org-1", "pupil-1", ["proj-1", "proj-closed"]);
        expect(within(matter).getByText("Arrendamiento Ruiz")).toBeInTheDocument();
        expect(within(matter).queryByText("Asunto cerrado al pupilo")).toBeNull();
    });

    it("says so when the pupil can open none of the mentor's matters", async () => {
        vi.mocked(api.getPupilPasses).mockResolvedValue({ passes: [], grantable_project_ids: [] });
        render(<PassesTab orgId="org-1" pupilId="pupil-1" />);
        const matter = await screen.findByRole("combobox", { name: "Matter" });
        expect(matter).toBeDisabled();
        expect(
            within(matter).getByText("The pupil cannot open any of your matters in this organization"),
        ).toBeInTheDocument();
    });

    it("lists passes and revokes one in force only after confirming", async () => {
        const refused = new Error("409");
        vi.mocked(api.getPupilPasses).mockResolvedValue({
            passes: [
                pass(),
                pass({ id: "pass-2", project_id: "gone", revoked_at: iso(-HOUR), reason_note: null }),
                pass({ id: "pass-3", expires_at: iso(-HOUR), reason_code: "plazo", reason_note: null }),
            ],
        });
        vi.mocked(api.listProjects).mockResolvedValue([]);
        vi.mocked(api.grantUrgencyPass).mockRejectedValueOnce(refused);
        render(<PassesTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText(/^In force until/)).toBeInTheDocument();
        expect(screen.getByText(/^Revoked on/)).toBeInTheDocument();
        expect(screen.getByText(/^Ended on/)).toBeInTheDocument();
        expect(screen.getAllByText("A matter you cannot see")).toHaveLength(3);
        expect(screen.getByText("Audiencia mañana a las 9.")).toBeInTheDocument();
        expect(screen.getByRole("combobox", { name: "Matter" })).toBeDisabled();

        const revoke = screen.getByRole("button", { name: "Revoke the pass in A matter you cannot see" });
        fireEvent.click(revoke);
        const dialog = await screen.findByRole("dialog", { name: "Revoke this pass?" });
        expect(api.revokeUrgencyPass).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        fireEvent.click(revoke);
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
        await waitFor(() => expect(api.revokeUrgencyPass).toHaveBeenCalledWith("org-1", "pupil-1", "pass-1"));
        expect(screen.getAllByRole("button", { name: /^Revoke/ })).toHaveLength(1);
    });

    it("explains a refused pass", async () => {
        const refused = new Error("409");
        vi.mocked(api.getPupilPasses).mockResolvedValue({ passes: [] });
        vi.mocked(api.grantUrgencyPass).mockRejectedValueOnce(refused);
        render(<PassesTab orgId="org-1" pupilId="pupil-1" />);
        fireEvent.change(await screen.findByRole("combobox", { name: "Matter" }), { target: { value: "proj-1" } });
        fireEvent.click(screen.getByRole("button", { name: "Grant pass" }));
        await waitFor(() =>
            expect(notifyError).toHaveBeenCalledWith(
                refused,
                expect.objectContaining({
                    action: "grant the pass",
                    codeMessages: expect.objectContaining({
                        training_pass_pupil_no_access: expect.stringContaining("cannot open that matter"),
                        training_pass_limit_reached: expect.stringContaining("Revoke one first"),
                    }),
                }),
            ),
        );
        expect(screen.getByRole("combobox", { name: "Matter" })).toHaveValue("proj-1");
    });
});

describe("Promotion tab", () => {
    it("shows the pupil's own evidence against what is required and accepts only after confirming", async () => {
        const evidence = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, at: iso(-HOUR) }));
        vi.mocked(api.getPupilPromotion).mockResolvedValue({
            proposals: [
                {
                    practice: "civil",
                    from: "pasante",
                    to: "junior",
                    proposed: true,
                    blocked_by: null,
                    approved_defenses: evidence(2),
                    reviewed_works: evidence(3),
                    approved_versions: evidence(1),
                    required: { approved_defenses: 2, reviewed_works: 3 },
                },
                {
                    practice: null,
                    from: "junior",
                    to: "abogado",
                    proposed: false,
                    blocked_by: "not_approved_after",
                    approved_defenses: evidence(1),
                    reviewed_works: [],
                    approved_versions: [],
                    required: { approved_defenses: 2, reviewed_works: 3 },
                },
            ],
        });
        vi.mocked(api.acceptPromotion).mockRejectedValueOnce(new Error("409"));
        render(<PromotionTab orgId="org-1" pupilId="pupil-1" />);
        expect(await screen.findByText("civil: Intern → Junior")).toBeInTheDocument();
        expect(screen.getByText("All practice areas: Junior → Lawyer")).toBeInTheDocument();
        expect(screen.getByText("Approved defenses: 2 of 2")).toBeInTheDocument();
        expect(screen.getByText("Reviewed works: 0 of 3")).toBeInTheDocument();
        expect(screen.getByText("Approved drafts: 1")).toBeInTheDocument();
        expect(screen.getByText(/A defense was not approved after the last approved one/)).toBeInTheDocument();
        expect(screen.getByText("Not proposed yet.")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Accept proposal" })).toHaveLength(1);

        fireEvent.click(screen.getByRole("button", { name: "Accept proposal" }));
        const dialog = await screen.findByRole("dialog", { name: "Accept this promotion?" });
        expect(dialog).toHaveTextContent("civil: from Intern to Junior");
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(api.acceptPromotion).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Accept proposal" }));
        fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Accept proposal" }));
        await waitFor(() =>
            expect(api.acceptPromotion).toHaveBeenCalledWith("org-1", "pupil-1", { practice: "civil", to: "junior" }),
        );
        expect(notifyError).toHaveBeenCalledWith(
            expect.any(Error),
            expect.objectContaining({ codeMessages: { training_promotion_not_proposed: expect.any(String) } }),
        );
    });
});

describe("What my mentor sees of me", () => {
    const supervision: api.TrainingSupervision = {
        org_id: "org-1",
        work_reviews: [readyReview],
        defenses: [
            defense(),
            defense({
                id: "def-2",
                practice: "civil",
                questions,
                outcome: "approved",
                outcome_reason: "razonamiento_solido",
                held_at: iso(-HOUR),
            }),
        ],
        urgency_passes: [pass()],
    };

    it("shows the same reviews, defenses and passes, without a defense's questions before its outcome", async () => {
        vi.mocked(api.getMySupervision).mockResolvedValue(supervision);
        render(<MentorSeesMe orgId="org-1" />);
        expect(await screen.findByText("Propongo rescindir el contrato.")).toBeInTheDocument();
        expect(api.getMySupervision).toHaveBeenCalledWith("org-1");
        expect(screen.getByText(/A defense is scheduled/)).toBeInTheDocument();
        expect(screen.getAllByText(/^Question \d/)).toHaveLength(5);
        expect(screen.getByText("Arrendamiento Ruiz")).toBeInTheDocument();
        expect(screen.getByText("Hearing")).toBeInTheDocument();
    });

    it("shows the pupil a held draft's line, with nothing to approve", async () => {
        vi.mocked(api.getMySupervision).mockResolvedValue({
            ...supervision,
            work_reviews: [{ ...readyReview, unverified: [heldLine] }],
        });
        render(<MentorSeesMe orgId="org-1" />);
        expect(await screen.findByText(heldLine.text)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /^Approve this version/ })).toBeNull();
    });

    it("says when there is nothing yet, even if the matters cannot be listed", async () => {
        vi.mocked(api.getMySupervision).mockResolvedValue({
            org_id: "org-1",
            work_reviews: [],
            defenses: [],
            urgency_passes: [],
        });
        vi.mocked(api.listProjects).mockRejectedValue(new Error("offline"));
        render(<MentorSeesMe orgId="org-1" />);
        expect(await screen.findByText("No reviews yet.")).toBeInTheDocument();
        expect(screen.getByText("No defenses yet.")).toBeInTheDocument();
        expect(screen.getByText("No passes yet.")).toBeInTheDocument();
    });

    it("speaks Spanish in es-MX and leaves the learning text as written", async () => {
        vi.mocked(api.getMySupervision).mockResolvedValue({ ...supervision, defenses: [], urgency_passes: [] });
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <MentorSeesMe orgId="org-1" />
            </IntlClientProvider>,
        );
        expect(await screen.findByText("Lo que mi mentor ve de mí")).toBeInTheDocument();
        expect(screen.getByText("Qué propuso")).toBeInTheDocument();
        expect(screen.getByText("Dudó sobre la cláusula penal.").textContent).toContain("(inferido)");
        expect(screen.getByText("Faltó el plazo de aviso.")).toBeInTheDocument();
        expect(screen.getByText("Sin revisar todavía")).toBeInTheDocument();
    });
});
