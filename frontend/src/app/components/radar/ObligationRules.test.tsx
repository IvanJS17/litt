import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MatterObligationRules, ObligationRule } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ObligationRules } from "./ObligationRules";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), notifyError: vi.fn(), suggestions: vi.fn() }));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getMatterObligationRules: mocks.get,
  setMatterObligationRule: mocks.set,
  getRuleSuggestions: mocks.suggestions,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: () => null,
}));

const ANNUAL = "radar.rules.catalog.lgsm_asamblea_ordinaria_anual";
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
  citations: [
    { source_code: "LGSM", law: "Ley General de Sociedades Mercantiles", location: "Art. 181, párrafo primero", text: "La Asamblea Ordinaria se reunirá por lo menos una vez al año.", url: "https://www.diputados.gob.mx/LeyesBiblio/pdf/LGSM.pdf", last_reform: "DOF 20-10-2023" },
  ],
  notes: "Los estatutos pueden acortar el plazo.",
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
    name_key: "radar.rules.catalog.lfppi_marca_renovacion.name",
    applies_when_key: "radar.rules.catalog.lfppi_marca_renovacion.appliesWhen",
    anchor_key: "radar.rules.catalog.lfppi_marca_renovacion.anchor",
    kind: "window",
    milestones: [{ kind: "opens", ops: [{ unit: "months", amount: -6 }] }, { kind: "closes", ops: [] }],
    first_cycle: { from: "fecha_otorgamiento_registro", ops: [{ unit: "years", amount: 10 }], only_if: "otorgado desde 2018-08-10", cap_years: 25 },
    notes: null,
    ...over,
  });
const unverified = (over: Partial<ObligationRule> = {}) =>
  rule({ key: "x.draft@1", code: "x.draft", name_key: "no.such.key", applies_when_key: "no.such.when", anchor_key: "no.such.anchor", verification: { status: "unverified", verified_by: null, verified_on: null }, ...over });
const choices = [
  { fact_id: "f1", label: "Cierre de ejercicio", date_on: "2026-12-31", date_kind: "effective" as const },
  { fact_id: "f2", label: "Registro de marca", date_on: "2019-08-15", date_kind: null },
];
const rules = (over: Partial<MatterObligationRules> = {}): MatterObligationRules => ({
  retainer: true,
  can_write: true,
  rules: [rule(), unverified()],
  anchor_choices: choices,
  people: [],
  ...over,
});

const onChanged = vi.fn();
const view = () => render(<ObligationRules projectId="p" matterId="m" onChanged={onChanged} />);
const NAME = "Annual ordinary general shareholders' meeting";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(rules());
  mocks.set.mockResolvedValue(rule({ active: true }));
  // The suggestions panel has its own suite; here it reads an empty list.
  mocks.suggestions.mockResolvedValue({ retainer: true, can_write: false, suggestions: [], versions: [], people: [] });
});

