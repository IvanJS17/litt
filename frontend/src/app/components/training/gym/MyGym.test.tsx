import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { MyGym } from "./MyGym";

vi.mock("@/app/lib/mikeApi", () => ({
    listMyGymAttempts: vi.fn(),
    getMyGymAttempt: vi.fn(),
    startGymAttempt: vi.fn(),
    saveGymFindings: vi.fn(),
    askGymHint: vi.fn(),
    submitGymAttempt: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));

const NOW = Date.parse("2026-11-09T10:00:00Z");
const attempt = (patch: Partial<api.TrainingGymAttempt>): api.TrainingGymAttempt => ({
    id: "a1",
    org_id: "org-1",
    trainee_user_id: "u1",
    case_id: "c1",
    title: "Contrato de arrendamiento",
    practice: "civil",
    paragraphs: ["Primer párrafo.", "Segundo párrafo."],
    time_limit_minutes: 1,
    status: "in_progress",
    started_at: new Date(NOW).toISOString(),
    deadline_at: new Date(NOW + 2000).toISOString(),
    submitted_at: null,
    server_now: new Date(NOW).toISOString(),
    findings: [],
    hints: [],
    hints_used: 0,
    errors: null,
    result: null,
    created_at: new Date(NOW).toISOString(),
    ...patch,
});

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW }));
afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("Gimnasio del pupilo", () => {
    it("shows no explanation before submitting, and reads the attempt again when the clock hits zero", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        const running = attempt({ findings: [{ paragraph: 1, kind: "other", note: "" }] });
        vi.mocked(api.listMyGymAttempts).mockResolvedValue([running]);
        vi.mocked(api.getMyGymAttempt)
            .mockResolvedValueOnce(running)
            .mockResolvedValue(
                attempt({
                    status: "submitted",
                    submitted_at: running.deadline_at,
                    server_now: new Date(NOW + 3000).toISOString(),
                    errors: [{ paragraph: 1, kind: "repealed_article", explanation: "El artículo ya no existe." }],
                    result: { found: [{ error_index: 0, paragraph: 1, kind_matches: false }], missed: [], extra: [] },
                    findings: running.findings,
                }),
            );
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <MyGym orgId="org-1" />
            </IntlClientProvider>,
        );
        await user.click(await screen.findByRole("button", { name: /Continuar/ }));
        expect(await screen.findByRole("timer")).toHaveTextContent("0:02");
        expect(screen.getByText("Primer párrafo.")).toBeInTheDocument();
        expect(screen.getAllByText("Caso ficticio de práctica").length).toBeGreaterThan(0);
        expect(screen.queryByText(/ya no existe/)).not.toBeInTheDocument();
        expect(screen.queryByText("Resultado")).not.toBeInTheDocument();

        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
        expect(await screen.findByText("Resultado")).toBeInTheDocument();
        expect(api.getMyGymAttempt).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/tipo distinto/)).toBeInTheDocument();
        expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    });
});
