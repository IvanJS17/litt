import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import * as api from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { showToast } from "@/app/components/ui/toast";
import { PlaybookCorrections, MAX_CORRECTIONS } from "./PlaybookCorrections";
import { PlaybookRuleOrigin } from "./PlaybookRuleOrigin";
import { PlaybookToolbar } from "./PlaybookToolbar";
import { usePlaybookCorrectionPupils } from "./usePlaybookCorrectionPupils";

vi.mock("@/app/lib/mikeApi", () => ({
  listPlaybookChanges: vi.fn(),
  decidePlaybookChange: vi.fn(),
  startPlaybookCorrections: vi.fn(),
  getPlaybookImport: vi.fn(),
  getMyPupils: vi.fn(),
  listOrgMembers: vi.fn(),
}));
vi.mock("@/app/lib/userFacingError", () => ({ notifyError: vi.fn() }));
vi.mock("@/app/components/ui/toast", () => ({ showToast: vi.fn() }));
// The dropdown is Radix; a native select keeps these tests about the screen.
vi.mock("@/app/components/modals/ModalSelect", () => ({
  ModalSelect: (props: {
    id: string;
    value: string;
    placeholder?: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    disabled?: boolean;
  }) => (
    <select
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.placeholder && <option value="">{props.placeholder}</option>}
      {props.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const PLAYBOOK = "playbook-1";
const LONG = "Una regla con un texto muy largo que no cabe en una sola línea de 320 píxeles sin partirse";

function rule(overrides: Partial<api.PlaybookRule> = {}): api.PlaybookRule {
  return {
    id: "r-pago",
    name: "Forma de pago",
    concept: "La renta se paga por mensualidades vencidas.",
    scope: "clause",
    required: false,
    guidance: "",
    standard: null,
    fallbacks: [],
    unacceptable: [],
    conditions: [],
    actions: [],
    sourceRefs: [],
    ...overrides,
  };
}

function change(overrides: Partial<api.PlaybookChange> = {}): api.PlaybookChange {
  return {
    id: "change-1",
    playbookId: PLAYBOOK,
    op: "modify_rule",
    ruleId: "r-pago",
    topicId: null,
    before: rule(),
    after: rule({
      concept: "La renta se paga por mensualidades adelantadas.",
      guidance: "Pide el pago adelantado.",
      standard: {
        name: "Estándar",
        criteria: "Mes adelantado",
        sampleClauses: [{ text: "La renta se pagará por adelantado.", usage: "preferred", sourceRefs: [] }],
      },
      fallbacks: [{ name: "Alterna", criteria: "Quincena adelantada", sampleClauses: [] }],
      unacceptable: [{ name: "Vencida", criteria: "Pago al vencimiento", sampleClauses: [] }],
      conditions: ["Contrato de más de un año"],
      actions: [{ scenario: "Si no aceptan", instruction: "Escalar al socio" }, { scenario: "", instruction: "Avisar" }],
      origin: { kind: "correction", attributedTo: "Lucía Ortega", unbacked: false },
    }),
    changedFields: ["concept"],
    rationale: "La renta se paga por adelantado.",
    source: "correction",
    status: "pending",
    createdAt: "2026-11-08T10:00:00.000Z",
    ...overrides,
  };
}

const running: api.PlaybookImport = {
  id: "import-1",
  kind: "correction",
  status: "running",
  stage: "compiling",
  error: null,
  filename: "",
  name: null,
  playbookId: PLAYBOOK,
  startedAt: "2026-11-08T10:00:00.000Z",
  completedAt: null,
};

const onPlaybookChanged = vi.fn();
const onModelChange = vi.fn();

function screenUnderTest(props: Partial<React.ComponentProps<typeof PlaybookCorrections>> = {}) {
  return render(
    <IntlClientProvider locale="es-MX" messages={esMX}>
      <PlaybookCorrections
        playbookId={PLAYBOOK}
        pupils={[
          { userId: "pupil-1", label: "Luis Pasante" },
          { userId: "pupil-2", label: "eva@despacho.example.mx" },
        ]}
        models={[{ value: "claude-opus-5", label: "Claude Opus 5" }]}
        model="claude-opus-5"
        onModelChange={onModelChange}
        onPlaybookChanged={onPlaybookChanged}
        {...props}
      />
    </IntlClientProvider>,
  );
}

async function fill(index = 0, after = "El arrendatario paga por adelantado.") {
  fireEvent.change(screen.getAllByLabelText("Texto corregido")[index], { target: { value: after } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listPlaybookChanges).mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("the Corrections screen (es-MX)", () => {
  it("holds the layout while it loads, then says nothing awaits a decision", async () => {
    let settle: (value: api.PlaybookChange[]) => void = () => undefined;
    vi.mocked(api.listPlaybookChanges).mockReturnValue(new Promise((resolve) => (settle = resolve)));
    screenUnderTest();
    expect(screen.getByRole("heading", { name: "Convierte correcciones en reglas" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Cambios propuestos" })).toBeVisible();
    expect(screen.getByRole("status", { name: "Cargando los cambios propuestos…" })).toBeVisible();
    await act(async () => settle([]));
    expect(screen.getByText("No hay cambios esperando una decisión.")).toBeVisible();
    // The same two headings stay where they were.
    expect(screen.getByRole("heading", { name: "Cambios propuestos" })).toBeVisible();
  });

  it("sends the trimmed corrections for the chosen pupil and follows the batch to its changes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.startPlaybookCorrections).mockResolvedValue(running);
    vi.mocked(api.getPlaybookImport)
      .mockResolvedValueOnce(running)
      .mockResolvedValue({ ...running, status: "completed", completedAt: "2026-11-08T10:01:00.000Z" });
    screenUnderTest();
    await screen.findByText("No hay cambios esperando una decisión.");
    const send = screen.getByRole("button", { name: "Proponer reglas" });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Pasante"), { target: { value: "pupil-1" } });
    expect(send).toBeDisabled();
    await fill(0, "  El arrendatario paga por adelantado.  ");
    fireEvent.change(screen.getByLabelText("Texto original (opcional)"), { target: { value: "Paga al vencimiento." } });
    fireEvent.change(screen.getByLabelText("Tu comentario (opcional)"), { target: { value: " Siempre adelantado. " } });
    expect(send).toBeEnabled();

    vi.mocked(api.listPlaybookChanges).mockResolvedValue([change()]);
    fireEvent.click(send);
    await waitFor(() =>
      expect(api.startPlaybookCorrections).toHaveBeenCalledWith(PLAYBOOK, {
        model: "claude-opus-5",
        traineeUserId: "pupil-1",
        corrections: [
          { before: "Paga al vencimiento.", after: "El arrendatario paga por adelantado.", comment: "Siempre adelantado." },
        ],
      }),
    );
    expect(await screen.findByText("Preparando las reglas propuestas…")).toBeVisible();
    // The form is emptied once sent, and cannot send again while it runs.
    expect(screen.getByLabelText("Texto corregido")).toHaveValue("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });
    expect(await screen.findByRole("heading", { name: "Forma de pago" })).toBeVisible();
    expect(screen.queryByText("Preparando las reglas propuestas…")).toBeNull();
  });

  it("shows the server's reason when the batch fails, and says when it produced nothing", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.startPlaybookCorrections).mockResolvedValue(running);
    vi.mocked(api.getPlaybookImport).mockResolvedValue({ ...running, status: "failed", error: "El modelo no respondió." });
    screenUnderTest();
    await screen.findByText("No hay cambios esperando una decisión.");
    fireEvent.change(screen.getByLabelText("Pasante"), { target: { value: "pupil-2" } });
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Proponer reglas" }));
    await screen.findByText("Preparando las reglas propuestas…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(await screen.findByText(/No se pudieron preparar las reglas propuestas\./)).toBeVisible();
    expect(screen.getByText(/El modelo no respondió\./)).toBeVisible();
  });

  it("says a finished batch gave no change", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.startPlaybookCorrections).mockResolvedValue(running);
    vi.mocked(api.getPlaybookImport).mockResolvedValue({ ...running, status: "completed" });
    screenUnderTest();
    await screen.findByText("No hay cambios esperando una decisión.");
    fireEvent.change(screen.getByLabelText("Pasante"), { target: { value: "pupil-1" } });
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Proponer reglas" }));
    await screen.findByText("Preparando las reglas propuestas…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(await screen.findByText("Estas correcciones no produjeron ningún cambio.")).toBeVisible();
  });

  it("keeps polling through a failed check and reports a refused batch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(api.startPlaybookCorrections)
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(running);
    vi.mocked(api.getPlaybookImport).mockRejectedValue(new Error("offline"));
    screenUnderTest();
    await screen.findByText("No hay cambios esperando una decisión.");
    fireEvent.change(screen.getByLabelText("Pasante"), { target: { value: "pupil-1" } });
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Proponer reglas" }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
        action: "enviar las correcciones",
        operation: "playbooks.import",
      }),
    );
    // What was typed is kept for another try.
    expect(screen.getByLabelText("Texto corregido")).toHaveValue("El arrendatario paga por adelantado.");
    fireEvent.click(screen.getByRole("button", { name: "Proponer reglas" }));
    await screen.findByText("Preparando las reglas propuestas…");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
    });
    expect(screen.getByText("Preparando las reglas propuestas…")).toBeVisible();
  });

  it("adds and removes corrections up to the limit", async () => {
    screenUnderTest();
    await screen.findByText("No hay cambios esperando una decisión.");
    expect(screen.queryByRole("button", { name: /Quitar la corrección/ })).toBeNull();
    const add = screen.getByRole("button", { name: "Agregar corrección" });
    for (let count = 1; count < MAX_CORRECTIONS; count += 1) fireEvent.click(add);
    expect(screen.getAllByLabelText("Texto corregido")).toHaveLength(MAX_CORRECTIONS);
    expect(add).toBeDisabled();
    expect(screen.getByText("Hasta 10 correcciones a la vez.")).toBeVisible();
    await fill(9, "Última");
    fireEvent.click(screen.getByRole("button", { name: "Quitar la corrección 1" }));
    expect(screen.getAllByLabelText("Texto corregido")).toHaveLength(MAX_CORRECTIONS - 1);
    expect(screen.getAllByLabelText("Texto corregido")[MAX_CORRECTIONS - 2]).toHaveValue("Última");
    expect(add).toBeEnabled();
  });

  it("shows each pending change in full, with its source, and blocks sending more", async () => {
    vi.mocked(api.listPlaybookChanges).mockResolvedValue([
      change(),
      change({ id: "change-2", op: "add_rule", before: null, after: rule({ name: LONG, origin: undefined }), rationale: "", source: "starting_point" }),
      change({ id: "change-3", op: "remove_rule", after: null }),
      change({ id: "change-4", status: "accepted" }),
    ]);
    screenUnderTest();
    expect(await screen.findByText("Decide cada cambio propuesto antes de enviar más correcciones.")).toBeVisible();
    const cards = screen.getAllByRole("listitem").filter((item) => item.tagName === "LI" && item.querySelector("h3"));
    expect(cards).toHaveLength(3);
    const first = within(cards[0]);
    expect(first.getByText("Cambio a una regla")).toBeVisible();
    expect(first.getByText("Corrección de Lucía Ortega")).toBeVisible();
    expect(first.getByText(/La renta se paga por adelantado\./, { selector: "p" })).toBeVisible();
    const before = first.getByRole("region", { name: "Antes" });
    const after = first.getByRole("region", { name: "Después" });
    expect(within(before).getByText("La renta se paga por mensualidades vencidas.")).toBeVisible();
    expect(within(after).getByText("La renta se paga por mensualidades adelantadas.")).toBeVisible();
    expect(within(after).getByText("Estándar: Mes adelantado")).toBeVisible();
    expect(within(after).getByText("La renta se pagará por adelantado.")).toBeVisible();
    expect(within(after).getByText("Alterna: Quincena adelantada")).toBeVisible();
    expect(within(after).getByText("Vencida: Pago al vencimiento")).toBeVisible();
    expect(within(after).getByText("Contrato de más de un año")).toBeVisible();
    expect(within(after).getByText("Si no aceptan: Escalar al socio")).toBeVisible();
    expect(within(after).getByText("Avisar")).toBeVisible();
    expect(within(before).queryByText("Orientación")).toBeNull();
    // A rule added without a correction says it comes from no correction.
    expect(within(cards[1]).getByText("Regla nueva")).toBeVisible();
    expect(within(cards[1]).getByText("De una corrección")).toBeVisible();
    expect(within(cards[1]).getByRole("heading", { name: LONG })).toBeVisible();
    expect(within(cards[1]).queryByText("Por qué")).toBeNull();
    // A removed rule has nothing after it.
    expect(within(cards[2]).getByText("Quitar una regla")).toBeVisible();
    expect(within(within(cards[2]).getByRole("region", { name: "Después" })).getByText("Ninguno")).toBeVisible();
    expect(screen.getByRole("button", { name: "Proponer reglas" })).toBeDisabled();
  });

  it("accepts a change, rewriting the page's playbook, and rejects another without touching it", async () => {
    vi.mocked(api.listPlaybookChanges)
      .mockResolvedValueOnce([change(), change({ id: "change-2", op: "remove_rule", after: null })])
      .mockResolvedValueOnce([change({ id: "change-2", op: "remove_rule", after: null })])
      .mockResolvedValue([]);
    const saved = { id: PLAYBOOK } as api.Playbook;
    vi.mocked(api.decidePlaybookChange)
      .mockResolvedValueOnce({ playbook: saved, change: change({ status: "accepted" }) })
      .mockResolvedValueOnce({ playbook: saved, change: change({ id: "change-2", op: "remove_rule", after: null, status: "rejected" }) });
    screenUnderTest();
    await screen.findAllByRole("heading", { name: "Forma de pago", level: 3 });

    fireEvent.click(screen.getAllByRole("button", { name: "Aceptar" })[0]);
    await waitFor(() => expect(api.decidePlaybookChange).toHaveBeenCalledWith(PLAYBOOK, "change-1", "accept"));
    await waitFor(() => expect(onPlaybookChanged).toHaveBeenCalledWith(saved));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ tone: "success", title: "Cambio aceptado." }));

    fireEvent.click(await screen.findByRole("button", { name: "Rechazar" }));
    await waitFor(() => expect(api.decidePlaybookChange).toHaveBeenCalledWith(PLAYBOOK, "change-2", "reject"));
    expect(showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Cambio rechazado." }));
    expect(onPlaybookChanged).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("No hay cambios esperando una decisión.")).toBeVisible();
  });

  it("reports a stale or failed decision and reloads what is still pending", async () => {
    vi.mocked(api.listPlaybookChanges).mockResolvedValue([change()]);
    vi.mocked(api.decidePlaybookChange).mockRejectedValue(Object.assign(new Error("stale"), { code: "playbook_change_stale" }));
    screenUnderTest();
    await screen.findByRole("heading", { name: "Forma de pago", level: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
        action: "aceptar el cambio",
        operation: "playbooks.save",
      }),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Rechazar" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Rechazar" }));
    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
        action: "rechazar el cambio",
        operation: "playbooks.save",
      }),
    );
    expect(api.listPlaybookChanges).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Aceptar" })).toBeEnabled();
  });

  it("reports a list that does not load and shows no changes", async () => {
    vi.mocked(api.listPlaybookChanges).mockRejectedValue(new Error("down"));
    screenUnderTest();
    expect(await screen.findByText("No hay cambios esperando una decisión.")).toBeVisible();
    expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
      action: "cargar los cambios propuestos",
      operation: "playbooks.save",
    });
  });

  it("is read-only while the page is busy", async () => {
    screenUnderTest({ disabled: true });
    await screen.findByText("No hay cambios esperando una decisión.");
    expect(screen.getByLabelText("Pasante")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "claude-opus-5" } });
    expect(screen.getByRole("button", { name: "Proponer reglas" })).toBeDisabled();
  });

  it("changes the model through the page", async () => {
    screenUnderTest({ models: [{ value: "claude-opus-5", label: "Claude Opus 5" }, { value: "gpt-5", label: "GPT-5" }] });
    await screen.findByText("No hay cambios esperando una decisión.");
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "gpt-5" } });
    expect(onModelChange).toHaveBeenCalledWith("gpt-5");
  });

  it("does not update after it is gone", async () => {
    let settle: (value: api.PlaybookChange[]) => void = () => undefined;
    vi.mocked(api.listPlaybookChanges).mockReturnValue(new Promise((resolve) => (settle = resolve)));
    const view = screenUnderTest();
    view.unmount();
    await act(async () => settle([change()]));
    expect(notifyError).not.toHaveBeenCalled();
  });

  it("does not report a load failure after it is gone", async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.mocked(api.listPlaybookChanges).mockReturnValue(new Promise((_, reject) => (fail = reject)));
    const view = screenUnderTest();
    view.unmount();
    await act(async () => fail(new Error("late")));
    expect(notifyError).toHaveBeenCalledTimes(1);
  });
});

