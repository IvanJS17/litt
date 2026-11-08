// LiTT: the assistant's playbook picker leaves drafts out, as the Word
// add-in's does: a draft cannot be run until an editor marks it ready.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { listPlaybooks, type Playbook } from "@/app/lib/mikeApi";
import { PlaybookPickerModal } from "./PlaybookPickerModal";

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  listPlaybooks: vi.fn(),
}));
vi.mock("@/app/contexts/WorkspaceContext", () => ({
  useDocumentWorkspace: () => "personal",
}));
vi.mock("@/app/hooks/useWorkspaceIdentity", () => ({
  useWorkspaceIdentity: () => "personal",
}));

const book = (id: string, status: Playbook["status"]) =>
  ({
    id,
    name: id,
    description: "",
    status,
    content: { documentTypes: [], rules: [], topics: [] },
  }) as unknown as Playbook;

describe("PlaybookPickerModal", () => {
  it("lists ready playbooks only", async () => {
    // Answers after the dialog's first frame, as a request does.
    vi.mocked(listPlaybooks).mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve([book("Ready one", "ready"), book("Draft one", "draft")]), 50),
        ),
    );
    render(<PlaybookPickerModal open onClose={vi.fn()} onSelect={vi.fn()} breadcrumbs={["Assistant"]} />);
    expect(await screen.findByText("Ready one")).toBeInTheDocument();
    expect(screen.queryByText("Draft one")).toBeNull();
  });
});
