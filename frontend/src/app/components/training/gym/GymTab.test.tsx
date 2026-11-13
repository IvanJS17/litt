import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { GymTab } from "./GymTab";

vi.mock("@/app/lib/mikeApi", () => ({
    listGymCases: vi.fn(),
    createGymCase: vi.fn(),
    updateGymCase: vi.fn(),
    deleteGymCase: vi.fn(),
    draftGymCase: vi.fn(),
    listPupilGymAttempts: vi.fn(),
    assignGymAttempt: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));

const gymCase = (id: string, title: string): api.TrainingGymCase => ({
    id,
    org_id: "org-1",
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    practice: "civil",
    title,
    paragraphs: ["Uno."],
    errors: [{ paragraph: 1, kind: "other", explanation: "Porque sí." }],
    time_limit_minutes: 20,
    fictitious: true,
});
const attempt = (caseId: string, status: api.TrainingGymAttempt["status"]): api.TrainingGymAttempt => ({
    id: `at-${caseId}`,
    org_id: "org-1",
    trainee_user_id: "pupil-1",
    case_id: caseId,
    title: `Caso ${caseId}`,
    practice: "civil",
    paragraphs: ["Uno."],
    time_limit_minutes: 20,
    status,
    started_at: null,
    deadline_at: null,
    submitted_at: null,
    server_now: "2026-11-09T10:00:00Z",
    findings: [],
    hints: [],
    hints_used: 0,
    errors: [{ paragraph: 1, kind: "other", explanation: "Porque sí." }],
    result: status === "submitted" ? { found: [], missed: [{ error_index: 0, paragraph: 1 }], extra: [] } : null,
    created_at: "2026-11-05T00:00:00Z",
});

beforeEach(() => vi.clearAllMocks());

describe("Gimnasio del mentor", () => {
    it("assigns a case, and offers another attempt only after the last one was submitted", async () => {
        const user = userEvent.setup();
        vi.mocked(api.listGymCases).mockResolvedValue([gymCase("A", "Caso A"), gymCase("B", "Caso B"), gymCase("C", "Caso C")]);
        vi.mocked(api.listPupilGymAttempts).mockResolvedValue([attempt("A", "submitted"), attempt("B", "in_progress")]);
        vi.mocked(api.assignGymAttempt).mockResolvedValue(attempt("A", "assigned"));
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <GymTab orgId="org-1" pupilId="pupil-1" />
            </IntlClientProvider>,
        );
        const another = await screen.findAllByRole("button", { name: /Dar otro intento/ });
        expect(another).toHaveLength(1);
        expect(screen.getByRole("button", { name: "Asignar a este aprendiz: Caso B" })).toBeDisabled();

        await user.click(screen.getByRole("button", { name: "Asignar a este aprendiz: Caso C" }));
        expect(api.assignGymAttempt).toHaveBeenLastCalledWith("org-1", "pupil-1", "C");
        await user.click(another[0]);
        expect(api.assignGymAttempt).toHaveBeenLastCalledWith("org-1", "pupil-1", "A");
    });
});
