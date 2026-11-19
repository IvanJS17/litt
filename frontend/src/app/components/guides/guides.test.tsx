import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingMembership } from "@mike/contracts";
import enUS from "../../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { GUIDE_IDS, parseGuide, stageFromMemberships } from "./guideCatalog";
import { GuideTrigger } from "./GuideTrigger";
import { GuideHint } from "./GuideHint";
import { HelpPage } from "./HelpPage";
import { ChatGuideHint } from "./ChatGuideHint";
import { hintStorageKey } from "./useDismissedHint";

const auth = vi.hoisted(() => ({ userId: "user-1" }));
const api = vi.hoisted(() => ({ memberships: [] as unknown[] }));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({ user: { id: auth.userId, email: "abogado@example.test" } }),
}));
vi.mock("@/app/lib/mikeApi", () => ({
    getMyTraining: vi.fn(async () => api.memberships),
}));

const pupil = (stage: "pasante" | "junior"): TrainingMembership => ({
    org_id: "org-1",
    is_mentor: false,
    mentor_user_id: "mentor-1",
    stages: [{ practice: null, stage }],
});

beforeEach(() => {
    window.localStorage.clear();
    auth.userId = "user-1";
    api.memberships = [];
});

describe("the guide catalog", () => {
    it("has the texts of every guide id in es-MX and en-US, and no guide the code does not know", () => {
        for (const [locale, messages] of [
            ["es-MX", esMX],
            ["en-US", enUS],
        ] as const) {
            const guides = messages.guides as Record<string, unknown>;
            expect(Object.keys(guides).filter((key) => key !== "ui").sort(), locale).toEqual(
                [...GUIDE_IDS].sort(),
            );
            for (const id of GUIDE_IDS) {
                const guide = parseGuide(guides[id]);
                expect(guide.title.trim(), `${locale} ${id} title`).not.toBe("");
                expect(guide.summary.trim(), `${locale} ${id} summary`).not.toBe("");
                expect(guide.sections.length, `${locale} ${id} sections`).toBeGreaterThan(0);
                for (const section of guide.sections) {
                    expect(section.heading.trim(), `${locale} ${id} heading`).not.toBe("");
                    expect(section.body || section.items.length, `${locale} ${id} ${section.heading}`).toBeTruthy();
                }
            }
        }
    });

    it("keeps raw identifiers and the competitor-free rule out of the guide texts", () => {
        const all = JSON.stringify([esMX.guides, enUS.guides]);
        expect(all).not.toMatch(/superseded_thesis|mode_not_available|SHA-256|\(ack\)|Harvey|Legora|CoCounsel/);
    });

    it("opens the pupil guide on the person's stage: pasante wins over junior, none for a lawyer", () => {
        expect(stageFromMemberships([pupil("junior")])).toBe("junior");
        expect(stageFromMemberships([pupil("junior"), pupil("pasante")])).toBe("pasante");
        expect(stageFromMemberships([{ org_id: "o", is_mentor: true, mentor_user_id: null, stages: [] }])).toBeNull();
    });
});

