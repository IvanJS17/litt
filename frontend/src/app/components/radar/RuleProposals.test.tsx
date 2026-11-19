import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuleProposal, RuleProposalRun, RuleProposals as RuleProposalsData } from "@mike/contracts";
import { RuleProposals } from "./RuleProposals";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  route: vi.fn(),
  run: vi.fn(),
  decide: vi.fn(),
  download: vi.fn(),
  downloadBlob: vi.fn(),
  notifyError: vi.fn(),
  code: vi.fn(() => null as string | null),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getRuleProposals: mocks.list,
  getRuleProposalRoute: mocks.route,
  proposeObligationRules: mocks.run,
  decideRuleProposal: mocks.decide,
  downloadRuleProposals: mocks.download,
}));
vi.mock("@/app/lib/downloadDocument", () => ({ downloadBlob: mocks.downloadBlob }));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError, errorCode: () => mocks.code() }));

const LEGEND = "Unverified draft. It cannot be used until legal verifies it and it is added to the catalog.";
const proposal = (over: Partial<RuleProposal> = {}): RuleProposal => ({
  id: "a1",
  project_id: "p",
  law: "Ley General de Sociedades Mercantiles",
  article: "Art. 181",
  obligation: "Celebrar la asamblea general ordinaria anual.",
  anchor_name: "Cierre del ejercicio social",
  plazo_propuesto: "+4 meses",
  quote: "se reunirá por lo menos una vez al año",
  page: null,
  source: { document_id: "d1", version_id: "v1", version_number: 2, filename: "LGSM.docx", start_char: 1, end_char: 40, text_sha256: "a".repeat(64) },
  ai_provider: "claude",
  ai_model: "claude-sonnet-5-5",
  status: "pending",
  stale_reason: null,
  effective_status: "pending",
  catalog_code: null,
  created_by: "u1",
  created_at: "2026-11-19T10:00:00Z",
  decided_by: null,
  decided_at: null,
  ...over,
});
const list = (proposals: RuleProposal[] = [], over: Partial<RuleProposalsData> = {}): RuleProposalsData => ({
  can_write: true,
  proposals,
  versions: [{ document_id: "d1", version_id: "v1", version_number: 2, filename: "LGSM.docx" }],
  people: [],
  ...over,
});
const run = (over: Partial<RuleProposalRun> = {}): RuleProposalRun => ({
  proposed: 1,
  discarded_quote_not_found: 0,
  discarded_duplicate: 0,
  discarded_invalid: 0,
  discarded_term_has_date: 0,
  proposal_ids: ["a1"],
  ...over,
});
const view = () => render(<RuleProposals projectId="p" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.code.mockReturnValue(null);
  mocks.list.mockResolvedValue(list());
  mocks.route.mockResolvedValue({ provider: "claude", model: "claude-sonnet-5-5" });
  mocks.run.mockResolvedValue(run());
  mocks.decide.mockImplementation(async (_p: string, id: string, action: string) =>
    proposal({ id, status: action === "send-to-legal" ? "sent_to_legal" : "discarded" }),
  );
  mocks.download.mockResolvedValue({ blob: new Blob(["x"]), filename: "propuestas-reglas-leyes-20261119.md" });
});

