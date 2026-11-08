import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { CriterionTab } from "./CriterionTab";

// The «Criterio» tab is a container: each section loads and draws itself.

vi.mock("@/app/lib/mikeApi", () => ({
    getPupilCriterion: vi.fn(),
    getPupilBacking: vi.fn(),
    getPupilReviewAudits: vi.fn(),
    getPupilReadings: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));

const renderEs = (ui: React.ReactElement) =>
    render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            {ui}
        </IntlClientProvider>,
    );

beforeEach(() => vi.clearAllMocks());

describe("Pestaña Criterio", () => {
    it("mounts the map and the sections of cards 8, 9 and 10", async () => {
        vi.mocked(api.getPupilCriterion).mockResolvedValue({
            map: { topics: [], min_events: 3, window: 4, retake_after_days: 14 },
            calibration: { min_per_level: 3, marked_turns: 0, levels: [] },
            hints: { requested: 0, max_level: 0 },
            retakes: [],
            notes_without_access: 0,
        } as unknown as Awaited<ReturnType<typeof api.getPupilCriterion>>);
        vi.mocked(api.getPupilBacking).mockResolvedValue({ works: [], works_without_access: 0 } as unknown as Awaited<ReturnType<typeof api.getPupilBacking>>);
        vi.mocked(api.getPupilReviewAudits).mockResolvedValue({ audits: [], without_access: 0 } as unknown as Awaited<ReturnType<typeof api.getPupilReviewAudits>>);
        vi.mocked(api.getPupilReadings).mockResolvedValue({ readings: [], readings_without_access: 0 } as unknown as Awaited<ReturnType<typeof api.getPupilReadings>>);
        renderEs(<CriterionTab orgId="org-1" pupilId="pupil-1" />);
        for (const name of ["Mapa y calibración", "Rendición de cuentas", "Revisiones masivas"]) {
            expect(await screen.findByRole("heading", { name })).toBeInTheDocument();
        }
        const headings = (await screen.findAllByRole("heading", { level: 3 })).map((h) => h.textContent);
        expect(headings).toHaveLength(4);
        expect(screen.getByRole("heading", { name: /Lecturas completas/ })).toBeInTheDocument();
        for (const call of [api.getPupilCriterion, api.getPupilBacking, api.getPupilReviewAudits, api.getPupilReadings]) {
            expect(call).toHaveBeenCalledWith("org-1", "pupil-1");
        }
    });
});
