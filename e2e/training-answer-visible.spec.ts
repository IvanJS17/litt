import { expect, test } from "./fixtures";
import type { Page, Route } from "@playwright/test";

// A person in training writes an approach and a confidence mark before every
// chat message. Once the chat holds a message, that block must not cover the
// answer: it folds into one line, and opens again when they start the next
// question. The server is answered from here; layout is the real browser's.

test.use({ storageState: { cookies: [], origins: [] } });

const PROJECT_ID = "training-project";
const CHAT_ID = "training-chat";
const APPROACH =
    "I would first check whether the fifth clause allows termination for breach, then whether notice was given in writing.";
const QUESTION = "Is termination of the lease justified?";
const NEXT_LABEL = "Your approach for the next question (2–3 lines)";
const FIRST_LABEL = "Your approach (2–3 lines)";
const NEXT_LINE = /approach will be asked for/i;

const PARAGRAPHS = [
    "Termination is available only if the breach is substantial and the tenant was given written notice with a reasonable time to cure it. Here the fifth clause lists late payment as a ground, so the first question is whether any rent was in fact unpaid when the notice was served.",
    "Second, check how the notice was delivered. The contract asks for delivery at the address named in the signature page, and a notice sent by email alone would not meet that formality. If the formality was missed, the landlord can serve a fresh notice, but the cure period then starts again.",
    "Third, look at the landlord's conduct. Accepting rent after the alleged breach can be read as a waiver of the ground, which would weaken a later claim. Record each payment date and who accepted it, because the dates decide this point.",
    "In short: termination is defensible only if the unpaid rent, the written notice and the absence of waiver are all shown. The next step is to collect the payment ledger and the notice with proof of delivery, then compare them with the cure period.",
];
const ANSWER = PARAGRAPHS.join("\n\n");

const PASANTE = {
    stage: "pasante",
    attempt_required: true,
    confidence_required: true,
    urgency_pass: null,
    modes: [],
    next_hint_level: null,
    counterpart_next_step: null,
};

type Rect = { top: number; bottom: number; left: number; right: number; width: number; height: number };

const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function answerServer(page: Page) {
    const state = { sent: [] as Record<string, unknown>[], answered: false };
    const chat = {
        id: CHAT_ID,
        title: "Lease termination",
        user_id: "trainee",
        project_id: PROJECT_ID,
        model: "claude-sonnet-5-5",
        created_at: "2026-11-25T00:00:00Z",
        is_owner: true,
        access_role: "owner",
    };
    const history = () =>
        state.answered
            ? [
                  { id: "user-1", role: "user", content: QUESTION },
                  { id: "answer-1", role: "assistant", content: [{ type: "content", text: ANSWER }] },
              ]
            : [];
    await page.route(
        (url) => url.pathname.startsWith("/api/"),
        async (route) => {
            const request = route.request();
            const path = new URL(request.url()).pathname;
            const method = request.method();
            if (path === "/api/auth/session")
                return json(route, { user: { id: "trainee", email: "trainee@example.test" } });
            if (path === "/api/user/profile")
                return json(route, {
                    onboardingComplete: true,
                    displayName: "Trainee",
                    lastSelectedChatModel: "claude-sonnet-5-5",
                    apiKeyStatus: { claude: true },
                    creditsRemaining: 100,
                });
            if (path === "/api/models/configured")
                return json(route, { models: [] });
            if (path.startsWith("/api/models/")) return json(route, { models: [] });
            if (path === "/api/training/stage") return json(route, PASANTE);
            if (path === `/api/training-notes/chats/${CHAT_ID}`) {
                if (!state.answered) return json(route, { detail: "Training notes not found" }, 404);
                const body = state.sent[0] ?? {};
                return json(route, {
                    notes: [
                        {
                            id: "note-1",
                            org_id: "org-1",
                            trainee_user_id: "trainee",
                            chat_id: CHAT_ID,
                            message_id: "user-1",
                            attempt: body.attempt ?? APPROACH,
                            contrast: "Your approach matches the answer.",
                            contrast_status: "ready",
                            created_at: "2026-11-25T10:00:00.000Z",
                            confidence: body.confidence ?? 3,
                        },
                    ],
                });
            }
            if (path.startsWith("/api/training-notes/"))
                return json(route, { detail: "Training notes not found" }, 404);
            if (path === `/api/projects/${PROJECT_ID}`)
                return json(route, {
                    id: PROJECT_ID,
                    name: "Lease dispute",
                    documents: [],
                    folders: [],
                    is_owner: false,
                    access_role: "editor",
                    user_id: "owner",
                });
            if (path === `/api/projects/${PROJECT_ID}/chats`)
                return json(route, state.answered ? [chat] : []);
            if (path === `/api/chat/${CHAT_ID}`)
                return json(route, { chat, is_owner: true, access_role: "owner", messages: history() });
            if (path === `/api/projects/${PROJECT_ID}/chat` && method === "POST") {
                state.sent.push(request.postDataJSON());
                // The whole answer, in a few chunks, as one event stream.
                const events = [
                    { type: "chat_id", chatId: CHAT_ID, assistantMessageId: "answer-1" },
                    ...PARAGRAPHS.flatMap((text, i) => [
                        { type: "content_delta", text: (i ? "\n\n" : "") + text },
                    ]),
                ];
                state.answered = true;
                return route.fulfill({
                    status: 200,
                    contentType: "text/event-stream",
                    body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n",
                });
            }
            return json(route, []);
        },
    );
    return state;
}

