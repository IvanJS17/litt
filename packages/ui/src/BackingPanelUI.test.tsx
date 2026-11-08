import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrainingBackingCheck, TrainingBackingConclusion } from "@mike/contracts";
import { BackingPanelUI, type BackingPanelLabels } from "./BackingPanelUI";

const labels: BackingPanelLabels = {
  title: "Tus conclusiones y su fuente",
  intro: "El asistente propuso en qué cita se apoya cada conclusión.",
  listLabel: "Conclusiones de esta respuesta",
  pending: "Revisando las conclusiones…",
  failed: "No se pudieron revisar las conclusiones.",
  privacy: "Privado: solo tú y tu mentor lo ven",
  status: { backed: "Respaldada", unbacked: "Sin respaldo", citation_unverified: "Cita sin verificar" },
  statusHelp: {
    backed: "LiTT encontró este pasaje en un documento.",
    unbacked: "Ninguna cita de un documento de LiTT la respalda.",
    citation_unverified: "LiTT no encontró el texto citado en el documento.",
  },
  citationRef: (ref) => `Cita ${ref}`,
  passageLabel: "Pasaje exacto",
  passageSource: ({ title, page }) => `${title ?? "Documento citado"}${page == null ? "" : `, página ${page}`}`,
  unverifiedReferences: (references) => `Sin verificar: ${references}. Confírmalo en la fuente oficial.`,
  verified: "Lo verifiqué",
  reasonLabel: "Por qué la conservas",
  reasonHint: (max) => `Opcional, hasta ${max} caracteres.`,
  reasonSave: "Guardar motivo",
  saving: "Guardando…",
  saved: "Motivo guardado",
  personVerified: "La persona la verificó",
  personNotVerified: "La persona no la ha marcado como verificada",
  personReason: "Por qué la conserva",
};

const conclusion = (over: Partial<TrainingBackingConclusion>): TrainingBackingConclusion => ({
  id: "c1",
  text: "El plazo es de tres años",
  citation_ref: null,
  status: "unbacked",
  passage: null,
  unverified_references: [],
  person_verified: false,
  person_note: null,
  ...over,
});

const check = (conclusions: TrainingBackingConclusion[] | null, status: TrainingBackingCheck["status"] = "ready") => ({
  id: "check-1",
  status,
  conclusions,
});

const BACKED = conclusion({
  id: "c1",
  citation_ref: 1,
  status: "backed",
  passage: { ref: 1, title: "contrato.docx", page: 3, excerpt: "El plazo es de tres años." },
});
const UNVERIFIED = conclusion({ id: "c2", text: "La demanda prescribió", citation_ref: 2, status: "citation_unverified" });
const UNBACKED = conclusion({
  id: "c3",
  text: "Aplica el artículo 2000",
  unverified_references: ["art. 2000"],
});

