import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BetaStatsSection } from "./BetaStatsSection";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getPlatformStats: mocks.get,
}));

const usage = (n: number) => ({
    chats: n, documents: n, compared: n, converted: n, scans: n, split: n, tabular: n, training: n,
});
const stats = {
    generated_at: "2026-11-13T00:00:00Z",
    legal_version: "2026-11-13.2",
    totals: { users: 3, deleted_users: 1, organizations: 1, awaiting_acceptance: 1 },
    breakdowns: {
        scope: [{ key: "private_practice", count: 2 }],
        title: [{ key: "Partner", count: 1 }, { key: null, count: 1 }],
        jurisdiction: [{ key: "CDMX", count: 2 }, { key: "Mexico", count: 1 }],
        practice_area: [{ key: "Civil", count: 2 }, { key: "Employment", count: 1 }],
    },
    usage: { last_7_days: usage(1), last_30_days: usage(2) },
    organizations: [{ name: "Firma Uno", members: 1, usage: usage(2) }],
    people: [
        {
            deleted: false, name: "Ana Pérez", email: "a-very-long-address.for.mobile@firma-uno.example",
            organizations: ["Firma Uno"], scope: "private_practice", title: "Partner",
            jurisdiction: "CDMX", practice_areas: ["Civil"], usage: usage(2),
            last_activity: "2026-11-12T10:00:00Z",
        },
        {
            deleted: true, name: null, email: null, organizations: [], scope: null, title: null,
            jurisdiction: null, practice_areas: [], usage: usage(1), last_activity: null,
        },
    ],
};

describe("BetaStatsSection", () => {
    beforeEach(() => vi.clearAllMocks());

    it("shows a loading state until the counts arrive", async () => {
        mocks.get.mockReturnValue(new Promise(() => {}));
        const { container } = render(<BetaStatsSection />);
        expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
        expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    });

    it("renders the overview, firms and people, with the email whole and a deleted user without profile", async () => {
        mocks.get.mockResolvedValue(stats);
        render(<BetaStatsSection />);
        expect(await screen.findByText("Overview")).toBeInTheDocument();
        expect(screen.getAllByText("Firma Uno").length).toBe(2);
        expect(screen.getByText("Private practice")).toBeInTheDocument();
        const email = screen.getByText("a-very-long-address.for.mobile@firma-uno.example");
        expect(email.className).toContain("break-all");
        expect(email.closest("[class~='truncate']")).toBeNull();
        expect(email.parentElement!.className).toContain("text-clip");
        expect(screen.getByText("Deleted user")).toBeInTheDocument();
        expect(screen.getByText("They count in the totals but don't appear by firm or by person until they accept.")).toBeInTheDocument();
        expect(within(screen.getByText("Chats", { selector: "div" }).parentElement!).getAllByText(/^[12]$/).length).toBeGreaterThan(0);
        // Nothing to export.
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("names areas, titles and jurisdictions in the interface language, as onboarding does", async () => {
        mocks.get.mockResolvedValue(stats);
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <BetaStatsSection />
            </IntlClientProvider>,
        );
        expect(await screen.findAllByText("Laboral")).not.toHaveLength(0);
        expect(screen.getByText("Socio")).toBeInTheDocument();
        expect(screen.getByText("México")).toBeInTheDocument();
        expect(screen.queryByText("Employment")).not.toBeInTheDocument();
        expect(screen.queryByText("Partner")).not.toBeInTheDocument();
        // A value outside the lists is shown as saved.
        expect(screen.getAllByText("Civil").length).toBeGreaterThan(0);
    });

    it("says so when the statistics cannot be loaded", async () => {
        mocks.get.mockRejectedValue(new Error("boom"));
        render(<BetaStatsSection />);
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
});