describe("GuideTrigger and the guide dialog", () => {
    it("never opens by itself, opens from the trigger on the guide's title and gives the focus back on Esc", async () => {
        const user = userEvent.setup();
        render(<GuideTrigger id="tabular_review" />);
        expect(screen.queryByRole("dialog")).toBeNull();
        const trigger = screen.getByRole("button", { name: "What is this?" });
        expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
        await user.click(trigger);
        const dialog = await screen.findByRole("dialog", { name: "Tabular review" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
        await waitFor(() =>
            expect(within(dialog).getByRole("heading", { level: 2, name: "Tabular review" })).toHaveFocus(),
        );
        expect(within(dialog).getByRole("heading", { level: 3, name: "What it does not do" })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(trigger).toHaveFocus();
    });

    it("«When to use it?» opens the same guide from an empty state", async () => {
        const user = userEvent.setup();
        render(<GuideTrigger id="donna_radar" label="When to use it?" icon={false} />);
        await user.click(screen.getByRole("button", { name: "When to use it?" }));
        expect(await screen.findByRole("dialog", { name: "Donna: Radar and obligation rules" })).toBeInTheDocument();
    });

    it("offers «If you are in training» only to someone with a stage, and it switches to the pupil guide", async () => {
        const user = userEvent.setup();
        render(<GuideTrigger id="chat" />);
        await user.click(screen.getByRole("button", { name: "What is this?" }));
        let dialog = await screen.findByRole("dialog", { name: "Assistant" });
        expect(within(dialog).queryByText("If you are in training")).toBeNull();
        await user.keyboard("{Escape}");

        api.memberships = [pupil("junior")];
        await user.click(screen.getByRole("button", { name: "What is this?" }));
        dialog = await screen.findByRole("dialog", { name: "Assistant" });
        await user.click(await within(dialog).findByRole("button", { name: "Guide for your stage" }));
        expect(await screen.findByRole("dialog", { name: "Guide for interns and juniors" })).toBeInTheDocument();
    });
});

describe("the guide for interns and juniors", () => {
    it("opens on the person's stage, and the tabs move with the arrows and aria-selected", async () => {
        const user = userEvent.setup();
        api.memberships = [pupil("junior")];
        render(<GuideTrigger id="pupil" label="Guide for your stage" />);
        await user.click(screen.getByRole("button", { name: "Guide for your stage" }));
        const dialog = await screen.findByRole("dialog");
        const junior = await within(dialog).findByRole("tab", { name: "Junior" });
        await waitFor(() => expect(junior).toHaveAttribute("aria-selected", "true"));
        const intern = within(dialog).getByRole("tab", { name: "Intern" });
        expect(intern).toHaveAttribute("aria-selected", "false");
        expect(within(dialog).getByRole("tabpanel")).toHaveTextContent(/Direct AI answer|direct answer|accountability/i);
        junior.focus();
        await user.keyboard("{ArrowLeft}");
        expect(intern).toHaveAttribute("aria-selected", "true");
        expect(intern).toHaveFocus();
        expect(within(dialog).getByRole("tabpanel")).toHaveTextContent(/approach/i);
        await user.keyboard("{End}");
        expect(junior).toHaveAttribute("aria-selected", "true");
    });

    it("uses the stage the caller passes without waiting for the server", async () => {
        const user = userEvent.setup();
        render(<GuideTrigger id="pupil" label="Open" initialStage="junior" />);
        await user.click(screen.getByRole("button", { name: "Open" }));
        expect(await screen.findByRole("tab", { name: "Junior" })).toHaveAttribute("aria-selected", "true");
    });
});

describe("GuideHint", () => {
  const hint = (key = "radar") => (
      <GuideHint hint={key} guide="donna_radar" message="Radar hint text" />
  );

  it("shows once, closes with the × and stays closed for that person, with no network", async () => {
      const user = userEvent.setup();
      const first = render(hint());
      expect(screen.getByText("Radar hint text")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Dismiss the notice" }));
      expect(screen.queryByText("Radar hint text")).toBeNull();
      expect(window.localStorage.getItem(hintStorageKey("user-1", "radar"))).toBe("1");
      first.unmount();
      render(hint());
      expect(screen.queryByText("Radar hint text")).toBeNull();
  });

  it("is remembered per person and per hint: another user, or another hint, still sees it", () => {
      window.localStorage.setItem(hintStorageKey("user-1", "radar"), "1");
      auth.userId = "user-2";
      const { unmount } = render(hint());
      expect(screen.getByText("Radar hint text")).toBeInTheDocument();
      unmount();
      auth.userId = "user-1";
      render(hint("chat"));
      expect(screen.getByText("Radar hint text")).toBeInTheDocument();
  });

  it("opens the guide from its own button and moves the focus to the title's button after the ×", async () => {
      const user = userEvent.setup();
      render(
          <>
              <GuideTrigger id="donna_radar" />
              {hint()}
          </>,
      );
      const [, inHint] = screen.getAllByRole("button", { name: "What is this?" });
      await user.click(inHint!);
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      await user.click(screen.getByRole("button", { name: "Dismiss the notice" }));
      await waitFor(() => expect(screen.getByRole("button", { name: "What is this?" })).toHaveFocus());
  });
});

describe("ChatGuideHint", () => {
    it("shows the chat guide to a lawyer and the pupil guide to someone in training, once each", async () => {
        const user = userEvent.setup();
        const lawyer = render(<ChatGuideHint />);
        expect(await screen.findByText(/learn what the assistant does/i)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Dismiss the notice" }));
        lawyer.unmount();

        api.memberships = [pupil("pasante")];
        render(<ChatGuideHint />);
        expect(await screen.findByText(/Your stage changes how the assistant answers/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Dismiss the notice" }));
        expect(window.localStorage.getItem(hintStorageKey("user-1", "role:pasante"))).toBe("1");
        // A new stage shows its own notice.
        expect(window.localStorage.getItem(hintStorageKey("user-1", "role:junior"))).toBeNull();
    });
});

describe("/help", () => {
    it("lists every guide of the catalog, opens one, and the pupil guide on the person's stage", async () => {
        const user = userEvent.setup();
        api.memberships = [pupil("junior")];
        const { container } = render(<HelpPage />);
        expect(screen.getByRole("heading", { level: 1, name: "Help" })).toBeInTheDocument();
        const rows = [...container.querySelectorAll("[data-guide-row]")].map((row) => row.getAttribute("data-guide-row"));
        expect(rows).toEqual([...GUIDE_IDS]);
        expect(screen.queryByRole("dialog")).toBeNull();
        await user.click(screen.getByRole("button", { name: "Open the guide: Mentor guide" }));
        expect(await screen.findByRole("dialog", { name: "Mentor guide" })).toBeInTheDocument();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await waitFor(() => expect(screen.getByRole("button", { name: "Open the guide: Guide for interns and juniors" })).toBeEnabled());
        await user.click(screen.getByRole("button", { name: "Open the guide: Guide for interns and juniors" }));
        expect(await screen.findByRole("tab", { name: "Junior" })).toHaveAttribute("aria-selected", "true");
    });
});
