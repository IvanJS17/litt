import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { MikeApiError } from "@/app/lib/mikeApi";
import { StorageUsageCard } from "./StorageUsageCard";

const api = vi.hoisted(() => ({ user: vi.fn(), org: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserStorageUsage: api.user,
    getOrgStorageUsage: api.org,
}));

const GIB = 1024 ** 3;
const FULL_SENTENCE = enUS.settings.storage.fullBodyPersonal;
const FULL_SENTENCE_FIRM = enUS.settings.storage.fullBodyFirm;

beforeEach(() => vi.clearAllMocks());

function showing(usedBytes: number, limitBytes: number) {
    api.user.mockResolvedValue({ usedBytes, limitBytes });
    return render(<StorageUsageCard />);
}

describe("StorageUsageCard", () => {
    it("draws a skeleton in the same layout while it loads", () => {
        api.user.mockReturnValue(new Promise(() => {}));
        const { container } = render(<StorageUsageCard />);
        expect(screen.getByRole("heading", { name: "Your storage" })).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent("Loading…");
        expect(container.querySelector("[aria-busy=true]")).not.toBeNull();
        expect(container.querySelector(".animate-pulse")).not.toBeNull();
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("shows the figures in readable units, the meter and what counts", async () => {
        showing(4 * GIB, 10 * GIB);
        expect(await screen.findByText("4.0 GB of 10.0 GB in use")).toBeInTheDocument();
        const meter = screen.getByRole("progressbar", { name: "Storage space in use" });
        expect(meter).toHaveAttribute("aria-valuenow", "40");
        expect(meter).toHaveAttribute("aria-valuetext", "4.0 GB of 10.0 GB in use");
        expect(screen.getByText("40% used")).toBeInTheDocument();
        expect(screen.getByText("Includes the documents and versions stored in your personal space.")).toBeInTheDocument();
        expect(screen.queryByText(/shares this space/)).not.toBeInTheDocument();
        expect(screen.queryByText(/almost full|space is full/)).not.toBeInTheDocument();
        expect(api.user).toHaveBeenCalledTimes(1);
    });

    it("gives no notice at 79.9 %", async () => {
        showing(799, 1000);
        expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "79");
        expect(screen.queryByText("The space is almost full")).not.toBeInTheDocument();
        expect(document.querySelector("[data-slot=settings-notice]")).toBeNull();
    });

    it("says the space is almost full from 80 %, without saying uploads are refused yet", async () => {
        showing(8 * GIB, 10 * GIB);
        expect(await screen.findByText("The space is almost full")).toBeInTheDocument();
        expect(screen.getByText(/new files cannot be uploaded\. Everything stored stays available/)).toBeInTheDocument();
        expect(screen.queryByText("The space is full")).not.toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
    });

    it("says new files cannot be uploaded and how to free space, at the limit", async () => {
        showing(10 * GIB, 10 * GIB);
        expect(await screen.findByText("The space is full")).toBeInTheDocument();
        expect(screen.getByText(FULL_SENTENCE)).toBeInTheDocument();
        expect(screen.queryByText("The space is almost full")).not.toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    });

    it("keeps the figures true and the meter at 100 over the limit", async () => {
        showing(11 * GIB, 10 * GIB);
        expect(await screen.findByText("11.0 GB of 10.0 GB in use")).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        expect(screen.getByText("100% used")).toBeInTheDocument();
        expect(screen.getByText(FULL_SENTENCE)).toBeInTheDocument();
    });

    it("does not fail on a limit of zero", async () => {
        showing(0, 0);
        expect(await screen.findByText("0 B of 0 B in use")).toBeInTheDocument();
        expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
        expect(screen.getByText(FULL_SENTENCE)).toBeInTheDocument();
    });

    it("shows a firm's space with the line that it is shared and grows with its members", async () => {
        api.org.mockResolvedValue({ usedBytes: 30 * GIB, limitBytes: 100 * GIB });
        render(<StorageUsageCard orgId="org-1" />);
        expect(await screen.findByRole("heading", { name: "Firm storage" })).toBeInTheDocument();
        expect(await screen.findByText("30.0 GB of 100.0 GB in use")).toBeInTheDocument();
        expect(screen.getByText("The whole firm shares this space. It grows with the firm's accepted members.")).toBeInTheDocument();
        expect(screen.getByText("Includes the documents and versions stored in the firm.")).toBeInTheDocument();
        expect(api.org).toHaveBeenCalledWith("org-1", expect.any(AbortSignal));
        expect(api.user).not.toHaveBeenCalled();
    });

    it("says a full firm space in the firm's words, not the person's", async () => {
        api.org.mockResolvedValue({ usedBytes: 100 * GIB, limitBytes: 100 * GIB });
        render(<StorageUsageCard orgId="org-1" />);
        expect(await screen.findByText("The space is full")).toBeInTheDocument();
        expect(screen.getByText(FULL_SENTENCE_FIRM)).toBeInTheDocument();
        expect(screen.queryByText(FULL_SENTENCE)).not.toBeInTheDocument();
    });

    it("writes the number in the person's locale", async () => {
        api.user.mockResolvedValue({ usedBytes: 10.5 * GIB, limitBytes: 20 * GIB });
        render(
            <IntlClientProvider locale="es-MX" messages={esMX}>
                <StorageUsageCard />
            </IntlClientProvider>,
        );
        expect(await screen.findByText("10.5 GB de 20.0 GB en uso")).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Tu almacenamiento" })).toBeInTheDocument();
        expect(screen.getByText(/52\s?% usado/)).toBeInTheDocument();
    });

    it("says it could not load, never the raw error, and retries only when that is honest", async () => {
        api.user.mockRejectedValueOnce(new MikeApiError({ message: "boom: pg 42P01 stack", status: 500 }));
        api.user.mockResolvedValueOnce({ usedBytes: GIB, limitBytes: 2 * GIB });
        render(<StorageUsageCard />);
        const alert = await screen.findByRole("alert");
        expect(alert).not.toHaveTextContent(/boom|42P01|stack/);
        expect(alert).toHaveTextContent(/storage use/);
        expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Retry" }));
        expect(await screen.findByText("1.0 GB of 2.0 GB in use")).toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("offers no retry for a refusal that trying again will not change", async () => {
        api.org.mockRejectedValue(new MikeApiError({ message: "Forbidden", status: 403, code: "forbidden" }));
        render(<StorageUsageCard orgId="org-1" />);
        await screen.findByRole("alert");
        await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument());
    });
});
