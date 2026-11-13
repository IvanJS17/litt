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

    it("lays the overview header and its rows on the same columns, so the usage columns line up", async () => {
        mocks.get.mockResolvedValue(stats);
        render(<BetaStatsSection />);
        const header = await screen.findByTestId("stats-overview-header");
        const rows = screen.getAllByTestId("stats-overview-row");
        const template = (el: HTMLElement) => el.className.split(" ").find((c) => c.startsWith("lg:grid-cols-"));
        expect(template(header)).toBeDefined();
        for (const row of rows) {
            expect(template(row)).toBe(template(header));
            expect(row.className).toContain("gap-x-4");
            expect(row.className).toContain("pl-3");
        }
        expect(header.className).toContain("gap-x-4");
        expect(header.className).toContain("pl-3");
    });

    it("pads the small tables' header like their rows, and gives the Persona column room for an email", async () => {
        mocks.get.mockResolvedValue(stats);
        render(<BetaStatsSection />);
        const email = await screen.findByText("a-very-long-address.for.mobile@firma-uno.example");
        // Whole on a phone, broken inside a word only below a wide screen.
        expect(email.className).toContain("lg:break-words");
        expect(email.className).toContain("lg:[word-break:normal]");
        const row = email.closest("[class*='lg:grid-cols-']") as HTMLElement;
        expect(row.className).toContain("lg:grid-cols-[minmax(16rem,");
        const small = screen.getAllByText("Count")[0].closest("[class*='justify-between']") as HTMLElement;
        expect(small.className).toContain("pl-3");
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

    it("shows the last activity in the interface language and breaks only emails inside a word", async () => {
        mocks.get.mockResolvedValue(stats);
        render(<BetaStatsSection />);
        await screen.findByText("Ana Pérez");
        // The app's formatter (en-US here), never the browser's "11/12/2026, 4:00:00 AM".
        expect(screen.getByText(/Nov 12, 2026/)).toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);
        const firm = screen.getAllByText("Firma Uno").find((el) => el.tagName === "TD" || el.closest("[class*='break-']"));
        expect(firm!.closest("[class*='break-words']")).not.toBeNull();
        expect(firm!.closest("[class*='break-all']")).toBeNull();
        expect(screen.getByText("a-very-long-address.for.mobile@firma-uno.example").className).toContain("break-all");
    });

    it("says so when the statistics cannot be loaded", async () => {
        mocks.get.mockRejectedValue(new Error("boom"));
        render(<BetaStatsSection />);
        expect(await screen.findByRole("alert")).toBeInTheDocument();
    });
});
