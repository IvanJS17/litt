import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ClientProfile as ClientProfileData, ProfileExtraction, ProfileFact } from "@mike/contracts";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ClientProfile } from "./ClientProfile";

const mocks = vi.hoisted(() => ({
  getClientProfile: vi.fn(),
  createProfileFact: vi.fn(),
  confirmProfileFact: vi.fn(),
  rejectProfileFact: vi.fn(),
  getProfileExtractionRoute: vi.fn(),
  extractProfileFacts: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getClientProfile: mocks.getClientProfile,
  createProfileFact: mocks.createProfileFact,
  confirmProfileFact: mocks.confirmProfileFact,
  rejectProfileFact: mocks.rejectProfileFact,
  getProfileExtractionRoute: mocks.getProfileExtractionRoute,
  extractProfileFacts: mocks.extractProfileFacts,
}));
vi.mock("@/app/lib/userFacingError", () => ({
  notifyError: mocks.notifyError,
  errorCode: (error: unknown) => (error as { code?: string } | null)?.code ?? null,
}));

const ANA = "user-ana";
const QUOTE = "La vigencia será de tres años contados desde el 1 de enero de 2026.";

const fact = (over: Partial<ProfileFact> = {}): ProfileFact => ({
  id: "fact-1",
  matter_id: "matter-1",
  kind: "contract",
  label: "Arrendamiento de la bodega",
  data: { counterparty: "Inmuebles del Norte", object: "Bodega en Monterrey" },
  status: "pending",
  stale_reason: null,
  effective_status: "pending",
  source: {
    document_id: "doc-1",
    version_id: "ver-1",
    version_number: 2,
    filename: "contrato.docx",
    start_char: 10,
    end_char: 80,
    quote: QUOTE,
    text_sha256: "a".repeat(64),
  },
  created_by: ANA,
  created_at: "2026-11-16T10:00:00Z",
  decided_by: null,
  decided_at: null,
  events: [{ id: "e1", actor_user_id: ANA, action: "created", reason: null, created_at: "2026-11-16T10:00:00Z" }],
  ...over,
});
const profile = (over: Partial<ClientProfileData> = {}): ClientProfileData => ({
  retainer: true,
  can_write: true,
  facts: [fact()],
  versions: [
    { document_id: "doc-1", version_id: "ver-1", version_number: 2, filename: "contrato.docx" },
    { document_id: "doc-2", version_id: "ver-9", version_number: null, filename: null },
  ],
  people: [{ user_id: ANA, name: "Ana Pérez" }],
  ...over,
});

const renderPage = () => render(<ClientProfile projectId="project-1" matterId="matter-1" />);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClientProfile.mockResolvedValue(profile());
  // No route by default: the button of assisted extraction is not offered.
  mocks.getProfileExtractionRoute.mockResolvedValue(null);
});

