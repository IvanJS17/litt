import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterRequestType } from "@mike/contracts";
import { RequestTypesSettings } from "./RequestTypesSettings";

const mocks = vi.hoisted(() => ({
  listRequestTypes: vi.fn(),
  createRequestType: vi.fn(),
  updateRequestType: vi.fn(),
  listRequestTypePlaybooks: vi.fn(),
  linkRequestTypePlaybook: vi.fn(),
  unlinkRequestTypePlaybook: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listRequestTypes: mocks.listRequestTypes,
  createRequestType: mocks.createRequestType,
  updateRequestType: mocks.updateRequestType,
  listRequestTypePlaybooks: mocks.listRequestTypePlaybooks,
  linkRequestTypePlaybook: mocks.linkRequestTypePlaybook,
  unlinkRequestTypePlaybook: mocks.unlinkRequestTypePlaybook,
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

const READY = { id: "p-1", name: "Arrendamiento" };
const READY_2 = { id: "p-2", name: "Confidencialidad" };
const noLinks = (over: object = {}) => ({ links: [], available: [READY, READY_2], can_manage: true, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listRequestTypePlaybooks.mockResolvedValue(noLinks());
});

describe("RequestTypesSettings", () => {
  it("shows the load error in the section when the catalog cannot be read", async () => {
    mocks.listRequestTypes.mockRejectedValue(new Error("boom"));
    render(<RequestTypesSettings orgId="org-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the request types");
    expect(mocks.notifyError).toHaveBeenCalled();
  });

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

  it("lets an admin tick a ready playbook for a type and untick it, with the result announced", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: true });
    mocks.linkRequestTypePlaybook.mockResolvedValue({ type_id: "t-1", playbook_id: "p-1", name: "Arrendamiento", linked_at: "2026-11-19T00:00:00Z" });
    mocks.unlinkRequestTypePlaybook.mockResolvedValue({ type_id: "t-1", playbook_id: "p-1", unlinked: true });
    render(<RequestTypesSettings orgId="org-1" />);
    const group = await screen.findByRole("group", { name: "Suggested playbooks for Contracts with clients" });
    const box = within(group).getByRole("checkbox", { name: "Arrendamiento" });
    expect(box).not.toBeChecked();
    // The archived type has no selector.
    expect(screen.getAllByRole("group")).toHaveLength(2);
    await userEvent.click(box);
    expect(mocks.linkRequestTypePlaybook).toHaveBeenCalledWith("org-1", "t-1", "p-1");
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByRole("status")).toHaveTextContent("Arrendamiento linked to Contracts with clients.");
    // The same playbook on another type stays unticked.
    const other = screen.getByRole("group", { name: "Suggested playbooks for Other" });
    expect(within(other).getByRole("checkbox", { name: "Arrendamiento" })).not.toBeChecked();

    await userEvent.click(box);
    expect(mocks.unlinkRequestTypePlaybook).toHaveBeenCalledWith("org-1", "t-1", "p-1");
    await waitFor(() => expect(box).not.toBeChecked());
    expect(screen.getByRole("status")).toHaveTextContent("Arrendamiento unlinked from Contracts with clients.");
  });

  it("shows the ticked playbooks of a type that already has some", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: true });
    mocks.listRequestTypePlaybooks.mockResolvedValue(
      noLinks({ links: [{ type_id: "t-2", playbook_id: "p-2", name: "Confidencialidad", linked_at: "x" }] }),
    );
    render(<RequestTypesSettings orgId="org-1" />);
    const other = await screen.findByRole("group", { name: "Suggested playbooks for Other" });
    expect(within(other).getByRole("checkbox", { name: "Confidencialidad" })).toBeChecked();
    expect(within(other).getByRole("checkbox", { name: "Arrendamiento" })).not.toBeChecked();
  });

  it("says there are no ready playbooks when the firm has none", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: [catalog[0]], can_manage: true });
    mocks.listRequestTypePlaybooks.mockResolvedValue(noLinks({ available: [] }));
    render(<RequestTypesSettings orgId="org-1" />);
    expect(await screen.findByText("No ready playbooks shared with the firm yet.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows a member the linked playbooks read only, or that there are none", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: [catalog[0], catalog[1]], can_manage: false });
    mocks.listRequestTypePlaybooks.mockResolvedValue(
      noLinks({ can_manage: false, links: [{ type_id: "t-1", playbook_id: "p-1", name: "Arrendamiento", linked_at: "x" }] }),
    );
    render(<RequestTypesSettings orgId="org-1" />);
    expect(await screen.findByText("Arrendamiento")).toBeInTheDocument();
    expect(screen.getByText("No playbook linked.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/Only ready playbooks shared/)).not.toBeInTheDocument();
  });

  it("keeps the catalog and says so when the playbooks cannot be loaded", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: catalog, can_manage: true });
    mocks.listRequestTypePlaybooks.mockRejectedValue(new Error("boom"));
    render(<RequestTypesSettings orgId="org-1" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the suggested playbooks.");
    expect(screen.getByLabelText("Name of the type Contracts with clients")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(mocks.notifyError).toHaveBeenCalled();
  });

  it("explains a playbook that is no longer ready, and reports other failures in the popup", async () => {
    mocks.listRequestTypes.mockResolvedValue({ types: [catalog[0]], can_manage: true });
    mocks.linkRequestTypePlaybook.mockRejectedValueOnce({ code: "playbook_not_ready" });
    render(<RequestTypesSettings orgId="org-1" />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Arrendamiento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That playbook is not ready, so it cannot be linked.");
    expect(mocks.notifyError).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Arrendamiento" })).not.toBeChecked();

    mocks.linkRequestTypePlaybook.mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(screen.getByRole("checkbox", { name: "Arrendamiento" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