describe("a rule that came from a correction", () => {
  const provenance = { answers: {}, sourceNames: {} };
  const ruleOf = (origin: api.PlaybookRuleOrigin) => rule({ origin });

  it("names who made the correction, or just that it was one", () => {
    render(
      <IntlClientProvider locale="es-MX" messages={esMX}>
        <PlaybookRuleOrigin
          rule={ruleOf({ kind: "correction", attributedTo: "Lucía Ortega", unbacked: false })}
          provenance={provenance}
        />
        <PlaybookRuleOrigin rule={ruleOf({ kind: "correction", unbacked: false })} provenance={provenance} />
      </IntlClientProvider>,
    );
    expect(screen.getByText("Origen: corrección de Lucía Ortega")).toBeVisible();
    expect(screen.getByText("Origen: corrección")).toBeVisible();
    expect(screen.queryByText("Sugerencia sin respaldo, revisar")).toBeNull();
  });
});

describe("the Corrections view in the toolbar", () => {
  const base = {
    disabled: false,
    canEdit: true,
    view: "rules" as const,
    onAddRule: vi.fn(),
    onUpload: vi.fn(),
    onNewRun: vi.fn(),
  };

  it("is offered only with a label, and selects itself", () => {
    window.matchMedia ??= vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    const onViewChange = vi.fn();
    const { rerender } = render(<PlaybookToolbar {...base} onViewChange={onViewChange} />);
    expect(screen.queryByRole("button", { name: "Correcciones" })).toBeNull();
    rerender(<PlaybookToolbar {...base} onViewChange={onViewChange} correctionsLabel="Correcciones" />);
    fireEvent.click(screen.getByRole("button", { name: "Correcciones" }));
    expect(onViewChange).toHaveBeenCalledWith("corrections");
    rerender(<PlaybookToolbar {...base} view="corrections" onViewChange={onViewChange} correctionsLabel="Correcciones" />);
    expect(screen.queryByRole("button", { name: "New rule" })).toBeNull();
  });
});