describe("ClientProfile", () => {
  it("shows a loading state of the list's shape, then the facts grouped by kind", async () => {
    let resolve!: (value: ClientProfileData) => void;
    mocks.getClientProfile.mockReturnValue(new Promise((done) => (resolve = done)));
    renderPage();
    expect(screen.getByLabelText("Loading the client profile")).toHaveAttribute("aria-busy", "true");
    resolve(
      profile({
        facts: [
          fact(),
          fact({ id: "fact-2", kind: "date", label: "Vencimiento", data: { date_kind: "expiry", date_on: "2028-12-31", notice_days: 90, notice_day_type: "business" } }),
          fact({ id: "fact-3", kind: "power_of_attorney", label: "Poder general", data: { grantee: "Luis Soto", scope: "Administración", granted_on: "2026-01-05" } }),
          fact({ id: "fact-4", kind: "obligation", label: "Informe mensual", data: { description: "Entregar el informe", periodicity: "mensual" } }),
          fact({ id: "fact-5", kind: "other", label: "Domicilio", data: { note: "Domicilio convencional" } }),
        ],
      }),
    );
    expect(await screen.findByRole("heading", { name: "Contracts" })).toBeInTheDocument();
    for (const name of ["Dates", "Powers of attorney", "Obligations", "Other facts"])
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading the client profile")).not.toBeInTheDocument();
    const date = screen.getByRole("article", { name: "Vencimiento" });
    expect(date).toHaveTextContent("Expiry");
    expect(date).toHaveTextContent("Dec 31, 2028");
    expect(date).toHaveTextContent("Notice: 90 days (Business days)");
    expect(screen.getByRole("article", { name: "Poder general" })).toHaveTextContent("Jan 5, 2026");
  });

  it("shows the fact with its quote, its source version and who captured it", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Arrendamiento de la bodega" });
    expect(within(card).getByText(QUOTE)).toBeInTheDocument();
    expect(card).toHaveTextContent("Source: contrato.docx, version 2");
    expect(card).toHaveTextContent("Captured by Ana Pérez on");
    expect(card).toHaveTextContent("Awaiting confirmation");
    expect(card).toHaveTextContent("Inmuebles del Norte");
    // The status is plain text, not a control.
    expect(within(card).queryByRole("status")).not.toBeInTheDocument();
  });

  it("names a source that no longer exists and a deleted account", async () => {
    mocks.getClientProfile.mockResolvedValue(
      profile({
        facts: [
          fact({
            created_by: "gone",
            events: [{ id: "e1", actor_user_id: "gone", action: "created", reason: null, created_at: "2026-11-16T10:00:00Z" }],
            source: { ...fact().source, version_number: null, filename: null },
          }),
        ],
        people: [],
      }),
    );
    renderPage();
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent("Source: A version that no longer exists");
    expect(card).toHaveTextContent("Captured by Deleted user on");
  });

  it("shows a stale fact as out of date with its reason, and does not let it be confirmed", async () => {
    mocks.getClientProfile.mockResolvedValue(
      profile({ facts: [fact({ stale_reason: "text_changed", effective_status: "stale" })] }),
    );
    renderPage();
    const card = await screen.findByRole("article");
    expect(card).toHaveTextContent("Out of date");
    expect(card).toHaveTextContent("The text of the cited version changed since the fact was captured.");
    expect(card).toHaveTextContent("It cannot be confirmed while its source is out of date.");
    expect(within(card).getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("shows confirmed and rejected facts with who decided and why", async () => {
    mocks.getClientProfile.mockResolvedValue(
      profile({
        facts: [
          fact({
            id: "ok",
            label: "Confirmado",
            status: "confirmed",
            effective_status: "confirmed",
            events: [
              { id: "e1", actor_user_id: ANA, action: "created", reason: null, created_at: "2026-11-16T10:00:00Z" },
              { id: "e2", actor_user_id: ANA, action: "confirmed", reason: null, created_at: "2026-11-16T11:00:00Z" },
            ],
          }),
          fact({
            id: "no",
            label: "Rechazado",
            status: "rejected",
            effective_status: "rejected",
            events: [
              { id: "e3", actor_user_id: ANA, action: "created", reason: null, created_at: "2026-11-16T10:00:00Z" },
              { id: "e4", actor_user_id: ANA, action: "rejected", reason: "Cláusula derogada", created_at: "2026-11-16T11:00:00Z" },
            ],
          }),
        ],
      }),
    );
    renderPage();
    const confirmed = await screen.findByRole("article", { name: "Confirmado" });
    expect(confirmed).toHaveTextContent("Confirmed by Ana Pérez on");
    // A confirmed fact can still be rejected, but not confirmed twice.
    expect(within(confirmed).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(within(confirmed).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    const rejected = screen.getByRole("article", { name: "Rechazado" });
    expect(rejected).toHaveTextContent("Rejected by Ana Pérez on");
    expect(rejected).toHaveTextContent("Reason: Cláusula derogada");
    expect(within(rejected).queryByRole("button")).not.toBeInTheDocument();
  });

  it("gives a viewer the facts and no way to add, confirm or reject", async () => {
    mocks.getClientProfile.mockResolvedValue(profile({ can_write: false, versions: [] }));
    renderPage();
    await screen.findByRole("article");
    expect(screen.queryByRole("button", { name: "Add a fact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("explains an empty profile differently to who can and cannot write", async () => {
    mocks.getClientProfile.mockResolvedValue(profile({ facts: [] }));
    const { unmount } = renderPage();
    expect(await screen.findByText("Add the first fact with the quote from the document that backs it.")).toBeInTheDocument();
    unmount();
    mocks.getClientProfile.mockResolvedValue(profile({ facts: [], can_write: false }));
    renderPage();
    expect(await screen.findByText("Nobody has added a fact to this profile yet.")).toBeInTheDocument();
  });

  it("says a matter that is not a retainer has no profile", async () => {
    mocks.getClientProfile.mockResolvedValue(profile({ retainer: false, can_write: false, facts: [], versions: [], people: [] }));
    renderPage();
    expect(await screen.findByText("This matter is not a retainer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a fact" })).not.toBeInTheDocument();
  });

  it("offers a retry when the load fails", async () => {
    mocks.getClientProfile.mockRejectedValueOnce(new Error("boom"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("The client profile could not be loaded.");
    expect(mocks.notifyError).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("article")).toBeInTheDocument();
  });

  it("links to the requests of the matter, and says where it is", async () => {
    renderPage();
    await screen.findByRole("article");
    const nav = screen.getByRole("navigation", { name: "Matter sections" });
    expect(within(nav).getByRole("link", { name: "Requests" })).toHaveAttribute("href", "/projects/project-1/matters/matter-1/requests");
    expect(within(nav).getByRole("link", { name: "Client profile" })).toHaveAttribute("aria-current", "page");
  });
});

describe("adding a fact", () => {
  async function openForm() {
    renderPage();
    await screen.findByRole("article");
    await userEvent.click(screen.getByRole("button", { name: "Add a fact" }));
    return screen.getByRole("form", { name: "Add a fact" });
  }

  it("sends the fields and the citation, then reads the profile again", async () => {
    mocks.createProfileFact.mockResolvedValue(fact({ id: "fact-9" }));
    const form = await openForm();
    const submit = within(form).getByRole("button", { name: "Save fact" });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "Arrendamiento nuevo");
    await userEvent.type(within(form).getByLabelText("Counterparty"), "Inmuebles del Norte");
    await userEvent.type(within(form).getByLabelText("Subject"), "Bodega");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    expect(within(form).getByRole("option", { name: "contrato.docx, version 2" })).toBeInTheDocument();
    expect(within(form).getByRole("option", { name: `doc-2, version –` })).toBeInTheDocument();
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Quote from the document"), QUOTE);
    expect(submit).toBeEnabled();
    mocks.getClientProfile.mockClear();
    await userEvent.click(submit);
    await waitFor(() =>
      expect(mocks.createProfileFact).toHaveBeenCalledWith("project-1", "matter-1", {
        kind: "contract",
        label: "Arrendamiento nuevo",
        data: { counterparty: "Inmuebles del Norte", object: "Bodega" },
        source: { version_id: "ver-1", quote: QUOTE },
      }),
    );
    await waitFor(() => expect(mocks.getClientProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Add a fact" })).not.toBeInTheDocument());
  });

  it("builds a date fact with the notice period", async () => {
    mocks.createProfileFact.mockResolvedValue(fact());
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText("Kind of fact"), "date");
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "Aviso");
    await userEvent.selectOptions(within(form).getByLabelText("Kind of date"), "renewal_notice");
    // Nothing to date yet: the form is not ready.
    expect(within(form).getByLabelText("Kind of days")).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Notice days"), "90");
    expect(within(form).getByLabelText("Kind of days")).toBeEnabled();
    await userEvent.selectOptions(within(form).getByLabelText("Kind of days"), "business");
    await userEvent.type(within(form).getByLabelText("Date"), "2028-12-31");
    await userEvent.type(within(form).getByLabelText("Rule as the document words it"), "noventa días antes");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), QUOTE);
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    await waitFor(() =>
      expect(mocks.createProfileFact).toHaveBeenCalledWith("project-1", "matter-1", {
        kind: "date",
        label: "Aviso",
        data: {
          date_kind: "renewal_notice",
          date_on: "2028-12-31",
          rule_text: "noventa días antes",
          notice_days: 90,
          notice_day_type: "business",
        },
        source: { version_id: "ver-1", quote: QUOTE },
      }),
    );
  });

  it("sends a date fact with only a rule, and no day type without days", async () => {
    mocks.createProfileFact.mockResolvedValue(fact());
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText("Kind of fact"), "date");
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "Vigencia");
    await userEvent.type(within(form).getByLabelText("Rule as the document words it"), "tres años");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), QUOTE);
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    await waitFor(() => expect(mocks.createProfileFact).toHaveBeenCalled());
    expect(mocks.createProfileFact.mock.calls[0][2].data).toEqual({ date_kind: "expiry", rule_text: "tres años" });
  });

  it("builds a power of attorney with its dates and the other kinds with their fields", async () => {
    mocks.createProfileFact.mockResolvedValue(fact());
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText("Kind of fact"), "power_of_attorney");
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "Poder");
    await userEvent.type(within(form).getByLabelText("Attorney-in-fact"), "Ana");
    await userEvent.type(within(form).getByLabelText("Powers granted"), "Pleitos y cobranzas");
    await userEvent.type(within(form).getByLabelText("Granted on"), "2026-01-01");
    await userEvent.type(within(form).getByLabelText("Expires on"), "2028-01-01");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), QUOTE);
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    await waitFor(() => expect(mocks.createProfileFact).toHaveBeenCalled());
    expect(mocks.createProfileFact.mock.calls[0][2]).toMatchObject({
      kind: "power_of_attorney",
      data: { grantee: "Ana", scope: "Pleitos y cobranzas", granted_on: "2026-01-01", expires_on: "2028-01-01" },
    });
  });

  it("asks for the fields of an obligation and of any other fact", async () => {
    mocks.createProfileFact.mockResolvedValue(fact());
    const form = await openForm();
    await userEvent.selectOptions(within(form).getByLabelText("Kind of fact"), "obligation");
    expect(within(form).getByLabelText("Periodicity")).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Description"), "Entregar el informe");
    await userEvent.selectOptions(within(form).getByLabelText("Kind of fact"), "other");
    expect(within(form).queryByLabelText("Description")).not.toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText("Note"), "Domicilio convencional");
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "Nota");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), QUOTE);
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    await waitFor(() => expect(mocks.createProfileFact).toHaveBeenCalled());
    expect(mocks.createProfileFact.mock.calls[0][2]).toMatchObject({ kind: "other", data: { note: "Domicilio convencional" } });
  });

  it.each([
    ["quote_not_found", "That passage is not in the text of the chosen version."],
    ["source_text_unavailable", "The text of that version is not ready yet."],
    ["version_not_in_matter", "That version is not from a document of this matter."],
  ])("keeps the form and says why when the server answers %s", async (code, message) => {
    mocks.createProfileFact.mockRejectedValue({ code });
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "X");
    await userEvent.type(within(form).getByLabelText("Counterparty"), "Y");
    await userEvent.type(within(form).getByLabelText("Subject"), "Z");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), "otra cosa");
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(message);
    expect(within(form).getByLabelText("Quote from the document")).toHaveValue("otra cosa");
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("reports any other failure and keeps the form", async () => {
    mocks.createProfileFact.mockRejectedValue(new Error("boom"));
    const form = await openForm();
    await userEvent.type(within(form).getByLabelText("Title of the fact"), "X");
    await userEvent.type(within(form).getByLabelText("Counterparty"), "Y");
    await userEvent.type(within(form).getByLabelText("Subject"), "Z");
    await userEvent.selectOptions(within(form).getByLabelText("Document and version"), "ver-1");
    await userEvent.type(within(form).getByLabelText("Quote from the document"), "q");
    await userEvent.click(within(form).getByRole("button", { name: "Save fact" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenCalled());
    expect(screen.getByRole("form", { name: "Add a fact" })).toBeInTheDocument();
  });

  it("says there is nothing to cite from when the matter has no documents, and can be cancelled", async () => {
    mocks.getClientProfile.mockResolvedValue(profile({ versions: [] }));
    renderPage();
    await screen.findByRole("article");
    await userEvent.click(screen.getByRole("button", { name: "Add a fact" }));
    expect(screen.getByText("This matter has no documents to cite from yet.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Add a fact" })).not.toBeInTheDocument();
  });
});

