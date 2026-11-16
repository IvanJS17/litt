import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRequestType } from "@mike/contracts";
import { RequestTypesSettings } from "./RequestTypesSettings";

const mocks = vi.hoisted(() => ({
  listRequestTypes: vi.fn(),
  createRequestType: vi.fn(),
  updateRequestType: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listRequestTypes: mocks.listRequestTypes,
  createRequestType: mocks.createRequestType,
  updateRequestType: mocks.updateRequestType,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const type = (over: Partial<MatterRequestType>): MatterRequestType => ({
  id: "t-1",
  seed_key: "contracts_clients",
  name: null,
  sort_order: 10,
  archived: false,
  ...over,
});
const catalog = [
  type({}),
  type({ id: "t-2", seed_key: "other", sort_order: 20 }),
  type({ id: "t-3", seed_key: null, name: "Poderes", sort_order: 30, archived: true }),
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequestTypesSettings", () => {
  it("shows a member the types read only, with the default ones worded in the reader's language", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: false });
    render(<RequestTypesSettings orgId="org-1" />);
    expect(await screen.findByText("Contracts with clients")).toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(screen.getByText("Poderes")).toBeInTheDocument();
    expect(screen.getByText("Only owners and administrators change the types.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add type" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/Archived\. Requests that already use it keep it/)).toBeInTheDocument();
  });

  it("lets an admin rename, archive, restore and add", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: true });
    mocks.updateRequestType.mockImplementation(async (_org: string, id: string, patch: Partial<MatterRequestType> & { archived?: boolean }) => ({
      ...catalog.find((entry) => entry.id === id)!,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
    }));
    mocks.createRequestType.mockResolvedValue(type({ id: "t-4", seed_key: null, name: "Marcas", sort_order: 40 }));
    render(<RequestTypesSettings orgId="org-1" />);
    const first = await screen.findByLabelText("Name of the type Contracts with clients");
    const rename = screen.getAllByRole("button", { name: "Rename" })[0];
    expect(rename).toBeDisabled();
    await userEvent.clear(first);
    await userEvent.type(first, "Contratos con clientes finales");
    await userEvent.click(rename);
    expect(mocks.updateRequestType).toHaveBeenCalledWith("org-1", "t-1", { name: "Contratos con clientes finales" });

    await userEvent.click(screen.getAllByRole("button", { name: "Archive" })[1]);
    expect(mocks.updateRequestType).toHaveBeenCalledWith("org-1", "t-2", { archived: true });
    // The archived type t-2 and the one that came archived: restore the second.
    await userEvent.click(screen.getAllByRole("button", { name: "Restore" })[1]);
    expect(mocks.updateRequestType).toHaveBeenCalledWith("org-1", "t-3", { archived: false });

    await userEvent.type(screen.getByLabelText("New type"), "Marcas");
    await userEvent.click(screen.getByRole("button", { name: "Add type" }));
    expect(mocks.createRequestType).toHaveBeenCalledWith("org-1", "Marcas");
    expect(await screen.findByLabelText("Name of the type Marcas")).toBeInTheDocument();
  });

  it("says when a name is taken, without an error popup", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: true });
    mocks.createRequestType.mockRejectedValue({ code: "request_type_name_taken" });
    render(<RequestTypesSettings orgId="org-1" />);
    await userEvent.type(await screen.findByLabelText("New type"), "Poderes");
    await userEvent.click(screen.getByRole("button", { name: "Add type" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Another type already has that name.");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });
});
