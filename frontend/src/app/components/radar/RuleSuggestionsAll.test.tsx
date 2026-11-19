import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MatterObligationRules,
  ObligationRule,
  RuleQuestion,
  RuleReadBatchResult,
  RuleReadDocument,
  RuleReadPlan,
  RuleReadSkipped,
  RuleSuggestion,
  RuleSuggestions as RuleSuggestionsData,
} from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
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
const question = (over: Partial<RuleQuestion> = {}): RuleQuestion => ({
  id: "q1",
  matter_id: "m",
  rule_key: "lfppi.marca_renovacion@1",
  rule_code: "lfppi.marca_renovacion",
  rule_version: 1,
  applies_when: "El cliente es titular de una marca registrada.",
  created_at: "2026-11-19T10:00:00Z",
  ...over,
});
const doc = (n: number, chars = 1000, over: Partial<RuleReadDocument> = {}): RuleReadDocument => ({
  version_id: `v${n}`,
  document_id: `d${n}`,
  version_number: 1,
  filename: `doc-${n}.pdf`,
  chars,
  ...over,
});
const planOf = (batches: RuleReadDocument[][], skipped: RuleReadSkipped[] = []): RuleReadPlan => ({
  max_chars: 120000,
  batches: batches.map((documents) => ({ chars: documents.reduce((sum, one) => sum + one.chars, 0), documents })),
  skipped,
});
const readResult = (over: Partial<RuleReadBatchResult> = {}): RuleReadBatchResult => ({
  suggested: 1,
  discarded_unknown_rule: 0,
  discarded_already_active: 0,
  discarded_quote_not_found: 0,
  discarded_duplicate: 0,
  discarded_invalid: 0,
  suggestion_ids: ["s1"],
  questions_asked: 0,
  discarded_question_invalid: 0,
  superseded: 0,
  ...over,
});
const list = (suggestions: RuleSuggestion[] = [], over: Partial<RuleSuggestionsData> = {}): RuleSuggestionsData => ({
  retainer: true,
  can_write: true,
  suggestions,
  versions: [],
  questions: [],
  people: [{ user_id: "u1", name: "Elena Editora" }],
  ...over,
});