describe("deciding on a fact", () => {
  it("confirms it and reads the profile again", async () => {
    mocks.confirmProfileFact.mockResolvedValue(fact({ status: "confirmed", effective_status: "confirmed" }));
    renderPage();
    const card = await screen.findByRole("article");
    mocks.getClientProfile.mockClear();
    await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.confirmProfileFact).toHaveBeenCalledWith("project-1", "matter-1", "fact-1", {}));
    await waitFor(() => expect(mocks.getClientProfile).toHaveBeenCalledTimes(1));
  });

  it("rejects it with a reason after asking for one", async () => {
    mocks.rejectProfileFact.mockResolvedValue(fact({ status: "rejected", effective_status: "rejected" }));
    renderPage();
    const card = await screen.findByRole("article");
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    expect(within(card).queryByRole("button", { name: "Confirm" })).not.toBeInTheDocument();
    await userEvent.type(within(card).getByLabelText("Reason (optional)"), "Cláusula derogada");
    await userEvent.click(within(card).getByRole("button", { name: "Reject the fact" }));
    await waitFor(() =>
      expect(mocks.rejectProfileFact).toHaveBeenCalledWith("project-1", "matter-1", "fact-1", { reason: "Cláusula derogada" }),
    );
  });

  it("rejects without a reason, and can back out of rejecting", async () => {
    mocks.rejectProfileFact.mockResolvedValue(fact());
    renderPage();
    const card = await screen.findByRole("article");
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await userEvent.type(within(card).getByLabelText("Reason (optional)"), "x");
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    expect(within(card).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    expect(within(card).getByLabelText("Reason (optional)")).toHaveValue("");
    await userEvent.click(within(card).getByRole("button", { name: "Reject the fact" }));
    await waitFor(() => expect(mocks.rejectProfileFact).toHaveBeenCalledWith("project-1", "matter-1", "fact-1", {}));
  });

  it("reports a failed confirmation and a failed rejection", async () => {
    mocks.confirmProfileFact.mockRejectedValue(new Error("boom"));
    mocks.rejectProfileFact.mockRejectedValue(new Error("boom"));
    renderPage();
    const card = await screen.findByRole("article");
    await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenLastCalledWith(expect.anything(), { action: "The fact could not be confirmed." }));
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await userEvent.click(within(card).getByRole("button", { name: "Reject the fact" }));
    await waitFor(() => expect(mocks.notifyError).toHaveBeenLastCalledWith(expect.anything(), { action: "The fact could not be rejected." }));
  });

  it("reads the profile again when somebody else decided first", async () => {
    mocks.confirmProfileFact.mockRejectedValue({ code: "fact_already_decided" });
    renderPage();
    const card = await screen.findByRole("article");
    mocks.getClientProfile.mockClear();
    await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.getClientProfile).toHaveBeenCalledTimes(1));
    expect(mocks.notifyError).toHaveBeenCalledWith(expect.anything(), {
      action: "Somebody else already decided on this fact. The profile was reloaded.",
    });
  });

  it("reports a profile that cannot be read again after a change", async () => {
    mocks.confirmProfileFact.mockResolvedValue(fact());
    renderPage();
    const card = await screen.findByRole("article");
    mocks.getClientProfile.mockRejectedValueOnce(new Error("down"));
    await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith(expect.anything(), { action: "The client profile could not be loaded." }),
    );
  });
});

