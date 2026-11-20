import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MatterObligationRules,
  ObligationRule,
  RuleSuggestion,
  RuleSuggestionRun,
  RuleSuggestions as RuleSuggestionsData,
} from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ObligationRules } from "./ObligationRules";

const mocks = vi.hoisted(() => ({
  rules: vi.fn(),
  set: vi.fn(),
  list: vi.fn(),
  route: vi.fn(),
  run: vi.fn(),
  decide: vi.fn(),
  batch: vi.fn(),
  plan: vi.fn(),
  readBatch: vi.fn(),
  answer: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getMatterObligationRules: mocks.rules,
  setMatterObligationRule: mocks.set,
  getRuleSuggestions: mocks.list,
  getRuleSuggestionRoute: mocks.route,
  suggestObligationRules: mocks.run,
  decideRuleSuggestion: mocks.decide,
  decideRuleSuggestions: mocks.batch,
  planRuleRead: mocks.plan,
  readRuleBatch: mocks.readBatch,
  answerRuleQuestion: mocks.answer,
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: mocks.notifyError, errorCode: () => null }));

const ANNUAL = "radar.rules.catalog.lgsm_asamblea_ordinaria_anual";
const MARCA = "radar.rules.catalog.lfppi_marca_renovacion";
const rule = (over: Partial<ObligationRule> = {}): ObligationRule => ({
  key: "lgsm.asamblea_ordinaria_anual@1",
  code: "lgsm.asamblea_ordinaria_anual",
  version: 1,
  name_key: `${ANNUAL}.name`,
  applies_when_key: `${ANNUAL}.appliesWhen`,
  anchor_key: `${ANNUAL}.anchor`,
  first_cycle: null,
  kind: "deadline",
  milestones: [{ kind: "due", ops: [{ unit: "months", amount: 4 }] }],
  requires_business_days: false,
  citations: [],
  notes: null,
  consulted_on: "2026-11-17",
  verification: { status: "verified", verified_by: "socium-legal", verified_on: "2026-11-17" },
  active: false,
  anchor: null,
  changed_by: null,
  changed_at: null,
  ...over,
});
const marca = (over: Partial<ObligationRule> = {}) =>
  rule({
    key: "lfppi.marca_renovacion@1",
    code: "lfppi.marca_renovacion",
    name_key: `${MARCA}.name`,
    applies_when_key: `${MARCA}.appliesWhen`,
    anchor_key: `${MARCA}.anchor`,
    ...over,
  });
const catalog = (rules: ObligationRule[] = [rule(), marca()]): MatterObligationRules => ({
  retainer: true,
  can_write: true,
  rules,
  anchor_choices: [{ fact_id: "f1", label: "Cierre de ejercicio", date_on: "2026-12-31", date_kind: "effective" }],
  people: [],
});

const NAME = "Annual ordinary general shareholders' meeting";
const MARCA_NAME = "Renewal of a trademark registration (ordinary period)";
const suggestion = (over: Partial<RuleSuggestion> = {}): RuleSuggestion => ({
  id: "s1",
  matter_id: "m",
  rule_key: "lgsm.asamblea_ordinaria_anual@1",
  rule_code: "lgsm.asamblea_ordinaria_anual",
  rule_version: 1,
  quote: "se reunirán en asamblea general ordinaria una vez al año",
  reason: "El acta prevé una asamblea ordinaria anual.",
  page: null,
  evidence: "document",
  question_id: null,
  source: { document_id: "d1", version_id: "v1", version_number: 2, filename: "acta-constitutiva.pdf", start_char: 10, end_char: 70, text_sha256: "a".repeat(64) },
  status: "pending",
  stale_reason: null,
  effective_status: "pending",
  created_by: "u1",
  created_at: "2026-11-19T10:00:00Z",
  decided_by: null,
  decided_at: null,
  ...over,
});
const second = (over: Partial<RuleSuggestion> = {}) =>
  suggestion({ id: "s2", rule_key: "lfppi.marca_renovacion@1", rule_code: "lfppi.marca_renovacion", quote: "titular de la marca PATITO", reason: "Hay una marca registrada.", page: 3, ...over });
