/**
 * LiTT training, «Modo de rendir cuentas» in the Word task pane: a junior's
 * conclusions under each answer, in the pane's language, for cloud chats only.
 */
import React from "react";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Locale } from "@litt/i18n";
import type { TrainingBackingCheck } from "@mike/contracts";

const { getChatBacking, markBackingConclusion, getWordTrainingStage, notifyError } = vi.hoisted(() => ({
    getChatBacking: vi.fn(),
    markBackingConclusion: vi.fn(),
    getWordTrainingStage: vi.fn(),
    notifyError: vi.fn(),
}));
vi.mock("../../../word-addin/src/taskpane/api/client", () => ({
    getChatBacking,
    markBackingConclusion,
    getWordTrainingStage,
}));
vi.mock("../../../word-addin/src/taskpane/lib/notify", () => ({ notifyError }));
vi.mock("../../../word-addin/src/taskpane/lib/errorReporting", () => ({
    reportError: vi.fn(),
    isReported: () => false,
}));

import { LocaleProvider } from "../../../word-addin/src/taskpane/i18n/LocaleProvider";
import { loadLocale } from "../../../word-addin/src/taskpane/i18n/loadLocale";
import { BackingSlot } from "../../../word-addin/src/taskpane/components/assistant/BackingPanel";
import { useWordTrainingBacking } from "../../../word-addin/src/taskpane/hooks/useWordTrainingBacking";

async function inPane(locale: Locale, ui: React.ReactElement) {
    const initial = await loadLocale(locale);
    return render(<LocaleProvider initial={initial}>{ui}</LocaleProvider>);
}
async function paneWrapper(locale: Locale) {
    const initial = await loadLocale(locale);
    function Wrapper({ children }: { children: React.ReactNode }) {
        return <LocaleProvider initial={initial}>{children}</LocaleProvider>;
    }
    return Wrapper;
}

const check = (over: Partial<TrainingBackingCheck> = {}): TrainingBackingCheck => ({
    id: "check-1",
    org_id: "org-1",
    trainee_user_id: "me",
    chat_id: "chat-1",
    message_id: "message-1",
    status: "ready",
    created_at: "2026-11-08T16:30:00Z",
    updated_at: "2026-11-08T16:30:00Z",
    conclusions: [
        {
            id: "c1", text: "El plazo es de tres años", citation_ref: 1, status: "backed",
            passage: { ref: 1, title: "contrato.docx", page: 3, excerpt: "El plazo es de tres años." },
            unverified_references: [], person_verified: false, person_note: null,
        },
        {
            id: "c2", text: "Procede el amparo", citation_ref: null, status: "unbacked",
            passage: null, unverified_references: ["art. 107"], person_verified: false, person_note: null,
        },
    ],
    ...over,
});

beforeEach(() => {
    for (const fn of [getChatBacking, markBackingConclusion, getWordTrainingStage, notifyError]) fn.mockReset();
});

describe("BackingSlot in Word", () => {
    it("speaks es-MX under the message it belongs to, with the exact passage", async () => {
        const mark = vi.fn().mockResolvedValue(undefined);
        await inPane("es-MX", <BackingSlot backing={{ checks: new Map([["message-1", check()]]), mark }} messageId="message-1" />);
        expect(screen.getByRole("region", { name: "Tus conclusiones y su fuente" })).toBeInTheDocument();
        expect(screen.getByText("Respaldada")).toBeInTheDocument();
        expect(screen.getByText("Pasaje exacto · contrato.docx, página 3")).toBeInTheDocument();
        expect(screen.getByText("Sin verificar: art. 107. Confírmalo en la fuente oficial.")).toBeInTheDocument();
        fireEvent.click(screen.getAllByRole("checkbox", { name: "Lo verifiqué" })[1]);
        await waitFor(() => expect(mark).toHaveBeenCalledWith(expect.objectContaining({ id: "check-1" }), "c2", { person_verified: true }));
    });

    it("speaks en-US in an English pane", async () => {
        await inPane("en-US", <BackingSlot backing={{ checks: new Map([["message-1", check()]]), mark: vi.fn() }} messageId="message-1" />);
        expect(screen.getByRole("region", { name: "Your conclusions and their sources" })).toBeInTheDocument();
        expect(screen.getByText("Without backing")).toBeInTheDocument();
    });

    it("draws nothing for another message, without a check, or without the hook", async () => {
        const backing = { checks: new Map([["message-1", check()]]), mark: vi.fn() };
        const first = await inPane("es-MX", <BackingSlot backing={backing} messageId="other" />);
        expect(first.container).toBeEmptyDOMElement();
        const second = await inPane("es-MX", <BackingSlot backing={undefined} messageId="message-1" />);
        expect(second.container).toBeEmptyDOMElement();
    });
});

describe("useWordTrainingBacking", () => {
    it("reads a cloud chat of a junior and nothing for anybody else or a device-only chat", async () => {
        const wrapper = await paneWrapper("es-MX");
        getChatBacking.mockResolvedValue([check()]);

        getWordTrainingStage.mockResolvedValue("junior");
        const junior = renderHook(
            () => useWordTrainingBacking({ chatId: "chat-1", storage: "cloud", isResponseLoading: false }),
            { wrapper },
        );
        await waitFor(() => expect(junior.result.current.checks.get("message-1")).toBeDefined());

        getChatBacking.mockClear();
        getWordTrainingStage.mockResolvedValue("pasante");
        renderHook(() => useWordTrainingBacking({ chatId: "chat-1", storage: "cloud", isResponseLoading: false }), { wrapper });
        getWordTrainingStage.mockResolvedValue("junior");
        const local = renderHook(
            () => useWordTrainingBacking({ chatId: "chat-1", storage: "local", isResponseLoading: false }),
            { wrapper },
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(getChatBacking).not.toHaveBeenCalled();
        expect(local.result.current.checks.size).toBe(0);
    });

    it("tells the person, in their language, why a mark was not saved", async () => {
        const wrapper = await paneWrapper("es-MX");
        getWordTrainingStage.mockResolvedValue("junior");
        getChatBacking.mockResolvedValue([check()]);
        markBackingConclusion.mockRejectedValue(new Error("network"));
        const { result } = renderHook(
            () => useWordTrainingBacking({ chatId: "chat-1", storage: "cloud", isResponseLoading: false }),
            { wrapper },
        );
        await waitFor(() => expect(result.current.checks.size).toBe(1));
        await expect(result.current.mark(check(), "c1", { person_verified: true })).rejects.toThrow("network");
        expect(notifyError).toHaveBeenCalledWith(expect.any(Error), {
            action: "guardar tu marca en esta conclusión",
            page: "Assistant",
            operation: "training.read",
        });
    });

    it("keeps working when the stage cannot be read (no checks, no error)", async () => {
        const wrapper = await paneWrapper("es-MX");
        getWordTrainingStage.mockRejectedValue(new Error("down"));
        const { result } = renderHook(
            () => useWordTrainingBacking({ chatId: "chat-1", storage: "cloud", isResponseLoading: false }),
            { wrapper },
        );
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
        });
        expect(result.current.checks.size).toBe(0);
        expect(getChatBacking).not.toHaveBeenCalled();
    });
});
