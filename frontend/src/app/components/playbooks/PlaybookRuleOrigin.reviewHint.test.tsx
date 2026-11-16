// «Revisar esta cita» on a drafted rule: next to the quote its origin stands
// on, or the legal reference it stands on, and only when the automatic check
// flagged that one.
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import type { PlaybookRule } from "@/app/lib/mikeApi";
import { PlaybookRuleOrigin } from "./PlaybookRuleOrigin";
import { NO_PROVENANCE } from "./usePlaybookProvenance";
import { playbookReviewKey } from "./usePlaybookReviewSources";

function Spanish({ children }: { children: ReactNode }) {
  return (
    <IntlClientProvider locale="es-MX" messages={esMX}>
      {children}
    </IntlClientProvider>
  );
}

const rule = {
  id: "rule-1",
  name: "Pena convencional",
  origin: { kind: "clause", sourceId: "src-1", quote: "diez por ciento", unbacked: false },
  legalRefs: [
    { text: "Código Civil, art. 2118", verified: true, sourceId: "src-1", quote: "plazo" },
    { text: "Código Civil, art. 2448", verified: true, sourceId: "src-1", quote: "renta" },
  ],
} as unknown as PlaybookRule;

const DESCRIPTION =
  "La revisión automática indica que el texto citado podría no respaldar lo que se afirma. Revísalo antes de usarlo.";

describe("PlaybookRuleOrigin review hint", () => {
  it("shows the hint beside the flagged quote only, in Spanish with its description", () => {
    const { container } = render(
      <PlaybookRuleOrigin
        rule={rule}
        provenance={{ ...NO_PROVENANCE, reviewed: new Set([playbookReviewKey("rule-1", null)]) }}
      />,
      { wrapper: Spanish },
    );
    const hint = screen.getByText("Revisar esta cita", { selector: "span" });
    expect(hint).toHaveAccessibleDescription(DESCRIPTION);
    expect(container.querySelectorAll("[data-citation-review-hint]")).toHaveLength(1);
    expect(hint.closest("figcaption")).not.toBeNull();
  });

  it("shows it beside the flagged legal reference and not the other", () => {
    render(
      <PlaybookRuleOrigin
        rule={rule}
        provenance={{ ...NO_PROVENANCE, reviewed: new Set([playbookReviewKey("rule-1", 1)]) }}
      />,
      { wrapper: Spanish },
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).not.toHaveTextContent("Revisar esta cita");
    expect(items[1]).toHaveTextContent("Revisar esta cita");
  });

  it("shows nothing for a rule that was not flagged, or when nothing is flagged", () => {
    const { container, rerender } = render(
      <PlaybookRuleOrigin rule={rule} provenance={NO_PROVENANCE} />,
      { wrapper: Spanish },
    );
    expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
    rerender(
      <PlaybookRuleOrigin
        rule={rule}
        provenance={{ ...NO_PROVENANCE, reviewed: new Set([playbookReviewKey("another-rule", null)]) }}
      />,
    );
    expect(container.querySelector("[data-citation-review-hint]")).toBeNull();
  });
});