const accepted = (over: Partial<RuleSuggestion> = {}) => suggestion({ status: "accepted", effective_status: "accepted", ...over });
const list = (suggestions: RuleSuggestion[] = [], over: Partial<RuleSuggestionsData> = {}): RuleSuggestionsData => ({
  retainer: true,
  can_write: true,
  suggestions,
  versions: [{ document_id: "d1", version_id: "v1", version_number: 2, filename: "acta-constitutiva.pdf" }],
  questions: [],
  people: [],
  ...over,
});
const run = (over: Partial<RuleSuggestionRun> = {}): RuleSuggestionRun => ({
  suggested: 1,
  discarded_unknown_rule: 0,
  discarded_already_active: 0,
  discarded_quote_not_found: 0,
  discarded_duplicate: 0,
  discarded_invalid: 0,
  suggestion_ids: ["s1"],
  ...over,
});

const onChanged = vi.fn();
const view = () => render(<ObligationRules projectId="p" matterId="m" onChanged={onChanged} />);
const panel = async () => within(await screen.findByRole("region", { name: "AI rule suggestions" }));
/** The card of the rules list (the one with the turn-on form open). */
const openForm = async () => {
  const cards = await screen.findAllByRole("article", { name: NAME });
  return cards.find((article) => within(article).queryByLabelText("Date to count from"))!;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules.mockResolvedValue(catalog());
  mocks.set.mockResolvedValue(rule({ active: true }));
  mocks.list.mockResolvedValue(list());
  mocks.route.mockResolvedValue({ provider: "claude", model: "claude-sonnet-5-5" });
  mocks.run.mockResolvedValue(run());
  mocks.decide.mockImplementation(async (_p: string, _m: string, id: string, action: string) =>
    suggestion({ id, status: action === "accept" ? "accepted" : "discarded" }),
  );
  mocks.batch.mockResolvedValue({ results: [] });
  mocks.plan.mockResolvedValue({ max_chars: 120000, batches: [], skipped: [] });
});

describe("the button and its help line", () => {
  it("offers the button with the line that says where the text goes, before the click", async () => {
    view();
    const section = await panel();
    const button = await section.findByRole("button", { name: "Suggest rules with AI" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "The text of this version and the list of catalog rules will be sent to Anthropic (Claude) using the key the chat uses in this space. Suggestions are not exhaustive, and no rule is turned on until a lawyer reviews it.",
    );
    expect(section.getByText(/Accepting a suggestion does not turn any rule on/)).toBeInTheDocument();
    expect(section.getByText("There are no pending suggestions.")).toBeInTheDocument();
  });

  it("hides the button when there is no route for the person: no key, no model, no fallback", async () => {
    mocks.route.mockResolvedValue(null);
    view();
    const section = await panel();
    await section.findByText("There are no pending suggestions.");
    expect(section.queryByRole("button", { name: "Suggest rules with AI" })).not.toBeInTheDocument();
    expect(section.queryByText(/will be sent to/)).not.toBeInTheDocument();
  });

  it("hides the button when the route cannot be read", async () => {
    mocks.route.mockRejectedValue(new Error("down"));
    view();
    const section = await panel();
    await section.findByText("There are no pending suggestions.");
    expect(section.queryByRole("button", { name: "Suggest rules with AI" })).not.toBeInTheDocument();
  });

  it("gives a reader the list with no button and says who can decide", async () => {
    mocks.list.mockResolvedValue(list([suggestion()], { can_write: false, versions: [] }));
    view();
    const section = await panel();
    expect(await section.findByRole("article", { name: NAME })).toBeInTheDocument();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(section.queryByRole("button")).not.toBeInTheDocument();
    expect(section.getByText("Only the matter's owners and editors who are not in training can ask for and decide suggestions. You can read them.")).toBeInTheDocument();
  });

  it("speaks the legal line in Spanish, as socium-legal confirmed it", async () => {
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <ObligationRules projectId="p" matterId="m" onChanged={onChanged} />
      </IntlClientProvider>,
    );
    const section = within(await screen.findByRole("region", { name: "Sugerencias de reglas con IA" }));
    const button = await section.findByRole("button", { name: "Sugerir reglas con IA" });
    expect(button).toHaveAccessibleDescription(
      "Se enviará el texto de esta versión y la lista de reglas del catálogo a Anthropic (Claude), con la llave que usa el chat en este espacio. Las sugerencias no son exhaustivas y ninguna regla se enciende hasta que un abogado la revise.",
    );
  });
});