const onChanged = vi.fn();
const view = () => render(<ObligationRules projectId="p" matterId="m" onChanged={onChanged} />);
const panel = async () => within(await screen.findByRole("region", { name: "AI rule suggestions" }));
const readAll = async () => within(await (await panel()).findByRole("region", { name: /Read all the client's documents/ }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules.mockResolvedValue(catalog());
  mocks.list.mockResolvedValue(list());
  mocks.route.mockResolvedValue({ provider: "claude", model: "claude-sonnet-5-5" });
  mocks.plan.mockResolvedValue(planOf([[doc(1), doc(2)]]));
  mocks.readBatch.mockResolvedValue(readResult());
  mocks.answer.mockResolvedValue({ question_id: "q1", answer: "no", suggestion: null });
  mocks.decide.mockResolvedValue(suggestion({ status: "accepted" }));
});

describe("read all the documents", () => {
  it("lists the documents pre-checked, and says before the click how many documents and calls (C13)", async () => {
    view();
    const section = await readAll();
    expect(await section.findByRole("heading", { name: "Read all the client's documents (2)" })).toBeInTheDocument();
    for (const name of ["doc-1.pdf", "doc-2.pdf"]) expect(section.getByRole("checkbox", { name: `Read “${name}”` })).toBeChecked();
    const button = section.getByRole("button", { name: "Read all documents" });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAccessibleDescription(
      "The text of 2 documents in this matter will be sent to Anthropic (Claude) in 1 call, using the key the chat uses in this space. Suggestions are not exhaustive, and no rule is turned on until a lawyer reviews it.",
    );
    // Nothing is sent by looking at the panel: the plan is not a read.
    expect(mocks.readBatch).not.toHaveBeenCalled();
    expect(mocks.plan).toHaveBeenCalledWith("p", "m");
  });

  it("uses the exact es-MX text of legal with the counts of the server's plan", async () => {
    const text = (esMX as unknown as { radar: { rules: { suggest: { all: { helper: string } } } } }).radar.rules.suggest.all.helper;
    expect(text).toContain("Se enviará el texto de {n, plural, one {# documento} other {# documentos}} de este asunto a {provider}, en {k, plural, one {# llamada} other {# llamadas}}, con la llave que usa el chat en este espacio. Las sugerencias no son exhaustivas y ninguna regla se enciende hasta que un abogado la revise.");
  });

  it("asks the server again with the lawyer's selection, and never forces a choice", async () => {
    mocks.plan.mockImplementation(async (_p: string, _m: string, ids?: string[]) => (ids ? planOf([ids.map((id) => doc(Number(id.slice(1))))]) : planOf([[doc(1), doc(2), doc(3)]])));
    const user = userEvent.setup();
    view();
    const section = await readAll();
    await section.findByRole("checkbox", { name: "Read “doc-3.pdf”" });
    await user.click(section.getByRole("checkbox", { name: "Read “doc-3.pdf”" }));
    await waitFor(() => expect(mocks.plan).toHaveBeenLastCalledWith("p", "m", ["v1", "v2"]));
    await waitFor(() => expect(section.getByRole("button", { name: "Read all documents" })).toHaveAccessibleDescription(/text of 2 documents/));
    for (const name of ["doc-1.pdf", "doc-2.pdf"]) await user.click(section.getByRole("checkbox", { name: `Read “${name}”` }));
    expect(await section.findByText("Choose at least one document to read.")).toBeInTheDocument();
    expect(section.getByRole("button", { name: "Read all documents" })).toBeDisabled();
  });

  it("runs the calls one after the other with progress, then lists what was not reviewed", async () => {
    mocks.plan.mockResolvedValue(
      planOf([[doc(1)], [doc(2)]], [
        { version_id: "v9", version_number: 1, filename: "enorme.pdf", reason: "too_long" },
        { version_id: "v8", version_number: 1, filename: "escaneo.pdf", reason: "no_text" },
      ]),
    );
    let release: (value: RuleReadBatchResult) => void = () => {};
    mocks.readBatch.mockImplementationOnce(async () => readResult({ suggested: 2, questions_asked: 1, discarded_invalid: 1 }));
    mocks.readBatch.mockImplementationOnce(() => new Promise<RuleReadBatchResult>((resolve) => (release = resolve)));
    const user = userEvent.setup();
    view();
    const section = await readAll();
    expect(await section.findByText(/in 2 calls/i, { selector: "p" })).toBeInTheDocument();
    expect(section.getByText("enorme.pdf · too long")).toBeInTheDocument();
    await waitFor(() => expect(section.getByRole("button", { name: "Read all documents" })).toBeEnabled());
    await user.click(section.getByRole("button", { name: "Read all documents" }));
    expect(await section.findByRole("status")).toHaveTextContent("Call 2 of 2");
    expect(section.getByRole("button", { name: "Reading…" })).toBeDisabled();
    release(readResult({ suggested: 1, superseded: 1, questions_asked: 1 }));
    expect(await section.findByText("I reviewed 2 of 4 documents.")).toBeInTheDocument();
    expect(section.getByText("Not reviewed: enorme.pdf (too long); escaneo.pdf (no text ready).")).toBeInTheDocument();
    expect(section.getByText("The AI suggested 3 rules.")).toBeInTheDocument();
    expect(section.getByText("The AI left 2 questions for you.")).toBeInTheDocument();
    expect(section.getByText("1 suggestion was replaced by a better citation of the same rule.")).toBeInTheDocument();
    expect(section.getByText("1 suggestion was discarded for not passing the code's checks.")).toBeInTheDocument();
    // One run id for every call; the documents of each call exactly as planned.
    const [first, second] = mocks.readBatch.mock.calls as [string, string, { runId: string; versionIds: string[] }][];
    expect(first[2].versionIds).toEqual(["v1"]);
    expect(second[2].versionIds).toEqual(["v2"]);
    expect(first[2].runId).toBe(second[2].runId);
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("stops at a failed call, says where, and keeps what was saved", async () => {
    mocks.plan.mockResolvedValue(planOf([[doc(1)], [doc(2)]]));
    mocks.readBatch.mockResolvedValueOnce(readResult());
    mocks.readBatch.mockRejectedValueOnce(new Error("down"));
    const user = userEvent.setup();
    view();
    const section = await readAll();
    await waitFor(() => expect(section.getByRole("button", { name: "Read all documents" })).toBeEnabled());
    await user.click(section.getByRole("button", { name: "Read all documents" }));
    expect(await section.findByText("The reading stopped at call 2 of 2. What was already saved stays in the list.")).toBeInTheDocument();
    expect(section.getByText("I reviewed 1 of 2 documents.")).toBeInTheDocument();
    expect(section.getByText("Not reviewed: doc-2.pdf.")).toBeInTheDocument();
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not read all the documents." });
    expect(mocks.readBatch).toHaveBeenCalledTimes(2);
  });

  it("shows the empty state, and the failed state of the plan", async () => {
    mocks.plan.mockResolvedValue(planOf([]));
    const first = view();
    expect(await (await readAll()).findByText("This matter has no current documents with text ready to read.")).toBeInTheDocument();
    first.unmount();
    mocks.plan.mockRejectedValue(new Error("down"));
    view();
    expect(await (await readAll()).findByRole("alert")).toHaveTextContent("Could not prepare the reading of the documents.");
    expect(mocks.notifyError).toHaveBeenCalled();
  });

  it("offers it to nobody who cannot write, and without a route", async () => {
    mocks.list.mockResolvedValue(list([], { can_write: false }));
    const first = view();
    await (await panel()).findByText(/Only the matter's owners and editors/);
    expect(screen.queryByRole("region", { name: /Read all the client's documents/ })).not.toBeInTheDocument();
    expect(mocks.plan).not.toHaveBeenCalled();
    first.unmount();
    mocks.list.mockResolvedValue(list());
    mocks.route.mockResolvedValue(null);
    view();
    await (await panel()).findByText("There are no pending suggestions.");
    expect(screen.queryByRole("region", { name: /Read all the client's documents/ })).not.toBeInTheDocument();
  });
});

describe("the questions (C14)", () => {
  const withQuestion = () => mocks.list.mockResolvedValue(list([], { questions: [question()] }));

  it("builds the sentence from the catalog's own words and names the rule", async () => {
    withQuestion();
    view();
    const section = await panel();
    expect(await section.findByRole("heading", { name: "Questions for you" })).toBeInTheDocument();
    expect(section.getByText("Rule: Renewal of a trademark registration (ordinary period)")).toBeInTheDocument();
    const article = section.getByRole("article", { name: /Is the following true for this client\?/ });
    expect(within(article).getByRole("group", { name: "Answer to the question about “Renewal of a trademark registration (ordinary period)”" })).toBeInTheDocument();
    expect(within(article).getByRole("button", { name: "Yes" })).toBeInTheDocument();
    expect(within(article).getByRole("button", { name: "No" })).toBeInTheDocument();
    expect(section.getByText(/Your answer is not sent to any AI/)).toBeInTheDocument();
  });

  it("'yes' sends the answer to LiTT only and refreshes: the suggestion appears", async () => {
    withQuestion();
    mocks.answer.mockResolvedValue({ question_id: "q1", answer: "yes", suggestion: suggestion({ id: "s7" }) });
    const user = userEvent.setup();
    view();
    const section = await panel();
    await user.click(await section.findByRole("button", { name: "Yes" }));
    expect(mocks.answer).toHaveBeenCalledWith("p", "m", "q1", "yes");
    expect(await section.findByText("Answer saved: a suggestion was created for you to review.")).toBeInTheDocument();
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.readBatch).not.toHaveBeenCalled();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });

  it("'no' is recorded and never shown as the rule not applying", async () => {
    withQuestion();
    const user = userEvent.setup();
    view();
    const section = await panel();
    await user.click(await section.findByRole("button", { name: "No" }));
    const note = await section.findByText(/Answer saved\. No rule is turned on/);
    expect(note).toHaveTextContent("this does not mean the rule does not apply");
    expect(screen.queryByText(/^(The )?rule does not apply/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not applicable/i)).not.toBeInTheDocument();
    expect(mocks.answer).toHaveBeenCalledWith("p", "m", "q1", "no");
  });

  it("reports a failed answer and keeps the question", async () => {
    withQuestion();
    mocks.answer.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    view();
    const section = await panel();
    await user.click(await section.findByRole("button", { name: "Yes" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "Could not save the answer." }));
    expect(section.getByRole("button", { name: "Yes" })).toBeEnabled();
  });

  it("shows no questions to someone who cannot write, and none when there are none", async () => {
    mocks.list.mockResolvedValue(list([], { can_write: false, questions: [question()] }));
    const first = view();
    await (await panel()).findByText(/Only the matter's owners and editors/);
    expect(screen.queryByRole("heading", { name: "Questions for you" })).not.toBeInTheDocument();
    first.unmount();
    mocks.list.mockResolvedValue(list());
    view();
    await (await panel()).findByText("There are no pending suggestions.");
    expect(screen.queryByRole("heading", { name: "Questions for you" })).not.toBeInTheDocument();
  });
});

describe("a suggestion that rests on the lawyer's answer", () => {
  const fromAnswer = suggestion({ evidence: "lawyer_answer", quote: null, source: null, reason: null, question_id: "q1" });

  it("says 'according to the answer of {name}', cites no document and is not labelled as the AI's", async () => {
    mocks.list.mockResolvedValue(list([fromAnswer]));
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(within(card).getByText("According to the answer of Elena Editora. It cites no document.")).toBeInTheDocument();
    expect(within(card).queryByText("AI suggestion, not verified")).not.toBeInTheDocument();
    expect(within(card).queryByLabelText("Passage of the document")).not.toBeInTheDocument();
    expect(within(card).queryByText(/explanation/)).not.toBeInTheDocument();
  });

  it("falls back to 'a lawyer' when the person cannot be named, and still opens the turn-on form on accept", async () => {
    mocks.list.mockResolvedValue(list([fromAnswer], { people: [] }));
    const user = userEvent.setup();
    view();
    const card = await (await panel()).findByRole("article", { name: NAME });
    expect(within(card).getByText("According to the answer of a lawyer. It cites no document.")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Accept" }));
    expect(mocks.decide).toHaveBeenCalledWith("p", "m", "s1", "accept");
    expect(await screen.findByLabelText("Date to count from")).toBeInTheDocument();
  });
});
