import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@mike/ui";
import { AssistantMessage } from "./AssistantMessage";
import * as download from "@/app/lib/downloadDocument";

describe("AssistantMessage copy", () => {
    beforeEach(() => clearToasts());

    afterEach(() => {
        clearToasts();
        vi.restoreAllMocks();
    });

    it("tells the user when the clipboard refuses the copy", async () => {
        const user = userEvent.setup();
        // jsdom has no ClipboardItem; give the handler one so the failure
        // under test is the clipboard write itself, as it is in a browser.
        vi.stubGlobal(
            "ClipboardItem",
            class {
                constructor(public items: Record<string, Blob>) {}
            },
        );
        const write = vi
            .fn()
            .mockRejectedValue(
                new DOMException("Write permission denied.", "NotAllowedError"),
            );
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { ...navigator.clipboard, write },
        });

        render(
            <>
                <AssistantMessage
                    events={[{ type: "content", text: "The answer." }]}
                />
                <ToastViewportUI />
            </>,
        );

        await user.click(screen.getByRole("button", { name: "Copy response" }));

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Couldn't copy this answer");
        expect(alert).toHaveTextContent("clipboard permission");
        expect(alert).not.toHaveTextContent("Write permission denied.");
        expect(
            screen.queryByRole("button", { name: "Response copied" }),
        ).not.toBeInTheDocument();
        vi.unstubAllGlobals();
    });
});

describe("AssistantMessage web sources", () => {
    it("lists a page cited by several steps once, keeping its title", async () => {
        const user = userEvent.setup();
        render(
            <AssistantMessage
                events={[
                    {
                        type: "web_sources",
                        sources: [{ url: "https://law.test/s172" }],
                    },
                    { type: "content", text: "The answer." },
                    {
                        type: "web_sources",
                        sources: [
                            { url: "https://law.test/s172", title: "Section 172" },
                            { url: "https://law.test/s171", title: "Section 171" },
                        ],
                    },
                ]}
            />,
        );

        const toggle = screen.getByRole("button", { name: /Sources/ });
        expect(toggle).toHaveTextContent("2 web pages");
        await user.click(toggle);
        expect(screen.getByText("Section 172")).toBeInTheDocument();
    });
});

describe("AssistantMessage export", () => {
    afterEach(() => vi.restoreAllMocks());

    it("downloads the Markdown the answer already is, under a safe name", async () => {
        const user = userEvent.setup();
        const spy = vi.spyOn(download, "downloadBlob").mockImplementation(() => {});
        const text = "# Resumen del contrato\n\n| a | b |\n|---|---|\n| 1 | 2 |";
        render(<AssistantMessage events={[{ type: "content", text }]} />);

        await user.click(screen.getByRole("button", { name: "Download .md" }));

        const [blob, name] = spy.mock.calls[0];
        expect(name).toBe("resumen-del-contrato.md");
        expect(blob.type).toBe("text/markdown;charset=utf-8");
        expect(await blob.text()).toBe(text);
    });

    it("marks a stopped answer's file with the translated note", async () => {
        const user = userEvent.setup();
        const spy = vi.spyOn(download, "downloadBlob").mockImplementation(() => {});
        render(<AssistantMessage events={[{ type: "content", text: "Partial answer" }, { type: "stopped" }]} />);

        await user.click(screen.getByRole("button", { name: "Download .md" }));

        expect(await spy.mock.calls[0][0].text()).toBe("Partial answer\n\n_Response stopped_");
    });

    it("offers no download while streaming or when the answer has no text", () => {
        const { rerender } = render(
            <AssistantMessage isStreaming events={[{ type: "content", text: "Partial" }]} />,
        );
        expect(screen.queryByRole("button", { name: "Download .md" })).toBeNull();
        rerender(<AssistantMessage events={[{ type: "content", text: "   " }]} />);
        expect(screen.queryByRole("button", { name: "Download .md" })).toBeNull();
    });
});

describe("AssistantMessage stopped answers", () => {
    it("shows the stopped mark as one translated line, not as content", () => {
        render(<AssistantMessage events={[{ type: "content", text: "Half an ans" }, { type: "stopped" }]} />);
        expect(screen.getByText("You stopped the response.")).toBeInTheDocument();
        expect(screen.getByText("Half an ans")).toBeInTheDocument();
    });

    it("reads the sentence earlier versions stored as the same line", () => {
        render(
            <AssistantMessage
                events={[{ type: "content", text: "Half an ans" }, { type: "content", text: "Cancelled by user." }]}
            />,
        );
        expect(screen.getByText("You stopped the response.")).toBeInTheDocument();
        expect(screen.queryByText("Cancelled by user.")).not.toBeInTheDocument();
    });
});
