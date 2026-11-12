import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import type { Playbook } from "@/app/lib/mikeApi";
import { PlaybookTable } from "./PlaybookTable";

function playbook(id: string, userId: string, isCreator: boolean, creatorName: string | null): Playbook {
  return {
    id,
    userId,
    name: `Playbook ${id}`,
    description: "",
    orgId: null,
    visibility: "private",
    role: isCreator ? "owner" : "viewer",
    isCreator,
    canEdit: isCreator,
    canManageAccess: isCreator,
    sharedWith: [],
    creatorName,
    creatorPhoto: null,
    content: {
      name: `Playbook ${id}`,
      description: "",
      representedParty: "Customer",
      documentTypes: [],
      jurisdictions: [],
      topics: [],
    },
    sourceFilename: null,
    importModel: null,
    status: "ready",
  } as unknown as Playbook;
}

describe("PlaybookTable creator filter", () => {
  it("lists the caller's own entry first even when its Spanish label sorts last", async () => {
    render(
      <IntlClientProvider locale="es-MX" messages={esMX}>
        <PlaybookTable
          playbooks={[
            playbook("a", "u-ana", false, "Ana"),
            playbook("b", "u-me", true, null),
            playbook("c", "u-beto", false, "Beto"),
          ]}
          loading={false}
          error={null}
          filtered={false}
          disabled={false}
          selectedIds={new Set()}
          onSelect={vi.fn()}
          onRetry={vi.fn()}
          onImport={vi.fn()}
          onCreate={vi.fn()}
          onOpen={vi.fn()}
          onDetails={vi.fn()}
          onRun={vi.fn()}
          onPeople={vi.fn()}
          onDelete={vi.fn()}
          onDeleteSelected={vi.fn()}
        />
      </IntlClientProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Filtrar por creador" }));
    const menu = await screen.findByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent?.trim());
    // "Yo" would sort after "Ana" and "Beto" alphabetically; it is first by id.
    expect(labels.filter((label) => ["Yo", "Ana", "Beto"].includes(label ?? ""))).toEqual(["Yo", "Ana", "Beto"]);
  });
});
