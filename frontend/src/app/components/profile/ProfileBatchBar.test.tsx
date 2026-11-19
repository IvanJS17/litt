import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { ProfileBatchBar } from "./ProfileBatchBar";

function bar(busy: boolean, onDecide = vi.fn()) {
  return (
    <IntlClientProvider locale="es-MX" messages={esMX as never}>
      <ProfileBatchBar total={3} selected={2} busy={busy} onSelectAll={vi.fn()} onDecide={onDecide} />
    </IntlClientProvider>
  );
}

describe("ProfileBatchBar rejecting", () => {
  it("shows «Rechazando…» while the call runs, then closes the reason form", async () => {
    const onDecide = vi.fn();
    const { rerender } = render(bar(false, onDecide));
    await userEvent.click(screen.getByRole("button", { name: "Rechazar seleccionadas" }));
    await userEvent.type(screen.getByLabelText("Motivo para todas (opcional)"), " No aplica ");
    await userEvent.click(screen.getByRole("button", { name: /Rechazar los 2 datos seleccionados/ }));
    expect(onDecide).toHaveBeenCalledExactlyOnceWith("reject", "No aplica");

    // The page marks the batch busy: the button now says so, and the form stays until it ends.
    rerender(bar(true, onDecide));
    expect(screen.getByRole("button", { name: "Rechazando…" })).toBeDisabled();
    expect(screen.getByLabelText("Motivo para todas (opcional)")).toBeDisabled();

    rerender(bar(false, onDecide));
    expect(screen.queryByLabelText("Motivo para todas (opcional)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rechazar seleccionadas" })).toBeEnabled();
  });
});