const SIZES = [
    { name: "1440x900", width: 1440, height: 900 },
    { name: "1280x720", width: 1280, height: 720 },
];

for (const size of SIZES) {
    test(`a trainee can read the project chat's answer after sending, at ${size.name}`, async ({ page }, testInfo) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.setViewportSize({ width: size.width, height: size.height });
        const server = await answerServer(page);
        const shot = (name: string) => process.env.TRAINING_SHOTS
            ? page.screenshot({ path: `${process.env.TRAINING_SHOTS}-${size.name}-${name}.png`, fullPage: true })
            : Promise.resolve(undefined);

        await page.goto(`/projects/${PROJECT_ID}/assistant/chat`);
        const input = page.getByPlaceholder("How can I help?");
        await expect(input).toBeVisible();

        // 1. A new chat asks for the approach and the mark.
        const approach = page.getByRole("textbox", { name: FIRST_LABEL });
        const marks = page.getByRole("radiogroup");
        await expect(approach).toBeVisible();
        await expect(marks).toBeVisible();
        await shot("1-new-chat");
        await approach.fill(APPROACH);
        await page.getByRole("radio", { name: /Fairly sure/ }).click();
        await input.fill(QUESTION);
        await input.press("Enter");

        // 2-3. The answer has ended: the last paragraph is in the page.
        const last = page.getByText("In short: termination is defensible", { exact: false });
        await expect(last).toBeVisible();
        await expect(page.getByRole("button", { name: "Stop response", exact: true })).toBeHidden();
        const line = page.getByRole("button", { name: NEXT_LINE });
        await shot("2-after-answer");

        const composer = page.locator('[data-slot="chat-composer"]');
        const first = page.getByText("Termination is available only if the breach", { exact: false });
        await expect(first).toBeVisible();
        const rect = (locator: typeof composer) =>
            locator.evaluate((el): Rect => {
                const r = el.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
            });
        // The panel is the composer's ancestor that carries the chat's width.
        const panel = composer.locator("xpath=ancestor::div[contains(@class,'overflow-hidden')][1]");
        const panelRect = await rect(panel);
        const composerRect = await rect(composer);
        const firstRect = await rect(first);
        const lineRect = (await line.count()) ? await rect(line) : null;
        // Where the thread starts: the first user message sits just under the header.
        const question = page.getByText(QUESTION, { exact: true }).first();
        const questionRect = await rect(question);
        const lineHeight = await first.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
        const visibleConversation = composerRect.top - panelRect.top;
        const measures = {
            size: size.name,
            panel: { width: panelRect.width, height: panelRect.height },
            composerHeight: composerRect.height,
            composerTop: composerRect.top,
            foldedLineHeight: lineRect?.height ?? null,
            conversationAboveComposer: visibleConversation,
            conversationShare: visibleConversation / panelRect.height,
            questionTop: questionRect.top,
            firstParagraph: { top: firstRect.top, bottom: firstRect.bottom },
            firstParagraphLineHeight: lineHeight,
            viewportHeight: size.height,
        };
        await testInfo.attach("measures", { body: JSON.stringify(measures, null, 2), contentType: "application/json" });

        // The first lines of the answer (three lines of its own text) are in the
        // viewport, above the composer's top edge and not under it. The rest
        // of a long answer is read by scrolling, as in any chat.
        const firstLines = { top: firstRect.top, bottom: firstRect.top + 3 * lineHeight };
        expect(firstRect.top).toBeGreaterThanOrEqual(0);
        expect(firstRect.top).toBeLessThan(composerRect.top);
        expect(firstLines.bottom).toBeLessThanOrEqual(composerRect.top);
        expect(firstLines.bottom).toBeLessThanOrEqual(size.height);
        // The conversation keeps at least 45% of the panel above the composer.
        expect(visibleConversation / panelRect.height).toBeGreaterThanOrEqual(0.45);
        // Nothing of the composer overlaps those first lines.
        const overlaps =
            firstRect.left < composerRect.right &&
            firstRect.right > composerRect.left &&
            firstLines.top < composerRect.bottom &&
            firstLines.bottom > composerRect.top;
        expect(overlaps).toBe(false);

        // The approach field and the marks are gone; one line announces the next approach.
        await expect(line).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole("textbox", { name: NEXT_LABEL })).toHaveCount(0);
        await expect(page.getByRole("textbox", { name: FIRST_LABEL })).toHaveCount(0);
        await expect(page.getByRole("radiogroup")).toHaveCount(0);

        // 4. A click in the input opens the block; the line folds it again.
        await input.click();
        await expect(page.getByRole("textbox", { name: NEXT_LABEL })).toBeVisible();
        await expect(page.getByRole("radiogroup")).toBeVisible();
        await expect(line).toHaveAttribute("aria-expanded", "true");
        await shot("3-input-clicked");
        // How much of the panel the open block leaves to the conversation,
        // empty and with the next approach being typed. Recorded, not asserted.
        const openMeasure = async (state: string) => {
            const c = await rect(composer);
            const m = { size: size.name, state, composerHeight: c.height, composerTop: c.top,
                conversationAboveComposer: c.top - panelRect.top,
                conversationShare: (c.top - panelRect.top) / panelRect.height };
            await testInfo.attach(`open block, ${state}`, { body: JSON.stringify(m), contentType: "application/json" });
            console.log(`OPEN ${JSON.stringify(m)}`);
        };
        await openMeasure("empty");
        await page.getByRole("textbox", { name: NEXT_LABEL }).fill(APPROACH + " " + APPROACH);
        await expect(page.getByRole("textbox", { name: NEXT_LABEL })).toHaveValue(APPROACH + " " + APPROACH);
        await openMeasure("typing");
        await shot("4-typing-next-approach");
        await page.getByRole("textbox", { name: NEXT_LABEL }).fill("");
        await line.click();
        await expect(line).toHaveAttribute("aria-expanded", "false");
        await expect(page.getByRole("textbox", { name: NEXT_LABEL })).toHaveCount(0);

        // 5. The send carried the approach and the mark.
        expect(server.sent).toHaveLength(1);
        expect(server.sent[0]).toMatchObject({ attempt: APPROACH });
        expect(typeof server.sent[0].confidence).toBe("number");
        expect(errors).toEqual([]);
    });
}
