import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelOption } from "@/shared/lib/modelCatalog";
import { getSubagentRoutes, updateSubagentRoutes } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { SubagentRoutesSection } from "./SubagentRoutesSection";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getSubagentRoutes: vi.fn(),
  updateSubagentRoutes: vi.fn(),
}));

vi.mock("@/app/lib/userFacingError", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/userFacingError")>()),
  notifyError: vi.fn(),
}));

const models: ModelOption[] = [
  { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", group: "Gemini" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", group: "Anthropic" },
];

const saved = {
  routes: [
    { name: "rapida", description: "Extrae datos.", model: "gemini-3.8-flash" },
  ],
  default: null,
};

/** A plain select stands in for the page's model dropdown. */
const modelPicker = (value: string, onChange: (id: string) => void) => (
  <select aria-label="Modelo" value={value} onChange={(e) => onChange(e.target.value)}>
    <option value="">Elige un modelo</option>
    {models.map((m) => (
      <option key={m.id} value={m.id}>
        {m.label}
      </option>
    ))}
  </select>
);

const renderSection = () =>
  render(<SubagentRoutesSection models={models} modelPicker={modelPicker} />);

beforeEach(() => {
  vi.mocked(getSubagentRoutes).mockReset().mockResolvedValue(saved);
  vi.mocked(updateSubagentRoutes).mockReset().mockImplementation(async (routes) => routes);
  vi.mocked(notifyError).mockReset();
});

describe("SubagentRoutesSection", () => {
  it("lists each route with its description and provider, model and reasoning", async () => {
    renderSection();

    const route = await screen.findByRole("listitem");
    expect(within(route).getByText("rapida")).toBeInTheDocument();
    expect(within(route).getByText("Extrae datos.")).toBeInTheDocument();
    expect(within(route).getByText("Gemini · Gemini 3.8 Flash · razonamiento según la tarea")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ninguna: usan el modelo de la conversación/ })).toBeInTheDocument();
  });

  it("adds a route and saves the whole list", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Agregar ruta" }));
    await user.type(screen.getByLabelText("Nombre"), "profunda");
    await user.type(screen.getByLabelText("Descripción"), "Análisis jurídico cuidadoso.");
    await user.selectOptions(screen.getByLabelText("Modelo"), "claude-opus-5-5");
    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    await waitFor(() =>
      expect(updateSubagentRoutes).toHaveBeenCalledWith({
        routes: [
          ...saved.routes,
          { name: "profunda", description: "Análisis jurídico cuidadoso.", model: "claude-opus-5-5" },
        ],
        default: null,
      }),
    );
    expect(await screen.findByText("Anthropic · Claude Opus 5.5 · razonamiento según la tarea")).toBeInTheDocument();
  });

  it("refuses a name outside lowercase letters, digits and hyphens before saving", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Agregar ruta" }));
    await user.type(screen.getByLabelText("Nombre"), "Profunda");
    await user.type(screen.getByLabelText("Descripción"), "Algo.");
    await user.selectOptions(screen.getByLabelText("Modelo"), "claude-opus-5-5");
    await user.click(screen.getByRole("button", { name: "Guardar ruta" }));

    expect(screen.getByRole("alert")).toHaveTextContent("minúsculas");
    expect(updateSubagentRoutes).not.toHaveBeenCalled();
  });

  it("deletes a route, and clears the default that pointed at it", async () => {
    vi.mocked(getSubagentRoutes).mockResolvedValue({ ...saved, default: "rapida" });
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Borrar la ruta rapida" }));

    await waitFor(() =>
      expect(updateSubagentRoutes).toHaveBeenCalledWith({ routes: [], default: null }),
    );
  });

  it("shows a route whose model left the catalog as unavailable, also as the default", async () => {
    vi.mocked(getSubagentRoutes).mockResolvedValue({
      routes: [
        { name: "vieja", description: "Ya no corre.", model: "retired-model-1", unavailable: true },
      ],
      default: "vieja",
    });
    renderSection();

    const route = await screen.findByRole("listitem");
    expect(
      within(route).getByText(
        "retired-model-1 · no disponible: el modelo ya no se ofrece; edítala o bórrala · razonamiento según la tarea",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "vieja (no disponible)", pressed: true }),
    ).toBeInTheDocument();
  });

  it("names the reasoning level in Spanish, in the list and in the editor", async () => {
    vi.mocked(getSubagentRoutes).mockResolvedValue({
      routes: [{ ...saved.routes[0], reasoning: "xhigh" }],
      default: null,
    });
    const user = userEvent.setup();
    renderSection();

    expect(
      await screen.findByText("Gemini · Gemini 3.8 Flash · razonamiento muy alto"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editar la ruta rapida" }));
    const options = within(screen.getByLabelText("Razonamiento"))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toEqual(["Según la tarea", "Ninguno", "Bajo", "Medio", "Alto", "Muy alto", "Máximo"]);
  });

  it("reports a failed load through the shared error popup", async () => {
    const failure = new Error("boom");
    vi.mocked(getSubagentRoutes).mockRejectedValue(failure);
    renderSection();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ action: "load the subagent routes" }),
      ),
    );
    expect(screen.getByText(/No se pudieron cargar las rutas de subagentes/)).toBeInTheDocument();
  });

  it("keeps the saved routes and reports the failure when a save fails", async () => {
    vi.mocked(updateSubagentRoutes).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole("button", { name: "Borrar la ruta rapida" }));

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(within(screen.getByRole("listitem")).getByText("rapida")).toBeInTheDocument();
  });
});