describe("ObligationRules", () => {
  it("lists each rule with how it counts, its quote, source, notes and verification", async () => {
    view();
    expect(screen.getByLabelText("Loading the rules")).toHaveAttribute("aria-busy", "true");
    const card = await screen.findByRole("article", { name: NAME });
    expect(card).toHaveTextContent("Deadline · Off");
    expect(card).toHaveTextContent("Corporation (sociedad anónima), including S.A. de C.V.");
    expect(card).toHaveTextContent("Closing date of the fiscal year of the company");
    expect(card).toHaveTextContent("Due: 4 calendar months after");
    expect(card).toHaveTextContent("Source: Ley General de Sociedades Mercantiles, Art. 181, párrafo primero");
    expect(card).toHaveTextContent("Last reform: DOF 20-10-2023");
    expect(within(card).getByLabelText("Quote")).toHaveTextContent("La Asamblea Ordinaria se reunirá por lo menos una vez al año.");
    expect(within(card).getByRole("link", { name: "Open the official source" })).toHaveAttribute("target", "_blank");
    expect(card).toHaveTextContent("Notes from the legal team");
    expect(card).toHaveTextContent("Los estatutos pueden acortar el plazo.");
    expect(card).toHaveTextContent("Verified by the LiTT legal team. Sources consulted on Nov 17, 2026.");
  });

  it("disables an unverified rule and says why; a rule with no message is named by its code", async () => {
    view();
    const card = await screen.findByRole("article", { name: "x.draft" });
    expect(card).toHaveTextContent("Not verified");
    const button = within(card).getByRole("button", { name: "Turn on" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(/has not verified this rule against its official source/);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("turns a rule on by choosing the confirmed date it counts from, then reads the rules again", async () => {
    const user = userEvent.setup();
    view();
    const card = await screen.findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Turn on" }));
    const confirm = within(card).getByRole("button", { name: "Turn on with this date" });
    expect(confirm).toBeDisabled();
    await user.selectOptions(within(card).getByLabelText("Date to count from"), "f1");
    expect(within(card).getByRole("option", { name: "Cierre de ejercicio · Dec 31, 2026" })).toBeInTheDocument();
    mocks.get.mockResolvedValue(rules({ rules: [rule({ active: true, anchor: { fact_id: "f1", mode: "direct" }, changed_by: "u1", changed_at: "2026-11-17T10:00:00Z" }), unverified()], people: [{ user_id: "u1", name: "Ana Pérez" }] }));
    await user.click(confirm);
    expect(mocks.set).toHaveBeenCalledWith("p", "m", "lgsm.asamblea_ordinaria_anual@1", true, { anchor_fact_id: "f1", anchor_mode: "direct" });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const on = await screen.findByRole("button", { name: "Turn off" });
    const after = on.closest("article")!;
    expect(after).toHaveTextContent("Deadline · On");
    expect(after).toHaveTextContent("Counting from: Cierre de ejercicio (Dec 31, 2026)");
    expect(after).toHaveTextContent("Ana Pérez");
  });

  it("says there is no confirmed date to choose, and lets the lawyer cancel", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(rules({ anchor_choices: [] }));
    view();
    const card = await screen.findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Turn on" }));
    expect(within(card).getByText("There is no confirmed date in the client profile yet. Confirm one first.")).toBeInTheDocument();
    expect(within(card).queryByLabelText("Date to count from")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Turn on with this date" })).toBeDisabled();
    await user.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).queryByRole("button", { name: "Turn on with this date" })).not.toBeInTheDocument();
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("offers the first-cycle count when the rule has one, with its condition and cap, and sends the mode", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(rules({ rules: [marca()] }));
    view();
    const card = await screen.findByRole("article", { name: "Renewal of a trademark registration (ordinary period)" });
    await user.click(within(card).getByRole("button", { name: "Turn on" }));
    expect(card).toHaveTextContent("Applies only if: otorgado desde 2018-08-10. Check it yourself.");
    expect(card).toHaveTextContent("Check the cap yourself: at most 25 years from that date.");
    await user.selectOptions(within(card).getByLabelText("Date to count from"), "f2");
    await user.click(within(card).getByRole("checkbox", { name: "The date I chose is the grant date of the registration: work out the first expiry from it" }));
    await user.click(within(card).getByRole("button", { name: "Turn on with this date" }));
    expect(mocks.set).toHaveBeenCalledWith("p", "m", "lfppi.marca_renovacion@1", true, { anchor_fact_id: "f2", anchor_mode: "first_cycle" });
    expect(card).toHaveTextContent("Opens: 6 calendar months before");
    expect(card).toHaveTextContent("Closes: the date itself");
  });

  it("changes the date of a rule that is on, starting from the one it has, and turns it off", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(rules({ rules: [marca({ active: true, anchor: { fact_id: "f2", mode: "first_cycle" } })] }));
    view();
    const card = await screen.findByRole("article", { name: "Renewal of a trademark registration (ordinary period)" });
    expect(card).toHaveTextContent("Counting from: Registro de marca (Aug 15, 2019) · first expiry worked out from the grant date of the registration");
    await user.click(within(card).getByRole("button", { name: "Change the date" }));
    expect(within(card).getByLabelText("Date to count from")).toHaveValue("f2");
    expect(within(card).getByRole("checkbox")).toBeChecked();
    await user.selectOptions(within(card).getByLabelText("Date to count from"), "f1");
    await user.click(within(card).getByRole("button", { name: "Turn on with this date" }));
    expect(mocks.set).toHaveBeenCalledWith("p", "m", "lfppi.marca_renovacion@1", true, { anchor_fact_id: "f1", anchor_mode: "first_cycle" });
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await user.click(await within(card).findByRole("button", { name: "Turn off" }));
    expect(mocks.set).toHaveBeenLastCalledWith("p", "m", "lfppi.marca_renovacion@1", false, undefined);
  });

  it("says when the chosen date is no longer among the confirmed ones, and turns off a rule that is no longer verified", async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(rules({ rules: [unverified({ active: true, anchor: { fact_id: "gone", mode: "direct" } })], anchor_choices: [] }));
    view();
    const card = await screen.findByRole("article", { name: "x.draft" });
    expect(card).toHaveTextContent("The chosen date is not among the confirmed dates any more.");
    const off = within(card).getByRole("button", { name: "Turn off" });
    expect(off).toBeEnabled();
    await user.click(off);
    expect(mocks.set).toHaveBeenCalledWith("p", "m", "x.draft@1", false, undefined);
  });

  it("shows busy while saving and reports a failure without reloading the items", async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    mocks.set.mockReturnValue(new Promise((_, reject) => (fail = reject)));
    mocks.get.mockResolvedValue(rules({ rules: [rule({ active: true, anchor: { fact_id: "f1", mode: "direct" } })] }));
    view();
    const card = await screen.findByRole("article", { name: NAME });
    await user.click(within(card).getByRole("button", { name: "Turn off" }));
    expect(within(card).getByRole("button", { name: "Saving…" })).toBeDisabled();
    fail(new Error("409"));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalledWith(expect.any(Error), { action: "The rule could not be changed." }));
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(card).getByRole("button", { name: "Turn off" })).toBeEnabled();
  });

  it("gives viewers the list without buttons, and says who can change it", async () => {
    mocks.get.mockResolvedValue(rules({ can_write: false }));
    view();
    await screen.findByRole("article", { name: NAME });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Only owners and editors of the matter can turn rules on or off.")).toBeInTheDocument();
  });

  it("says so when the catalog is empty, and shows nothing for a matter that is not a retainer", async () => {
    mocks.get.mockResolvedValue(rules({ rules: [] }));
    const first = view();
    expect(await screen.findByText("There are no rules available yet.")).toBeInTheDocument();
    first.unmount();
    mocks.get.mockResolvedValue(rules({ retainer: false, rules: [] }));
    const { container } = view();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("reports a failed load in place", async () => {
    mocks.get.mockRejectedValue(new Error("down"));
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("The rules could not be loaded.");
    expect(mocks.notifyError).toHaveBeenCalled();
  });

  it("ignores a late answer after unmounting", async () => {
    let resolve!: (value: MatterObligationRules) => void;
    mocks.get.mockReturnValue(new Promise((done) => (resolve = done)));
    view().unmount();
    resolve(rules());
    mocks.get.mockRejectedValue(new Error("late"));
    view().unmount();
    await Promise.resolve();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("words business days and the month adjustments, in the order given", async () => {
    mocks.get.mockResolvedValue(
      rules({
        rules: [
          rule({
            key: "lgsm.sas_convocatoria_asamblea@1",
            code: "lgsm.sas_convocatoria_asamblea",
            name_key: "radar.rules.catalog.lgsm_sas_convocatoria_asamblea.name",
            requires_business_days: true,
            milestones: [{ kind: "due", ops: [{ unit: "business_days", amount: -5 }] }],
          }),
          rule({ key: "a.b@1", code: "a.b", kind: "expiry", milestones: [{ kind: "due", ops: [{ unit: "years", amount: 4 }, { unit: "days", amount: -30 }, { adjust: "month_end" }] }], citations: [{ source_code: "X", law: "L", location: "A", text: "T", url: "", last_reform: "DOF 01-01-2020" }], notes: null }),
        ],
      }),
    );
    view();
    const articles = await screen.findAllByRole("article");
    expect(articles[0]).toHaveTextContent("5 business days (LiTT does not calculate business days)");
    expect(articles[0]).toHaveTextContent("This rule counts business days. LiTT does not calculate them: the item is left to review.");
    expect(articles[1]).toHaveTextContent("Expiry · Off");
    expect(articles[1]).toHaveTextContent("Due: 4 calendar years after, then 30 calendar days before, then the last day of that month");
    expect(within(articles[1]).queryByRole("link")).not.toBeInTheDocument();
  });

  it("reads in Spanish, with legal's words as delivered", async () => {
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <ObligationRules projectId="p" matterId="m" onChanged={onChanged} />
      </IntlClientProvider>,
    );
    const card = await screen.findByRole("article", { name: "Asamblea general ordinaria anual de accionistas" });
    expect(card).toHaveTextContent("Vence: 4 meses calendario después");
    expect(card).toHaveTextContent("Fuente: Ley General de Sociedades Mercantiles, Art. 181, párrafo primero");
    expect(card).toHaveTextContent("Fecha de cierre del ejercicio social (por regla general, 31 de diciembre)");
    expect(within(card).getByRole("button", { name: "Activar" })).toBeEnabled();
    expect(screen.getByText(/Un abogado aún no verifica esta regla/)).toBeInTheDocument();
  });
});
