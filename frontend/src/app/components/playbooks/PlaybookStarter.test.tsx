// LiTT playbooks with a starting point, layer 1 (T4): a drafted rule shows
// where it comes from, a draft confirms before it is marked ready, models
// come first when starting a playbook, and the questionnaire is all optional.
import type { ReactNode } from "react";
import { fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import {
  getPlaybook,
  getPlaybookQuestionnaire,
  listPlaybookSources,
  type Playbook,
  type PlaybookContent,
  type PlaybookRule,
} from "@/app/lib/mikeApi";
import { NewPlaybookMenu, playbookModels } from "./NewPlaybookMenu";
import { PlaybookDraftBanner } from "./PlaybookDraftBanner";
import { PlaybookIntakeModal } from "./PlaybookIntakeModal";
import { PlaybookRuleOrigin } from "./PlaybookRuleOrigin";
import { NO_PROVENANCE, provenanceCounts, usePlaybookProvenance } from "./usePlaybookProvenance";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getPlaybook: vi.fn(),
  getPlaybookQuestionnaire: vi.fn(),
  listPlaybookSources: vi.fn(),
}));

vi.mock("@/app/components/modals/AddDocumentsModal", () => ({
  AddDocumentsModal: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (documents: unknown[]) => void;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => onSelect([{ id: "doc-1", filename: "Cláusulas.pdf", file_type: "pdf" }])}
      >
        Choose saved clauses
      </button>
    ) : null,
}));

function Spanish({ children }: { children: ReactNode }) {
  return (
    <IntlClientProvider locale="es-MX" messages={esMX}>
      {children}
    </IntlClientProvider>
  );
}

const rule = (overrides: Partial<PlaybookRule> = {}): PlaybookRule => ({
  id: "r1",
  name: "Pena convencional",
  concept: "La pena no excede un mes de renta.",
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
});

const content = (rules: PlaybookRule[]): PlaybookContent => ({
  name: "Arrendamientos",
  description: "",
  representedParty: "",
  documentTypes: [],
  jurisdictions: [],
  rules: rules.slice(0, 1),
  topics: [{ id: "t1", name: "Renta", rules: rules.slice(1) }],
});

const QUESTIONNAIRE = {
  questions: Array.from({ length: 10 }, (_, index) => ({
    id: `q${index + 1}`,
    text: `Pregunta del servidor ${index + 1}`,
  })),
  maxAnswerChars: 4000,
  maxAnswersChars: 30,
  maxAttachments: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlaybookQuestionnaire).mockResolvedValue(QUESTIONNAIRE);
});

