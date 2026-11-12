import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MikeApiError, type Org } from "@/app/lib/mikeApi";
import {
  CreateOrganizationModal,
  InviteOrganizationMemberModal,
} from "./OrganizationModals";

// What this file pins:
//
//   1. A success notice that is quietly contradicted by the list beside it.
//      The invitation was sent; the follow-up refresh failed into a console
//      line; the pending list stayed as it was — so "Invitation sent" read as
//      "…and nothing happened".
//
//   2. A partly failed creation that says only "some invitations were not
//      sent". It names every address that did not go out, with a reason the
//      reader can act on, and never prints the server's own words.
//
// (Renaming and deleting an organization moved out of a dialog and into its
// settings: see OrganizationGeneralSettings.test.tsx.)

const mocks = vi.hoisted(() => ({
  createOrgInvitation: vi.fn(),
  cancelOrgInvitation: vi.fn(),
  resendOrgInvitation: vi.fn(),
  updateOrg: vi.fn(),
  deleteOrg: vi.fn(),
  createOrg: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  createOrgInvitation: mocks.createOrgInvitation,
  cancelOrgInvitation: mocks.cancelOrgInvitation,
  resendOrgInvitation: mocks.resendOrgInvitation,
  updateOrg: mocks.updateOrg,
  deleteOrg: mocks.deleteOrg,
  createOrg: mocks.createOrg,
}));

const org: Org = {
  id: "org-1",
  name: "Elite Law LLP",
  created_by: "me",
  role: "admin",
} as Org;

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  mocks.createOrgInvitation.mockResolvedValue({ email_sent: true });
  mocks.cancelOrgInvitation.mockResolvedValue(undefined);
  mocks.resendOrgInvitation.mockResolvedValue(undefined);
  mocks.deleteOrg.mockResolvedValue(undefined);
});

async function typeInvitation(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => {
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
  await user.type(
    screen.getByPlaceholderText("Invite by email…"),
    "new@firm.example",
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
}

describe("InviteOrganizationMemberModal", () => {
  it("keeps the success notice and admits the list is stale", async () => {
    const user = userEvent.setup();
    render(
      <InviteOrganizationMemberModal
        open
        org={org}
        invitations={[]}
        onClose={vi.fn()}
        onChanged={() => Promise.reject(new Error("refresh failed"))}
      />,
    );

    await typeInvitation(user);

    await waitFor(() => expect(mocks.createOrgInvitation).toHaveBeenCalled());
    expect(
      await screen.findByText(
        "We emailed them the invitation. The list below may be out of date — reload to see the current one.",
      ),
    ).toBeInTheDocument();
    // The mutation succeeded, so it is still not reported as a failure.
    expect(
      screen.queryByText("Invitation action failed"),
    ).not.toBeInTheDocument();
  });

  it("says only that the invitation was sent when the refresh lands", async () => {
    const user = userEvent.setup();
    render(
      <InviteOrganizationMemberModal
        open
        org={org}
        invitations={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await typeInvitation(user);

    expect(
      await screen.findByText("We emailed them the invitation"),
    ).toBeInTheDocument();
  });

  it("tells the admin when the invitation email could not be sent", async () => {
    mocks.createOrgInvitation.mockResolvedValue({ email_sent: false });
    const user = userEvent.setup();
    render(
      <InviteOrganizationMemberModal
        open
        org={org}
        invitations={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await typeInvitation(user);

    expect(
      await screen.findByText(
        "We couldn't send the email. Tell them to sign in to LiTT with that email",
      ),
    ).toBeInTheDocument();
  });
});

describe("CreateOrganizationModal: invitations that did not go out", () => {
  const refusal = (status: number, code: string) =>
    new MikeApiError({ message: "raw backend text", status, code });

  async function addEmail(user: ReturnType<typeof userEvent.setup>, email: string) {
    await user.type(screen.getByPlaceholderText("Add member by email…"), email);
    await user.click(screen.getByRole("button", { name: "Add" }));
  }

  it("lists each address with its reason and leaves out the one that was invited", async () => {
    const user = userEvent.setup();
    mocks.createOrg.mockResolvedValue({ ...org, id: "org-2", name: "New Chambers" });
    mocks.createOrgInvitation.mockImplementation(async (_orgId: string, email: string) => {
      if (email === "ijs@firm.example") throw refusal(409, "invitation_already_member");
      if (email === "bad@firm.example") throw refusal(400, "invitation_email_invalid");
      if (email === "nomail@firm.example") return { email_sent: false };
      if (email === "down@firm.example") throw new Error("network down");
      return { email_sent: true };
    });
    const onCreated = vi.fn();
    render(<CreateOrganizationModal open onClose={vi.fn()} onCreated={onCreated} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });
    await user.type(screen.getByLabelText("Organization name"), "New Chambers");
    for (const email of [
      "ijs@firm.example",
      "valid@firm.example",
      "bad@firm.example",
      "nomail@firm.example",
      "down@firm.example",
    ]) {
      await addEmail(user, email);
    }
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Some invitations were not sent")).toBeInTheDocument();
    expect(
      screen.getByText("ijs@firm.example is already a member of this organization."),
    ).toBeInTheDocument();
    expect(screen.getByText("bad@firm.example is not a valid email address.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The invitation to nomail@firm.example was created, but the email could not be sent.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("down@firm.example could not be invited. Try again.")).toBeInTheDocument();
    // The address that was invited is not among the problems, and the
    // server's own words are never shown.
    expect(screen.queryByText(/valid@firm\.example (is|could)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw backend text/)).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("opens the organization at once when every invitation went out", async () => {
    const user = userEvent.setup();
    const created = { ...org, id: "org-2", name: "New Chambers" };
    mocks.createOrg.mockResolvedValue(created);
    const onCreated = vi.fn();
    render(<CreateOrganizationModal open onClose={vi.fn()} onCreated={onCreated} />);

    await waitFor(() => {
      expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true);
    });
    await user.type(screen.getByLabelText("Organization name"), "New Chambers");
    await addEmail(user, "valid@firm.example");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(screen.queryByText("Some invitations were not sent")).not.toBeInTheDocument();
  });
});

describe("InviteOrganizationMemberModal: a refused address", () => {
  it("says the person is already a member, not the server's text", async () => {
    mocks.createOrgInvitation.mockRejectedValue(
      new MikeApiError({
        message: "That person is already a member of this organization",
        status: 409,
        code: "invitation_already_member",
      }),
    );
    const user = userEvent.setup();
    render(
      <InviteOrganizationMemberModal
        open
        org={org}
        invitations={[]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await typeInvitation(user);

    expect(
      await screen.findByText("new@firm.example is already a member of this organization."),
    ).toBeInTheDocument();
  });
});
