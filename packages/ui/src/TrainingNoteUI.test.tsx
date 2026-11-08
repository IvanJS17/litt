import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrainingNoteUI } from "./TrainingNoteUI";

const base = { attempt: "Creo que procede la rescisión." };

describe("TrainingNoteUI", () => {
  it("shows the approach, the contrast and the privacy legend", () => {
    render(
      <TrainingNoteUI
        className="extra"
        note={{
          ...base,
          contrast: "Coincide: la cláusula quinta aplica.",
          contrast_status: "ready",
        }}
      />,
    );
    const region = screen.getByRole("region", {
      name: "Notas privadas de formación",
    });
    expect(region).toHaveClass("extra");
    expect(
      screen.getByRole("heading", { name: "Tu planteamiento" }),
    ).toBeInTheDocument();
    expect(screen.getByText(base.attempt)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Contraste con tu planteamiento" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Coincide: la cláusula quinta aplica."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Privado: solo tú y tu mentor lo ven"),
    ).toBeInTheDocument();
  });

  it("says the contrast is being generated", () => {
    render(
      <TrainingNoteUI note={{ ...base, contrast: null, contrast_status: "pending" }} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Generando contraste…",
    );
  });

  it.each([
    ["failed", null],
    ["ready", null],
  ] as const)("says the contrast failed (%s, %s)", (status, contrast) => {
    render(
      <TrainingNoteUI note={{ ...base, contrast, contrast_status: status }} />,
    );
    expect(
      screen.getByText("No se pudo generar el contraste"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("draws no contrast block for a turn with nothing to contrast", () => {
    render(
      <TrainingNoteUI note={{ ...base, contrast: null, contrast_status: "skipped" }} />,
    );
    expect(screen.getByText(base.attempt)).toBeInTheDocument();
    expect(screen.queryByText("Contraste con tu planteamiento")).toBeNull();
    expect(screen.queryByText("No se pudo generar el contraste")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
