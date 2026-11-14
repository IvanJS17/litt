import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SplitClassesSettings } from "@mike/contracts";
import { SplitClassesCard } from "./SplitClassesCard";

const mocks = vi.hoisted(() => ({ notify: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notify }));
vi.mock("@/app/components/ui/toast", () => ({ showToast: mocks.toast }));

const DEFAULTS = [
    { name: "Poder", description: "Un poder notarial." },
    { name: "Constancia", description: "Constancia fiscal.", identifier: "RFC" },
];
const settings = (patch: Partial<SplitClassesSettings> = {}): SplitClassesSettings => ({
    classes: DEFAULTS,
    custom: false,
    defaults: DEFAULTS,
    max: 3,
    ...patch,
});

const load = vi.fn();
const save = vi.fn();
const open = () =>
    render(<SplitClassesCard title="Document types" intro="Intro text." load={load} save={save} />);

beforeEach(() => {
    vi.clearAllMocks();
    load.mockResolvedValue(settings());
    save.mockImplementation(async (classes: unknown) =>
        classes === null ? settings() : settings({ classes: classes as never, custom: true }),
    );
});

describe("SplitClassesCard", () => {
    it("shows a loading placeholder, then the types with their fields and the client-data note", async () => {
        open();
        expect(screen.getByRole("heading", { name: "Document types" })).toBeInTheDocument();
        expect(await screen.findByDisplayValue("Poder")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Un poder notarial.")).toBeInTheDocument();
        expect(screen.getByDisplayValue("RFC")).toBeInTheDocument();
        expect(screen.getByText("Using the included list.")).toBeInTheDocument();
        expect(screen.getByText("2 of 3 types")).toBeInTheDocument();
        // Next to the description: no client data, because it is sent to LandingAI too.
        const note = screen.getByText(/Don’t write client data here/);
        for (const field of screen.getAllByLabelText("Description")) expect(field).toHaveAttribute("aria-describedby", note.id);
        expect(screen.getByRole("button", { name: "Save types" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Restore the included types" })).toBeDisabled();
        // Framed as a notice that names the third party, and before the fields (not at the foot).
        const notice = note.closest("[data-slot=settings-notice]") as HTMLElement;
        expect(notice).toHaveTextContent("Data to a third party");
        expect(
            notice.compareDocumentPosition(screen.getByDisplayValue("Poder")) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });

    it("edits a type and saves the list, then shows it as the person's own", async () => {
        open();
        const name = await screen.findByDisplayValue("Poder");
        await userEvent.clear(name);
        await userEvent.type(name, "Poder especial");
        await userEvent.click(screen.getByRole("button", { name: "Save types" }));
        await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ tone: "success", message: "Types saved." }));
        expect(save).toHaveBeenCalledWith([
            { name: "Poder especial", description: "Un poder notarial." },
            { name: "Constancia", description: "Constancia fiscal.", identifier: "RFC" },
        ]);
        expect(await screen.findByText("Using a list of your own.")).toBeInTheDocument();
    });

    it("adds a type up to the limit and removes one, but never the last", async () => {
        open();
        await screen.findByDisplayValue("Poder");
        await userEvent.click(screen.getByRole("button", { name: "Add a type" }));
        expect(screen.getByText("3 of 3 types")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add a type" })).toBeDisabled();
        // The new empty type blocks saving, with the reason.
        expect(screen.getByRole("alert")).toHaveTextContent("Every type needs a name");
        expect(screen.getByRole("button", { name: "Save types" })).toBeDisabled();
        await userEvent.click(screen.getByRole("button", { name: "Remove type 3" }));
        expect(screen.getByText("2 of 3 types")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Remove type Poder" }));
        expect(screen.getByRole("button", { name: "Remove type Constancia" })).toBeDisabled();
    });

    it("refuses a duplicate name and a reserved one", async () => {
        open();
        const name = await screen.findByDisplayValue("Constancia");
        await userEvent.clear(name);
        await userEvent.type(name, "poder");
        expect(screen.getByRole("alert")).toHaveTextContent("Two types have the same name.");
        await userEvent.clear(name);
        await userEvent.type(name, "Uncategorized");
        expect(screen.getByRole("alert")).toHaveTextContent("reserved");
        expect(screen.getByRole("button", { name: "Save types" })).toBeDisabled();
    });

    it("restores the included list, and saving it clears the person's own list (null)", async () => {
        load.mockResolvedValue(settings({ classes: [{ name: "Mío", description: "Mi tipo." }], custom: true }));
        open();
        expect(await screen.findByText("Using a list of your own.")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Restore the included types" }));
        expect(screen.getByDisplayValue("Poder")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("button", { name: "Save types" }));
        await waitFor(() => expect(save).toHaveBeenCalledWith(null));
        expect(await screen.findByText("Using the included list.")).toBeInTheDocument();
    });

    it("is read-only for somebody who may not change it", async () => {
        load.mockResolvedValue(settings({ can_manage: false }));
        open();
        const name = await screen.findByDisplayValue("Poder");
        expect(name).toHaveAttribute("readonly");
        expect(screen.getByText("Only owners and admins can change this list.")).toBeInTheDocument();
        for (const label of ["Save types", "Add a type", "Restore the included types", "Remove type Poder"])
            expect(screen.queryByRole("button", { name: label })).toBeNull();
    });

    it("reports a failed save with a retry, keeps the edits, and a failed load", async () => {
        const failure = new Error("boom");
        save.mockRejectedValueOnce(failure);
        open();
        const name = await screen.findByDisplayValue("Poder");
        await userEvent.type(name, "x");
        await userEvent.click(screen.getByRole("button", { name: "Save types" }));
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledTimes(1));
        const [error, options] = mocks.notify.mock.calls[0];
        expect(error).toBe(failure);
        expect(options.action).toBe("save the document types");
        expect(screen.getByDisplayValue("Poderx")).toBeInTheDocument();
        await options.onRetry();
        await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    });

    it("reports a failed load and shows no list", async () => {
        const failure = new Error("down");
        load.mockRejectedValueOnce(failure);
        open();
        await waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(failure, { action: "load the document types" }));
        expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("ignores a load that finishes after it was unmounted", async () => {
        let finish: (value: SplitClassesSettings) => void = () => {};
        load.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        let fail: (error: Error) => void = () => {};
        const view = open();
        view.unmount();
        finish(settings());
        load.mockReturnValue(new Promise((_, reject) => (fail = reject)));
        const second = open();
        second.unmount();
        fail(new Error("late"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(mocks.notify).not.toHaveBeenCalled();
    });
});