describe("in Spanish", () => {
  it("speaks the glossary words and never measures hours", async () => {
    mocks.getClientProfile.mockResolvedValue(
      profile({
        facts: [
          fact({ stale_reason: "version_missing", effective_status: "stale" }),
          fact({ id: "fact-2", label: "Fecha", kind: "date", data: { date_kind: "renewal_notice", notice_days: 1, notice_day_type: "calendar" } }),
        ],
      }),
    );
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <ClientProfile projectId="project-1" matterId="matter-1" />
      </IntlClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Ficha del cliente" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contratos" })).toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Arrendamiento de la bodega" });
    expect(card).toHaveTextContent("Obsoleto");
    expect(card).toHaveTextContent("El documento o la versión citada ya no está en este asunto.");
    expect(screen.getByRole("article", { name: "Fecha" })).toHaveTextContent("Aviso: 1 día (Días naturales)");
    expect(screen.getByRole("button", { name: "Agregar dato" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bhoras?\b|\bminutos?\b|estimaci/i);
  });
});


describe("assisted extraction", () => {
  const route = { provider: "claude", model: "claude-sonnet-5-5" };
  const proposed = (over: Partial<ProfileFact> = {}) =>
    fact({
      id: "fact-ai",
      kind: "date",
      label: "Vencimiento del arrendamiento",
      data: { date_kind: "expiry", date_on: "2028-12-31" },
      events: [{ id: "e9", actor_user_id: ANA, action: "created", reason: "assisted_extraction", created_at: "2026-11-17T10:00:00Z" }],
      ...over,
    });
  const result = (over: Partial<ProfileExtraction> = {}): ProfileExtraction => ({
    proposed: 1,
    discarded_quote_not_found: 0,
    discarded_invalid: 0,
    discarded_duplicate: 0,
    fact_ids: ["fact-ai"],
    ...over,
  });
  const choose = async (versionLabel = "contrato.docx, version 2") => {
    await userEvent.selectOptions(await screen.findByLabelText("Document and version"), versionLabel);
  };

  it("offers no button when the space has no route for this person, or the person only reads", async () => {
    renderPage();
    await screen.findByRole("article");
    expect(screen.queryByRole("button", { name: "Propose facts with AI" })).not.toBeInTheDocument();

    mocks.getProfileExtractionRoute.mockClear();
    mocks.getClientProfile.mockResolvedValue(profile({ can_write: false, versions: [] }));
    renderPage();
    await screen.findAllByRole("article");
    expect(mocks.getProfileExtractionRoute).not.toHaveBeenCalled();
  });

  it("does not ask about a route for a matter that is not a retainer", async () => {
    mocks.getClientProfile.mockResolvedValue(profile({ retainer: false, can_write: false, facts: [], versions: [] }));
    renderPage();
    await screen.findByText("This matter is not a retainer");
    expect(mocks.getProfileExtractionRoute).not.toHaveBeenCalled();
  });

  it("hides the button when the route cannot be read, without bothering the person", async () => {
    mocks.getProfileExtractionRoute.mockRejectedValue(new Error("down"));
    renderPage();
    await screen.findByRole("article");
    await waitFor(() => expect(mocks.getProfileExtractionRoute).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Propose facts with AI" })).not.toBeInTheDocument();
    expect(mocks.notifyError).not.toHaveBeenCalled();
  });

  it("says where the text goes before the click, and needs a version", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    renderPage();
    const button = await screen.findByRole("button", { name: "Propose facts with AI" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      "The text of this version will be sent to Anthropic (Claude) using your own key or your firm's key, never LiTT's. Each suggestion stays awaiting confirmation until a lawyer reviews it.",
    );
    await choose();
    expect(button).toBeEnabled();
    expect(mocks.extractProfileFacts).not.toHaveBeenCalled();
  });

  it("names a provider the catalog does not know as the server called it", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue({ provider: "acme-llm", model: "m" });
    renderPage();
    expect(await screen.findByText(/will be sent to acme-llm using your own key/)).toBeInTheDocument();
  });

  it("runs the chosen version, shows what was proposed, and lists the pending proposals to confirm or reject", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    let finish!: (value: ProfileExtraction) => void;
    mocks.extractProfileFacts.mockReturnValue(new Promise((done) => (finish = done)));
    renderPage();
    await screen.findByRole("button", { name: "Propose facts with AI" });
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    expect(mocks.extractProfileFacts).toHaveBeenCalledWith("project-1", "matter-1", "ver-1");
    const busy = screen.getByRole("button", { name: "Reading the document…" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.getByLabelText("Document and version")).toBeDisabled();

    mocks.getClientProfile.mockResolvedValue(profile({ facts: [proposed(), fact()] }));
    finish(result({ discarded_quote_not_found: 2, discarded_invalid: 1, discarded_duplicate: 3 }));
    expect(await screen.findByText("The AI proposed 1 fact.")).toBeInTheDocument();
    expect(screen.getByText("2 suggestions were discarded because their quote is not in the document.")).toBeInTheDocument();
    expect(screen.getByText("1 suggestion was discarded because it did not fit the format.")).toBeInTheDocument();
    expect(screen.getByText("3 suggestions were discarded because the profile already has those facts.")).toBeInTheDocument();
    expect(screen.getByText("Review each suggestion and confirm or reject it. Nothing reaches the radar until someone confirms it.")).toBeInTheDocument();

    const list = screen.getByRole("region", { name: "Suggestions awaiting confirmation" });
    const card = within(list).getByRole("article", { name: "Vencimiento del arrendamiento" });
    expect(card).toHaveTextContent("Awaiting confirmation");
    expect(card).toHaveTextContent("Proposed with AI at the request of Ana Pérez");
    expect(card).not.toHaveTextContent("assisted_extraction");
    expect(within(card).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Reject" })).toBeInTheDocument();
    // The facts typed by hand stay in their group, and the proposal is not listed twice.
    expect(screen.getAllByRole("article", { name: "Vencimiento del arrendamiento" })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Contracts" })).toBeInTheDocument();
    // The button is back for another run.
    expect(screen.getByRole("button", { name: "Propose facts with AI" })).toBeEnabled();
  });

  it("confirms a proposal one by one, and then it moves to its group", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    mocks.extractProfileFacts.mockResolvedValue(result());
    mocks.getClientProfile.mockResolvedValue(profile({ facts: [proposed()] }));
    mocks.confirmProfileFact.mockResolvedValue(proposed({ status: "confirmed", effective_status: "confirmed" }));
    renderPage();
    await screen.findByRole("button", { name: "Propose facts with AI" });
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    const card = await screen.findByRole("article", { name: "Vencimiento del arrendamiento" });
    mocks.getClientProfile.mockResolvedValue(
      profile({ facts: [proposed({ status: "confirmed", effective_status: "confirmed", decided_by: ANA, decided_at: "2026-11-17T11:00:00Z" })] }),
    );
    await userEvent.click(within(card).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(mocks.confirmProfileFact).toHaveBeenCalledWith("project-1", "matter-1", "fact-ai", {}));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Suggestions awaiting confirmation" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Dates" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Vencimiento del arrendamiento" })).toHaveTextContent("Confirmed");
  });

  it("rejects a proposal with a reason", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    mocks.extractProfileFacts.mockResolvedValue(result());
    mocks.getClientProfile.mockResolvedValue(profile({ facts: [proposed()] }));
    mocks.rejectProfileFact.mockResolvedValue(proposed({ status: "rejected", effective_status: "rejected" }));
    renderPage();
    await screen.findByRole("button", { name: "Propose facts with AI" });
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    const card = await screen.findByRole("article", { name: "Vencimiento del arrendamiento" });
    await userEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await userEvent.type(within(card).getByLabelText("Reason (optional)"), "No es el vencimiento");
    await userEvent.click(within(card).getByRole("button", { name: "Reject the fact" }));
    await waitFor(() =>
      expect(mocks.rejectProfileFact).toHaveBeenCalledWith("project-1", "matter-1", "fact-ai", { reason: "No es el vencimiento" }),
    );
  });

  it("says plainly when nothing was proposed, and does not talk about reviewing", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    mocks.extractProfileFacts.mockResolvedValue(result({ proposed: 0, fact_ids: [], discarded_invalid: 1 }));
    renderPage();
    await screen.findByRole("button", { name: "Propose facts with AI" });
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    expect(await screen.findByText("The AI proposed no new facts.")).toBeInTheDocument();
    expect(screen.getByText("1 suggestion was discarded because it did not fit the format.")).toBeInTheDocument();
    expect(screen.queryByText(/Review each suggestion/)).not.toBeInTheDocument();
    expect(screen.queryByText(/quote is not in the document/)).not.toBeInTheDocument();
  });

  it("reports a failed run, with nothing left over from the last one", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    mocks.extractProfileFacts.mockResolvedValueOnce(result({ proposed: 2, fact_ids: [] }));
    mocks.extractProfileFacts.mockRejectedValueOnce({ code: "extraction_text_too_large" });
    renderPage();
    await screen.findByRole("button", { name: "Propose facts with AI" });
    await choose();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    expect(await screen.findByText("The AI proposed 2 facts.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Propose facts with AI" }));
    await waitFor(() =>
      expect(mocks.notifyError).toHaveBeenCalledWith({ code: "extraction_text_too_large" }, { action: "Could not propose facts with AI." }),
    );
    expect(screen.queryByText("The AI proposed 2 facts.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Propose facts with AI" })).toBeEnabled();
  });

  it("offers no button to a matter with no documents to read", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    mocks.getClientProfile.mockResolvedValue(profile({ versions: [] }));
    renderPage();
    await screen.findByRole("article");
    await waitFor(() => expect(mocks.getProfileExtractionRoute).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Propose facts with AI" })).not.toBeInTheDocument();
  });

  it("shows a version without a name by its document id and a dash", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue(route);
    renderPage();
    const select = await screen.findByLabelText("Document and version");
    expect(within(select).getByRole("option", { name: "doc-2, version –" })).toBeInTheDocument();
  });

  it("speaks Spanish, with the line legal approved", async () => {
    mocks.getProfileExtractionRoute.mockResolvedValue({ provider: "openai", model: "gpt-6-luna" });
    render(
      <IntlClientProvider locale="es-MX" messages={esMX as never}>
        <ClientProfile projectId="project-1" matterId="matter-1" />
      </IntlClientProvider>,
    );
    const button = await screen.findByRole("button", { name: "Proponer datos con IA" });
    expect(button).toHaveAccessibleDescription(
      "Se enviará el texto de esta versión a OpenAI, con tu propia llave o la de tu despacho, nunca una de LiTT. Cada propuesta queda por confirmar hasta que un abogado la revise.",
    );
    expect(screen.getByLabelText("Documento y versión")).toBeInTheDocument();
  });
});