describe("the people the caller supervises", () => {
  function Probe({ orgId, enabled }: { orgId: string | null; enabled: boolean }) {
    const pupils = usePlaybookCorrectionPupils(orgId, enabled);
    return <p data-testid="pupils">{pupils.map((pupil) => pupil.label).join("|")}</p>;
  }

  it("names them from the roster, by name, address or id", async () => {
    vi.mocked(api.getMyPupils).mockResolvedValue({
      pupils: [{ user_id: "p1" }, { user_id: "p2" }, { user_id: "p3" }],
    } as never);
    vi.mocked(api.listOrgMembers).mockResolvedValue([
      { user_id: "p1", display_name: "Luis Pasante", email: "luis@x.mx" },
      { user_id: "p2", display_name: "", email: "eva@x.mx" },
    ] as never);
    render(<Probe orgId="org-1" enabled />);
    await waitFor(() => expect(screen.getByTestId("pupils").textContent).toBe("Luis Pasante|eva@x.mx|p3"));
  });

  it("has none for someone who is not a mentor, who cannot edit, or outside an organization", async () => {
    vi.mocked(api.getMyPupils).mockRejectedValue(new Error("403"));
    vi.mocked(api.listOrgMembers).mockResolvedValue([]);
    const { rerender } = render(<Probe orgId="org-1" enabled />);
    await waitFor(() => expect(api.getMyPupils).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("pupils").textContent).toBe("");
    rerender(<Probe orgId="org-1" enabled={false} />);
    rerender(<Probe orgId={null} enabled />);
    expect(api.getMyPupils).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("pupils").textContent).toBe("");
  });

  it("ignores an answer that arrives after the organization changed", async () => {
    let settle: (value: unknown) => void = () => undefined;
    vi.mocked(api.getMyPupils).mockReturnValue(new Promise((resolve) => (settle = resolve)) as never);
    vi.mocked(api.listOrgMembers).mockResolvedValue([]);
    const { unmount } = render(<Probe orgId="org-1" enabled />);
    unmount();
    await act(async () => settle({ pupils: [{ user_id: "p1" }] }));
    vi.mocked(api.getMyPupils).mockReturnValue(new Promise((_, reject) => (settle = reject)) as never);
    const second = render(<Probe orgId="org-2" enabled />);
    second.unmount();
    await act(async () => settle(new Error("late")));
  });
});