describe("a drafted rule's origin", () => {
  it("shows the answer it rests on, the clause it quotes and each reference's check", () => {
    render(
      <>
        <PlaybookRuleOrigin
          rule={rule({
            origin: { kind: "answer", questionIds: ["q6", "q7"], unbacked: false, note: "Ver q6." },
            legalRefs: [
              { text: "Art. 1840 CCF", verified: false },
              { text: "Cláusula 4", verified: true, sourceId: "s1" },
            ],
          })}
          provenance={{ answers: { q6: "Nunca más de un mes." }, sourceNames: {} }}
        />
        <PlaybookRuleOrigin
          rule={rule({ origin: { kind: "clause", sourceId: "s1", quote: "un mes de renta", unbacked: false } })}
          provenance={{ answers: {}, sourceNames: { s1: "Cláusulas.docx" } }}
        />
      </>,
    );
    expect(screen.getByText("Origin: answer to questions 6, 7")).toBeVisible();
    expect(screen.getByText("Answer to question 6")).toBeVisible();
    expect(screen.getByText("Nunca más de un mes.")).toBeVisible();
    // An answer the editor cannot see is left out, never invented.
    expect(screen.queryByText("Answer to question 7")).toBeNull();
    expect(screen.getByText("Ver q6.")).toBeVisible();
    expect(screen.getByText("Not verified")).toBeVisible();
    expect(screen.getByText(/Verified in an attached document/)).toBeVisible();
    expect(screen.getByText("Origin: attached clause Cláusulas.docx")).toBeVisible();
    expect(screen.getByText("un mes de renta")).toBeVisible();
    expect(screen.queryByText("Suggestion without backing, review")).toBeNull();
  });

  it("marks general practice as without backing, in Spanish for es-MX", () => {
    render(
      <PlaybookRuleOrigin
        rule={rule({
          origin: { kind: "ai_general", unbacked: true },
          legalRefs: [{ text: "Art. 2448 CCF", verified: false }],
        })}
        provenance={NO_PROVENANCE}
      />,
      { wrapper: Spanish },
    );
    expect(screen.getByText(/Origen: práctica general sugerida por la IA/)).toBeVisible();
    expect(screen.getByText("Sugerencia sin respaldo, revisar")).toBeVisible();
    expect(screen.getByText("No verificado")).toBeVisible();
    // The rule's own legal text is not translated.
    expect(screen.getByText(/Art\. 2448 CCF/)).toBeVisible();
  });

  it("names an attached clause it cannot find, and shows nothing for a rule a person wrote", () => {
    const { container, rerender } = render(
      <PlaybookRuleOrigin
        rule={rule({ origin: { kind: "clause", sourceId: "gone", unbacked: false } })}
        provenance={NO_PROVENANCE}
      />,
    );
    expect(screen.getByText("Origin: attached clause")).toBeVisible();
    rerender(<PlaybookRuleOrigin rule={rule({ origin: { kind: "answer", unbacked: false } })} provenance={NO_PROVENANCE} />);
    expect(screen.getByText("Origin: answer to questions")).toBeVisible();
    rerender(<PlaybookRuleOrigin rule={rule()} provenance={NO_PROVENANCE} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("what a draft's origins read", () => {
  const drafted = content([
    rule({ origin: { kind: "answer", questionIds: ["q6"], unbacked: false } }),
    rule({ id: "r2", origin: { kind: "clause", sourceId: "s1", unbacked: false } }),
    rule({ id: "r3", origin: { kind: "ai_general", unbacked: true }, legalRefs: [{ text: "Ley", verified: false }, { text: "Cl. 2", verified: true }] }),
  ]);

  it("counts the rules without backing and the unverified references", () => {
    expect(provenanceCounts(drafted)).toEqual({ unbacked: 1, unverified: 1 });
    expect(provenanceCounts({ ...drafted, rules: undefined, topics: [] })).toEqual({ unbacked: 0, unverified: 0 });
  });

  it("reads the answers for an editor and the document names for anyone", async () => {
    vi.mocked(getPlaybook).mockResolvedValue({ intake: { answers: { q6: "Respuesta" } } } as unknown as Playbook);
    vi.mocked(listPlaybookSources).mockResolvedValue([
      { id: "s1", filename: "Cláusulas.docx" } as never,
    ]);
    const { result, rerender } = renderHook(
      ({ canEdit }) => usePlaybookProvenance({ id: "pb", canEdit, content: drafted }),
      { initialProps: { canEdit: true } },
    );
    await waitFor(() =>
      expect(result.current).toEqual({ answers: { q6: "Respuesta" }, sourceNames: { s1: "Cláusulas.docx" } }),
    );
    expect(getPlaybook).toHaveBeenCalledWith("pb");

    // A viewer is not given the answers, so they are not asked for.
    vi.mocked(getPlaybook).mockClear();
    rerender({ canEdit: false });
    await waitFor(() => expect(result.current.answers).toEqual({}));
    expect(getPlaybook).not.toHaveBeenCalled();
  });

  it("asks for nothing for a playbook without drafted rules, and survives failed reads", async () => {
    const { result, rerender } = renderHook(
      ({ playbook }) => usePlaybookProvenance(playbook),
      {
        initialProps: {
          playbook: { id: "plain", canEdit: true, content: content([rule()]) } as Pick<Playbook, "id" | "canEdit" | "content"> | null,
        },
      },
    );
    expect(result.current).toBe(NO_PROVENANCE);
    rerender({ playbook: null });
    expect(getPlaybook).not.toHaveBeenCalled();
    expect(listPlaybookSources).not.toHaveBeenCalled();

    vi.mocked(getPlaybook).mockRejectedValue(new Error("offline"));
    vi.mocked(listPlaybookSources).mockRejectedValue(new Error("offline"));
    rerender({ playbook: { id: "pb", canEdit: true, content: drafted } });
    await waitFor(() => expect(listPlaybookSources).toHaveBeenCalled());
    await waitFor(() => expect(result.current).toEqual({ answers: {}, sourceNames: {} }));

    vi.mocked(getPlaybook).mockResolvedValue({ intake: null } as unknown as Playbook);
    rerender({ playbook: { id: "pb2", canEdit: true, content: content([rule({ origin: { kind: "answer", questionIds: ["q1"], unbacked: false } })]) } });
    await waitFor(() => expect(getPlaybook).toHaveBeenCalledWith("pb2"));
    expect(listPlaybookSources).not.toHaveBeenCalledWith("pb2");
  });
});

describe("the draft line", () => {
  const drafted = content([
    rule({ origin: { kind: "ai_general", unbacked: true } }),
    rule({ id: "r2", origin: { kind: "ai_general", unbacked: true }, legalRefs: [{ text: "Ley", verified: false }] }),
  ]);

  it("confirms with the counts before an editor marks it ready", async () => {
    const onMarkReady = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<PlaybookDraftBanner content={drafted} canEdit disabled={false} onMarkReady={onMarkReady} />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Draft: it can't be used in reviews until an editor marks it as ready.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Mark as ready" }));
    const dialog = await screen.findByRole("dialog", { name: "Mark as ready?" });
    expect(dialog).toHaveTextContent("2 rules have no backing and 1 legal reference is not verified.");
    expect(onMarkReady).not.toHaveBeenCalled();

    // A failed attempt keeps the question open; the caller said why.
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as ready" }));
    await waitFor(() => expect(onMarkReady).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("dialog", { name: "Mark as ready?" })).toBeVisible();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mark as ready" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onMarkReady).toHaveBeenCalledTimes(2);
  });

  it("can be declined, and offers nothing to someone who cannot edit", async () => {
    const onMarkReady = vi.fn();
    const { rerender } = render(
      <PlaybookDraftBanner content={drafted} canEdit disabled={false} onMarkReady={onMarkReady} />,
      { wrapper: Spanish },
    );
    await userEvent.click(screen.getByRole("button", { name: "Marcar como listo" }));
    const dialog = await screen.findByRole("dialog", { name: "¿Marcar como listo?" });
    expect(dialog).toHaveTextContent("2 reglas no tienen respaldo y 1 referencia legal no está verificada.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onMarkReady).not.toHaveBeenCalled();

    rerender(<PlaybookDraftBanner content={drafted} canEdit={false} disabled={false} onMarkReady={onMarkReady} />);
    expect(screen.getByRole("note")).toHaveTextContent("Borrador:");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the New playbook menu", () => {
  const book = (id: string, overrides: Partial<Playbook>) =>
    ({ id, name: id, isModel: false, status: "ready", updatedAt: "2026-11-01T00:00:00Z", ...overrides }) as Playbook;

  it("lists only ready models, most recent first", () => {
    expect(
      playbookModels([
        book("old", { isModel: true, updatedAt: "2026-10-01T00:00:00Z" }),
        book("plain", {}),
        book("new", { isModel: true, updatedAt: "2026-11-05T00:00:00Z" }),
        book("draft", { isModel: true, status: "draft" }),
      ]).map((playbook) => playbook.id),
    ).toEqual(["new", "old"]);
  });

  it("puts the models first, then the ways to start one, in Spanish for es-MX", async () => {
    const onModel = vi.fn();
    const onQuestions = vi.fn();
    render(
      <NewPlaybookMenu
        disabled={false}
        models={[book("Arrendamiento comercial modelo con un nombre largo", { isModel: true })]}
        onModel={onModel}
        onQuestions={onQuestions}
        onImport={vi.fn()}
        onBlank={vi.fn()}
      />,
      { wrapper: Spanish },
    );
    await userEvent.click(screen.getByRole("button", { name: "Nuevo playbook" }));
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Arrendamiento comercial modelo con un nombre largo",
      "Con preguntas",
      "Importar archivo",
      "Desde cero",
    ]);
    expect(screen.getByText("Modelos")).toBeVisible();
    await userEvent.click(items[0]);
    expect(onModel).toHaveBeenCalledWith(expect.objectContaining({ id: "Arrendamiento comercial modelo con un nombre largo" }));
  });

  it("has no Models section when the workspace has none", async () => {
    render(
      <NewPlaybookMenu disabled={false} models={[]} onModel={vi.fn()} onQuestions={vi.fn()} onImport={vi.fn()} onBlank={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "New playbook" }));
    expect(await screen.findByRole("menuitem", { name: "With questions" })).toBeVisible();
    expect(screen.queryByText("Models")).toBeNull();
  });
});

describe("the questionnaire", () => {
  const MODELS = [{ value: "model-a", label: "Model A" }];

  function intake(overrides: Partial<Parameters<typeof PlaybookIntakeModal>[0]> = {}) {
    const props = {
      open: true,
      organizationName: null,
      models: MODELS,
      model: "model-a",
      onModelChange: vi.fn(),
      onClose: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(true),
      ...overrides,
    };
    return { props, view: render(<PlaybookIntakeModal {...props} />) };
  }

  it("asks the ten questions from the catalog, every one optional, and sends only the answered ones", async () => {
    const { props } = intake();
    expect(screen.getByRole("status", { name: "Loading the questions…" })).toBeVisible();
    const sixth = await screen.findByLabelText(/Red lines: what this client never accepts\./);
    expect(screen.getAllByRole("textbox")).toHaveLength(11);
    expect(screen.getByText("You can attach up to 2 .docx or .pdf documents.")).toBeVisible();
    // With nothing answered it may still be sent, with a warning.
    expect(screen.getByText(/You haven't answered any question/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Write draft" })).toBeEnabled();

    await userEvent.type(sixth, "  Nunca  ");
    await userEvent.type(screen.getByLabelText("Playbook name (optional)"), " Rentas ");
    expect(screen.queryByText(/You haven't answered any question/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Write draft" }));
    expect(props.onSubmit).toHaveBeenCalledWith({
      name: "Rentas",
      visibility: "private",
      answers: { q6: "Nunca" },
      attachments: [],
    });
  });

  it("uses the server's text for a question the catalog does not have", async () => {
    vi.mocked(getPlaybookQuestionnaire).mockResolvedValue({
      ...QUESTIONNAIRE,
      questions: [{ id: "q11", text: "Pregunta nueva del servidor" }],
    });
    intake();
    expect(await screen.findByLabelText(/Pregunta nueva del servidor/)).toBeVisible();
  });

  it("refuses more attachments than allowed and files that are not .docx or .pdf", async () => {
    const { props } = intake();
    await screen.findByLabelText(/Red lines/);
    const area = screen.getByRole("region", { name: "Preferred clauses (question 8)" });
    fireEvent.drop(area, {
      dataTransfer: { files: [new File(["x"], "notes.txt")], types: ["Files"] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Attach .docx or .pdf files.");
    const files = ["a.docx", "b.pdf", "c.docx"].map((name) => new File(["x"], name));
    fireEvent.drop(area, { dataTransfer: { files, types: ["Files"] } });
    expect(screen.getByRole("alert")).toHaveTextContent("You can attach up to 2 documents.");
    // The same file twice is one attachment.
    fireEvent.drop(area, { dataTransfer: { files: [files[0]], types: ["Files"] } });
    expect(within(area).getAllByRole("listitem")).toHaveLength(2);
    await userEvent.click(within(area).getAllByRole("button", { name: /Remove/ })[1]);
    expect(screen.queryByRole("alert")).toBeNull();

    await userEvent.click(within(area).getByRole("button", { name: /Drop more files here/ }));
    await userEvent.click(screen.getByRole("button", { name: "Choose saved clauses" }));
    await userEvent.click(await screen.findByRole("button", { name: "Write draft" }));
    expect(props.onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ attachments: [files[0], { documentId: "doc-1" }] }),
    );
  });

  it("refuses answers over the total limit, and needs a model", async () => {
    const onSubmit = vi.fn();
    const { view, props } = intake({ onSubmit });
    await userEvent.type(await screen.findByLabelText(/Red lines/), "x".repeat(31));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your answers add up to more than 30 characters. Shorten them.",
    );
    expect(screen.getByRole("button", { name: "Write draft" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText(/Red lines/).closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();

    view.rerender(<PlaybookIntakeModal {...props} models={[]} model="" />);
    expect(screen.getByRole("link", { name: "Configure an API key" })).toHaveAttribute("href", "/account/api-keys");
    expect(screen.getByRole("button", { name: "Write draft" })).toBeDisabled();
  });

  it("asks before discarding what was written, and closes at once when nothing was", async () => {
    const onClose = vi.fn();
    const { view, props } = intake({ onClose });
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await userEvent.type(screen.getByLabelText(/Red lines/), "Nunca");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const confirm = await screen.findByRole("dialog", { name: "Discard your answers?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/Red lines/)).toHaveValue("Nunca");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(
      within(await screen.findByRole("dialog", { name: "Discard your answers?" })).getByRole("button", { name: "Discard" }),
    );
    expect(onClose).toHaveBeenCalledTimes(2);
    view.rerender(<PlaybookIntakeModal {...props} />);
    expect(screen.getByLabelText(/Red lines/)).toHaveValue("");
  });

  it("offers a retry when the questions do not load, in an organization", async () => {
    vi.mocked(getPlaybookQuestionnaire)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(QUESTIONNAIRE);
    intake({ organizationName: "Socium" });
    expect(await screen.findByRole("alert")).toHaveTextContent("The questions couldn't be loaded.");
    expect(screen.getByRole("button", { name: "Write draft" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/Red lines/)).toBeVisible();
    expect(screen.getByRole("group", { name: "Organisational Access" })).toBeVisible();
  });

  it("is written in Spanish for es-MX", async () => {
    render(
      <PlaybookIntakeModal
        open
        organizationName={null}
        models={MODELS}
        model="model-a"
        onModelChange={vi.fn()}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
      { wrapper: Spanish },
    );
    expect(await screen.findByLabelText(/Líneas rojas: lo que este cliente nunca acepta\./)).toBeVisible();
    expect(screen.getByRole("button", { name: "Redactar borrador" })).toBeVisible();
    expect(screen.getByText(/No respondiste ninguna pregunta/)).toBeVisible();
  });
});