describe("asking for suggestions", () => {
  it("runs on the chosen version, says what it kept and discarded, and lists the suggestions with their passage", async () => {
    const user = userEvent.setup();
    mocks.run.mockResolvedValue(
      run({ suggested: 2, discarded_quote_not_found: 1, discarded_unknown_rule: 2, discarded_already_active: 1, discarded_invalid: 3, discarded_duplicate: 1 }),
    );
    view();
    const section = await panel();
    await user.selectOptions(await section.findByLabelText("Document and version"), "v1");
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    await user.click(section.getByRole("button", { name: "Suggest rules with AI" }));
    expect(mocks.run).toHaveBeenCalledWith("p", "m", "v1");
    expect(await section.findByText("The AI suggested 2 rules.")).toBeInTheDocument();
    expect(section.getByText("1 suggestion was discarded because its passage is not in the document.")).toBeInTheDocument();
    expect(section.getByText("2 suggestions were discarded because they are not verified rules of the catalog.")).toBeInTheDocument();
    expect(section.getByText("1 suggestion was discarded because the rule is already on in this matter.")).toBeInTheDocument();
    expect(section.getByText("3 suggestions were discarded because they did not fit the format.")).toBeInTheDocument();
    expect(section.getByText("1 suggestion was discarded because it already exists for this document.")).toBeInTheDocument();
    expect(section.getByText(/The list is not exhaustive/)).toBeInTheDocument();
    const card = await section.findByRole("article", { name: NAME });
    expect(card).toHaveTextContent("AI suggestion, not verified");
    expect(within(card).getByLabelText("Passage of the document")).toHaveTextContent("se reunirán en asamblea general ordinaria una vez al año");
    expect(card).toHaveTextContent("acta-constitutiva.pdf, version 2");
    expect(card).toHaveTextContent("The AI's explanation (not verified): El acta prevé una asamblea ordinaria anual.");
    expect(card).toHaveTextContent("To decide");
    expect(await section.findByRole("article", { name: MARCA_NAME })).toHaveTextContent("Page 3");
  });

  it("says plainly when the run suggested nothing", async () => {
    const user = userEvent.setup();
    mocks.run.mockResolvedValue(run({ suggested: 0, suggestion_ids: [] }));
    view();
    const section = await panel();
    await user.selectOptions(await section.findByLabelText("Document and version"), "v1");
    await user.click(section.getByRole("button", { name: "Suggest rules with AI" }));
    expect(await section.findByText("The AI suggested no new rules.")).toBeInTheDocument();
  });

  it("shows the run as busy and reports a failure without losing the list", async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    mocks.run.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    view();
    const section = await panel();
    await user.selectOptions(await section.findByLabelText("Document and version"), "v1");
    await user.click(section.getByRole("button", { name: "Suggest rules with AI" }));
    expect(section.getByRole("button", { name: "Reading the document…" })).toHaveAttribute("aria-busy", "true");
    fail(new Error("422"));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not suggest rules with AI." }));
    expect(section.getByRole("button", { name: "Suggest rules with AI" })).toBeEnabled();
  });

  it("reports a failed load in place", async () => {
    mocks.list.mockRejectedValue(new Error("down"));
    view();
    const section = await panel();
    expect(await section.findByRole("alert")).toHaveTextContent("Could not load the suggestions.");
    expect(mocks.notifyError).toHaveBeenCalled();
  });

  it("ignores a late failure after unmounting", async () => {
    let fail!: (error: Error) => void;
    mocks.list.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const { unmount } = view();
    await panel();
    unmount();
    fail(new Error("late"));
    await Promise.resolve();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("shows a loading skeleton while the list loads", async () => {
    mocks.list.mockReturnValue(new Promise(() => undefined));
    view();
    expect((await panel()).getByLabelText("Loading the suggestions")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps a very long passage and file name inside the card", async () => {
    const quote = "cláusula ".repeat(300).trim();
    mocks.list.mockResolvedValue(list([suggestion({ quote, source: { ...suggestion().source!, filename: `${"acta-".repeat(40)}.pdf` } })]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(within(card).getByLabelText("Passage of the document")).toHaveTextContent(quote);
    expect(within(card).getByLabelText("Passage of the document")).toHaveClass("break-words");
  });
});

describe("accepting does not turn the rule on", () => {
  it("opens the existing turn-on form with that rule chosen, and activates nothing until the lawyer picks the date", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion()]));
    view();
    const section = await panel();
    const card = await section.findByRole("article", { name: NAME });
    expect(within(card).getByText("Accepting opens the form to turn the rule on; you choose the date.")).toBeInTheDocument();
    mocks.list.mockResolvedValue(list([accepted()]));
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "m", "s1", "accept");
    const rulesCard = await openForm();
    expect(within(rulesCard).getByText("Suggested by the AI from a client document. Choose the confirmed date it counts from.")).toBeInTheDocument();
    await waitFor(() => expect(within(rulesCard).getByLabelText("Date to count from")).toHaveFocus());
    expect(within(rulesCard).getByRole("button", { name: "Turn on with this date" })).toBeDisabled();
    expect(mocks.set).not.toHaveBeenCalled();
    await user.selectOptions(within(rulesCard).getByLabelText("Date to count from"), "f1");
    await user.click(within(rulesCard).getByRole("button", { name: "Turn on with this date" }));
    expect(mocks.set).toHaveBeenCalledWith("p", "m", "lgsm.asamblea_ordinaria_anual@1", true, { anchor_fact_id: "f1", anchor_mode: "direct" });
  });

  it("opens the form even when the refresh after a saved acceptance fails, and says it was the refresh", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValueOnce(list([suggestion()]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    mocks.list.mockRejectedValue(new Error("offline"));
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(await openForm()).toBeDefined();
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not load the suggestions." });
    expect(mocks.notifyError).not.toHaveBeenCalledWith(expect.anything(), { action: "Could not decide the selected suggestions." });
  });

  it("keeps an accepted suggestion with the rule off, and lets the lawyer open the form again from it", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([accepted()]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(card).toHaveTextContent("Accepted. The rule stays off until you turn it on with a confirmed date.");
    expect(within(card).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Turn the rule on" }));
    expect(await openForm()).toBeDefined();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("says the rule is already on when it is, and offers no way to turn it on again", async () => {
    mocks.rules.mockResolvedValue(catalog([rule({ active: true, anchor: { fact_id: "f1", mode: "direct" } }), marca()]));
    mocks.list.mockResolvedValue(list([accepted()]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(card).toHaveTextContent("Accepted. The rule is already on.");
    expect(within(card).queryByRole("button", { name: "Turn the rule on" })).not.toBeInTheDocument();
  });

  it("offers no turn-on button for a rule that is no longer verified", async () => {
    mocks.rules.mockResolvedValue(catalog([rule({ verification: { status: "unverified", verified_by: null, verified_on: null } }), marca()]));
    mocks.list.mockResolvedValue(list([accepted()]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(within(card).queryByRole("button", { name: "Turn the rule on" })).not.toBeInTheDocument();
  });

  it("names a suggestion by its code when the catalog no longer has the rule", async () => {
    mocks.list.mockResolvedValue(list([suggestion({ rule_key: "gone.rule@1", rule_code: "gone.rule" })]));
    view();
    expect(await (await panel()).findByRole("article", { name: "gone.rule" })).toBeInTheDocument();
  });

  it("reports a failed decision and reads the list again", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion()]));
    mocks.decide.mockRejectedValue(new Error("409"));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not decide the selected suggestions." }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("reports it when even the second read fails", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValueOnce(list([suggestion()])).mockRejectedValue(new Error("down"));
    mocks.decide.mockRejectedValue(new Error("409"));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not load the suggestions." }));
  });
});

describe("discarding", () => {
  it("discards with an optional reason, asking for it first", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion()]));
    view();
    const section = await panel();
    const card = await section.findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Discard" }));
    expect(mocks.decide).not.toHaveBeenCalled();
    await user.type(within(card).getByLabelText("Reason (optional)"), "No aplica al cliente");
    mocks.list.mockResolvedValue(list([suggestion({ status: "discarded", effective_status: "discarded" })]));
    await user.click(within(card).getByRole("button", { name: "Discard the suggestion" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "m", "s1", "discard", { reason: "No aplica al cliente" });
    expect(await section.findByText("There are no pending suggestions.")).toBeInTheDocument();
  });

  it("discards with no reason and lets the lawyer cancel", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion()]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Discard" }));
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByLabelText("Reason (optional)")).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Discard" }));
    await user.click(within(card).getByRole("button", { name: "Discard the suggestion" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "m", "s1", "discard", {});
  });

  it("marks an out-of-date suggestion, offers no accept, and still lets it be discarded", async () => {
    mocks.list.mockResolvedValue(
      list([
        suggestion({ stale_reason: "text_changed", effective_status: "obsolete" }),
        second({ stale_reason: "rule_unverified", effective_status: "obsolete", status: "accepted" }),
      ]),
    );
    view();
    const section = await panel();
    const card = await section.findByRole("article", { name: NAME });
    expect(card).toHaveTextContent("Out of date: the text of the document changed");
    expect(within(card).queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(within(card).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(await section.findByRole("article", { name: MARCA_NAME })).toHaveTextContent("the rule is no longer verified");
  });
});

describe("batch review", () => {
  it("accepts several at once: each one decided, the result announced, and no rule turned on", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    mocks.batch.mockResolvedValue({ results: [{ suggestion_id: "s1", outcome: "ok" }, { suggestion_id: "s2", outcome: "conflict" }] });
    view();
    const section = await panel();
    const group = await section.findByRole("group", { name: "Batch review of the suggestions" });
    expect(within(group).getByText("None selected")).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Accept selected" })).toBeDisabled();
    await user.click(within(group).getByRole("checkbox", { name: "Select all" }));
    expect(within(group).getByText("2 selected")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Accept selected" }));
    expect(mocks.batch).toHaveBeenCalledWith("p", "m", { action: "accept", suggestionIds: ["s1", "s2"] });
    expect(await section.findByText(/1 suggestion accepted\. No rule was turned on: turn them on from their card\./)).toBeInTheDocument();
    expect(section.getByText(/1 suggestion could not be decided/)).toBeInTheDocument();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Date to count from")).not.toBeInTheDocument();
  });

  it("selects one by one by the rule's own name, and discards the selected with one reason", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    mocks.batch.mockResolvedValue({ results: [{ suggestion_id: "s2", outcome: "ok" }] });
    view();
    const section = await panel();
    await user.click(await section.findByRole("checkbox", { name: `Select “${MARCA_NAME}”` }));
    const group = section.getByRole("group", { name: "Batch review of the suggestions" });
    expect(within(group).getByText("1 selected")).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: "Discard selected" }));
    await user.type(within(group).getByLabelText("Reason for all (optional)"), "No aplica");
    await user.click(within(group).getByRole("button", { name: "Discard the selected suggestion" }));
    expect(mocks.batch).toHaveBeenCalledWith("p", "m", { action: "discard", suggestionIds: ["s2"], reason: "No aplica" });
    expect(await section.findByText("1 suggestion discarded.")).toBeInTheDocument();
  });

  it("lets the lawyer unselect everything and cancel the discard", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    view();
    const group = await (await panel()).findByRole("group", { name: "Batch review of the suggestions" });
    const all = within(group).getByRole("checkbox", { name: "Select all" });
    await user.click(all);
    await user.click(all);
    expect(within(group).getByText("None selected")).toBeInTheDocument();
    await user.click(all);
    await user.click(within(group).getByRole("button", { name: "Discard selected" }));
    await user.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(within(group).queryByLabelText("Reason for all (optional)")).not.toBeInTheDocument();
    expect(mocks.batch).not.toHaveBeenCalled();
  });

  it("unselects one suggestion", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    view();
    const section = await panel();
    const one = await section.findByRole("checkbox", { name: `Select “${MARCA_NAME}”` });
    await user.click(one);
    await user.click(one);
    expect(within(section.getByRole("group", { name: "Batch review of the suggestions" })).getByText("None selected")).toBeInTheDocument();
  });

  it("reports a failed batch and reads the list again", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValue(list([suggestion(), second()]));
    mocks.batch.mockRejectedValue(new Error("down"));
    view();
    const section = await panel();
    await user.click(await section.findByRole("checkbox", { name: "Select all" }));
    await user.click(section.getByRole("button", { name: "Accept selected" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not decide the selected suggestions." }));
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("shows no batch bar for a single suggestion, and readers see no checkboxes", async () => {
    mocks.list.mockResolvedValue(list([suggestion()]));
    const first = view();
    const section = await panel();
    await section.findByRole("article", { name: NAME });
    expect(section.queryByRole("group", { name: "Batch review of the suggestions" })).not.toBeInTheDocument();
    first.unmount();
    mocks.list.mockResolvedValue(list([suggestion(), second()], { can_write: false, versions: [] }));
    view();
    const readers = await panel();
    await readers.findByRole("article", { name: NAME });
    expect(readers.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
