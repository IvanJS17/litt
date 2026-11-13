import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import type { ColumnConfig } from "../shared/types";
import { TREditColumnMenu } from "./TREditColumnMenu";

// What this file pins: deleting a column drops its results, so the menu's
// Delete button asks first and only the confirmation calls onDelete.
vi.mock("@/app/lib/mikeApi", () => ({ generateTabularColumnPrompt: vi.fn() }));

const column = { index: 3, name: "Governing law", prompt: "Which law?", format: "text" } as ColumnConfig;

async function openMenu(onDelete = vi.fn()) {
    const user = userEvent.setup();
    render(<TREditColumnMenu column={column} onSave={vi.fn()} onDelete={onDelete} />);
    await user.click(screen.getByRole("button"));
    return { user, onDelete };
}

describe("TREditColumnMenu delete confirmation", () => {
    it("does not delete on the first click; asks, then deletes on confirm", async () => {
        const { user, onDelete } = await openMenu();
        await user.click(screen.getByRole("button", { name: "Delete" }));
        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.getByText("Delete this column?")).toBeInTheDocument();
        expect(screen.getByText(/“Governing law” will be removed/)).toBeInTheDocument();

        const dialog = screen.getByRole("dialog");
        await user.click(
            Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Delete")!,
        );
        expect(onDelete).toHaveBeenCalledExactlyOnceWith(3);
    });

    it("cancel leaves the column alone", async () => {
        const { user, onDelete } = await openMenu();
        await user.click(screen.getByRole("button", { name: "Delete" }));
        await user.click(screen.getByRole("button", { name: "Cancel" }));
        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByText("Delete this column?")).toBeNull();
    });
});