describe("the button and its help line", () => {
  it("offers the button with the exact help line that says where the text goes, before the click", async () => {
    view();
    const button = await screen.findByRole("button", { name: "Propose new rules" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "The text of this version and the list of catalog codes will be sent to Anthropic (Claude) using the key the chat uses in this space. Upload only legal text, preferably the official version, with no client data. Proposals are unverified drafts.",
    );
    expect(screen.getByText(/longer than 120,000 characters/)).toBeInTheDocument();
    expect(screen.getByText("There are no proposals in this project yet.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Propose new rules" })).toBeInTheDocument();
  });

  it("hides the button with no route and explains why; a reader gets the list and no button", async () => {
    mocks.route.mockResolvedValue(null);
    view();
    await screen.findByText(/needs an AI model and key/);
    expect(screen.queryByRole("button", { name: "Propose new rules" })).not.toBeInTheDocument();
    mocks.list.mockResolvedValue(list([proposal()], { can_write: false, versions: [] }));
    view();
    await screen.findAllByText(/Only an owner or editor of the project who is not in training can propose/);
    expect(mocks.route).toHaveBeenCalledTimes(1);
  });

  it("runs on the chosen version, shows what it did and what it rejected", async () => {
    const user = userEvent.setup();
    mocks.run.mockResolvedValue(run({ proposed: 2, discarded_quote_not_found: 1, discarded_duplicate: 2, discarded_invalid: 1, discarded_term_has_date: 1 }));
    view();
    await user.selectOptions(await screen.findByLabelText("Document and version"), "v1");
    await user.click(screen.getByRole("button", { name: "Propose new rules" }));
    expect(mocks.run).toHaveBeenCalledWith("p", "v1");
    expect(await screen.findByText("The AI proposed 2 new rules.")).toBeInTheDocument();
    expect(screen.getByText("1 proposal was rejected because its quote is not in the text.")).toBeInTheDocument();
    expect(screen.getByText("2 proposals were rejected because they already exist for this text.")).toBeInTheDocument();
    expect(screen.getByText("1 proposal was rejected for not following the format.")).toBeInTheDocument();
    expect(screen.getByText("The term was removed from 1 proposal because it wrote a calendar date.")).toBeInTheDocument();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("says nothing was proposed, and reports a failed run without a result", async () => {
    const user = userEvent.setup();
    mocks.run.mockResolvedValueOnce(run({ proposed: 0, proposal_ids: [] }));
    view();
    await user.selectOptions(await screen.findByLabelText("Document and version"), "v1");
    await user.click(screen.getByRole("button", { name: "Propose new rules" }));
    expect(await screen.findByText("The AI did not propose new rules.")).toBeInTheDocument();
    mocks.run.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByRole("button", { name: "Propose new rules" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Rules could not be proposed with AI." }));
    expect(screen.queryByText("The AI did not propose new rules.")).not.toBeInTheDocument();
  });

  it("shows a load failure and a loading state", async () => {
    mocks.list.mockRejectedValue(new Error("down"));
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("The proposals could not be loaded.");
    expect(mocks.notifyError).toHaveBeenCalled();
  });
});

describe("a draft", () => {
  it("shows the quote, law, article, term with its fixed legends, and no way to turn it on", async () => {
    mocks.list.mockResolvedValue(list([proposal({ page: 7 })]));
    view();
    const card = within(await screen.findByRole("article", { name: "Celebrar la asamblea general ordinaria anual." }));
    expect(card.getByText("Ley General de Sociedades Mercantiles · Art. 181")).toBeInTheDocument();
    expect(card.getByLabelText("Literal quote from the uploaded text")).toHaveTextContent("se reunirá por lo menos una vez al año");
    expect(card.getByText(/LGSM.docx, version 2/)).toBeInTheDocument();
    expect(card.getByText(/Page 7/)).toBeInTheDocument();
    expect(card.getByText("+4 meses")).toBeInTheDocument();
    expect(card.getByText("Term proposed by the AI, unverified; legal sets the final term.")).toBeInTheDocument();
    expect(card.getByText(LEGEND)).toBeInTheDocument();
    expect(card.getByText("Draft waiting for review.")).toBeInTheDocument();
    expect(card.queryByRole("button", { name: /turn on|activate|enable/i })).not.toBeInTheDocument();
  });

  it("writes that the AI gave no term, without the term legend", async () => {
    mocks.list.mockResolvedValue(list([proposal({ plazo_propuesto: null })]));
    view();
    const card = within(await screen.findByRole("article"));
    expect(card.getByText("The AI did not propose a term.")).toBeInTheDocument();
    expect(card.queryByText(/Term proposed by the AI/)).not.toBeInTheDocument();
  });

  it("sends to legal: records the event, downloads the file for the person and says so", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([proposal()]));
    view();
    await user.click(await screen.findByRole("button", { name: "Send to legal" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "a1", "send-to-legal", {});
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "propuestas-reglas-leyes-20261119.md"));
    expect(await screen.findByText("Sent to legal. The file was downloaded to your device.")).toBeInTheDocument();
    expect(screen.getAllByText(/LiTT receives nothing/).length).toBeGreaterThan(0);
  });

  it("downloads the file with a plain name when the server gives none, and reports a failed download", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([proposal({ status: "sent_to_legal", effective_status: "sent_to_legal" })]));
    mocks.download.mockResolvedValueOnce({ blob: new Blob(["x"]), filename: null });
    view();
    await user.click(await screen.findByRole("button", { name: "Download file for legal" }));
    await waitFor(() => expect(mocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "propuestas-reglas.md"));
    mocks.download.mockRejectedValueOnce(new Error("down"));
    await user.click(screen.getByRole("button", { name: "Download file for legal" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The file for legal could not be prepared." }));
  });

  it("discards with an optional reason, and can cancel", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([proposal()]));
    view();
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Reason (optional)")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard" }));
    await user.type(screen.getByLabelText("Reason (optional)"), "No aplica");
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "a1", "discard", { reason: "No aplica" });
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));
    expect(mocks.decide).toHaveBeenLastCalledWith("p", "a1", "discard", {});
  });

  it("records implemented only for a sent draft, with the code, and explains a refused code", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([proposal({ status: "sent_to_legal", effective_status: "sent_to_legal" })]));
    view();
    expect(await screen.findByText("Sent to legal.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to legal" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Record as implemented" }));
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    await user.type(screen.getByLabelText("Catalog code of the rule"), "lgsm.nueva");
    mocks.code.mockReturnValue("proposal_unknown_catalog_code");
    mocks.decide.mockRejectedValueOnce(new Error("422"));
    await user.click(save);
    expect(mocks.decide).toHaveBeenCalledWith("p", "a1", "implemented", { catalog_code: "lgsm.nueva" });
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "It could not be recorded: the code must be a verified rule of the catalog." }),
    );
  });

  it("shows an implemented draft with its code and no actions, and hides discarded ones", async () => {
    mocks.list.mockResolvedValue(
      list([
        proposal({ id: "a1", status: "implemented", effective_status: "implemented", catalog_code: "lgsm.nueva" }),
        proposal({ id: "a2", status: "discarded", effective_status: "discarded", obligation: "Otra obligación descartada." }),
      ]),
    );
    view();
    expect(await screen.findByText("Implemented in the catalog with the code lgsm.nueva.")).toBeInTheDocument();
    expect(screen.queryByText("Otra obligación descartada.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard" })).not.toBeInTheDocument();
  });

  it("marks an out-of-date draft, and offers no send for it", async () => {
    mocks.list.mockResolvedValue(list([proposal({ stale_reason: "text_changed", effective_status: "obsolete" })]));
    view();
    expect(await screen.findByText("Out of date: the text of that version changed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send to legal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("gives a reader no actions", async () => {
    mocks.list.mockResolvedValue(list([proposal()], { can_write: false, versions: [] }));
    view();
    await screen.findByRole("article");
    for (const name of ["Send to legal", "Discard", "Record as implemented"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download file for legal" })).toBeInTheDocument();
  });

  it("reloads and reports a decision that failed", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([proposal()]));
    mocks.decide.mockRejectedValueOnce(new Error("409"));
    view();
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await user.click(screen.getByRole("button", { name: "Confirm discard" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The decision could not be recorded." }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("holds a long law, article and quote inside the card", async () => {
    mocks.list.mockResolvedValue(list([proposal({ law: "L".repeat(180), quote: "q".repeat(500), obligation: "O".repeat(300) })]));
    view();
    const card = await screen.findByRole("article");
    expect(within(card).getByLabelText("Literal quote from the uploaded text")).toHaveClass("break-words");
  });
});