describe("BackingPanelUI", () => {
  it("shows each status in words and an icon, never by colour alone, with the exact passage only when backed", () => {
    render(<BackingPanelUI check={check([BACKED, UNVERIFIED, UNBACKED])} labels={labels} />);
    const region = screen.getByRole("region", { name: "Tus conclusiones y su fuente" });
    const items = within(screen.getByRole("list", { name: "Conclusiones de esta respuesta" })).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Respaldada")).toBeInTheDocument();
    expect(within(items[0]).getByText("Pasaje exacto · contrato.docx, página 3")).toBeInTheDocument();
    expect(within(items[0]).getByText("El plazo es de tres años.")).toBeInTheDocument();
    expect(within(items[1]).getByText(/Cita sin verificar · Cita 2/)).toBeInTheDocument();
    expect(within(items[1]).queryByText("Pasaje exacto", { exact: false })).toBeNull();
    expect(within(items[2]).getByText("Sin respaldo")).toBeInTheDocument();
    expect(within(items[2]).getByText("Sin verificar: art. 2000. Confírmalo en la fuente oficial.")).toBeInTheDocument();
    expect(items[0].querySelector("svg[aria-hidden='true']")).not.toBeNull();
    expect(within(region).getByText("Privado: solo tú y tu mentor lo ven")).toBeInTheDocument();
    expect(within(region).getByText(labels.intro)).toBeInTheDocument();
  });

  it("says the check is running, or that it failed, and draws nothing without conclusions", () => {
    const { rerender, container } = render(<BackingPanelUI check={check(null, "pending")} labels={labels} />);
    expect(screen.getByRole("status")).toHaveTextContent("Revisando las conclusiones…");
    rerender(<BackingPanelUI check={check(null, "failed")} labels={labels} />);
    expect(screen.getByText("No se pudieron revisar las conclusiones.")).toBeInTheDocument();
    rerender(<BackingPanelUI check={check([])} labels={labels} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<BackingPanelUI check={check(null)} labels={labels} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks «lo verifiqué» from a labelled checkbox that names its conclusion", async () => {
    const onMark = vi.fn().mockResolvedValue(undefined);
    render(<BackingPanelUI check={check([BACKED])} labels={labels} onMark={onMark} />);
    const box = screen.getByRole("checkbox", { name: "Lo verifiqué" });
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription("El plazo es de tres años");
    fireEvent.click(box);
    await waitFor(() => expect(onMark).toHaveBeenCalledWith("c1", { person_verified: true }));
  });

  it("offers a reason only for a conclusion without backing, saves it trimmed and says so", async () => {
    const onMark = vi.fn().mockResolvedValue(undefined);
    render(<BackingPanelUI check={check([BACKED, UNBACKED])} labels={labels} onMark={onMark} />);
    // Backed: no reason field.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    const field = screen.getByRole("textbox", { name: "Por qué la conservas" });
    expect(field).toHaveAccessibleDescription("Opcional, hasta 500 caracteres.");
    const save = screen.getByRole("button", { name: "Guardar motivo" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(save);
    expect(onMark).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "  La cláusula 5 lo confirma  " } });
    expect(save).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(save);
    await waitFor(() => expect(onMark).toHaveBeenCalledWith("c3", { person_note: "La cláusula 5 lo confirma" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Motivo guardado"));
  });

  it("keeps what the person typed when saving fails", async () => {
    const onMark = vi.fn().mockRejectedValue(new Error("boom"));
    render(<BackingPanelUI check={check([UNBACKED])} labels={labels} onMark={onMark} />);
    const field = screen.getByRole("textbox", { name: "Por qué la conservas" });
    fireEvent.change(field, { target: { value: "mi motivo" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar motivo" }));
    await waitFor(() => expect(onMark).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar motivo" })).toHaveAttribute("aria-disabled", "false"));
    expect(field).toHaveValue("mi motivo");
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("shows a saved reason and a clear field to empty it", async () => {
    const onMark = vi.fn().mockResolvedValue(undefined);
    render(<BackingPanelUI check={check([{ ...UNBACKED, person_note: "ya lo expliqué" }])} labels={labels} onMark={onMark} />);
    const field = screen.getByRole("textbox", { name: "Por qué la conservas" });
    expect(field).toHaveValue("ya lo expliqué");
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar motivo" }));
    await waitFor(() => expect(onMark).toHaveBeenCalledWith("c3", { person_note: null }));
  });

  it("is read-only for the mentor: the person's mark and reason, no controls", () => {
    render(
      <BackingPanelUI
        readOnly
        heading="Respuesta del 8 nov 2026"
        check={check([
          { ...UNBACKED, person_verified: true, person_note: "porque lo dice el contrato" },
          { ...BACKED, id: "c4" },
        ])}
        labels={labels}
      />,
    );
    expect(screen.getByRole("heading", { name: "Respuesta del 8 nov 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(labels.intro)).toBeNull();
    expect(screen.getByText("La persona la verificó")).toBeInTheDocument();
    expect(screen.getByText("La persona no la ha marcado como verificada")).toBeInTheDocument();
    expect(screen.getByText(/porque lo dice el contrato/)).toBeInTheDocument();
  });

  it("lets long unbroken text wrap instead of overflowing", () => {
    const long = "x".repeat(400);
    render(
      <BackingPanelUI
        check={check([{ ...BACKED, text: long, passage: { ref: 1, title: long, page: null, excerpt: long } }])}
        labels={labels}
      />,
    );
    for (const element of screen.getAllByText(long, { exact: false })) {
      expect(element.className).toContain("break-words");
    }
  });
});
