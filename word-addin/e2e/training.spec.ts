/**
 * LiTT training ("Tu turno primero", docs/training.md) in the Word add-in: a
 * pasante writes their own approach before each turn; anybody else sees the
 * composer of today. The stage and the turn are mocked; no backend is used.
 */
import { test, expect } from "./support/fixtures";

const QUESTION = "¿En qué precepto se apoya la cláusula quinta?";
const ATTEMPT =
  "Creo que procede la rescisión por incumplimiento de la cláusula quinta.";

test.beforeEach(async ({ addin }) => {
  addin.seedToken("test-jwt-token");
});

test("a pasante sends their approach and mark with the turn and sees the verdict in the thread", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("GET", "**/training/stage**", {
    stage: "pasante",
    attempt_required: true,
    confidence_required: true,
  });
  await addin.mockChatStream(["Procede la rescisión."], { chatId: "training-chat" });
  // The approach is not part of the message: it is a private note the server
  // keeps beside the turn, read once the turn has finished.
  await addin.mockApiJson("GET", "**/training-notes/chats/training-chat", {
    notes: [
      {
        id: "note-1",
        org_id: "org-1",
        trainee_user_id: "user-1",
        chat_id: "training-chat",
        message_id: "user-message-1",
        attempt: ATTEMPT,
        contrast: "Coincide: la cláusula quinta sostiene la rescisión.",
        contrast_status: "ready",
        created_at: "2026-11-06T12:00:00Z",
        confidence: 3,
        verdict: "coincide",
        verdict_source: "contrast",
        effective_verdict: "parcial",
        right_for_wrong_reason: true,
        foundation: "weak",
        foundation_question: QUESTION,
      },
    ],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const field = page.getByLabel("Your approach (2–3 lines)");
  await expect(field).toBeVisible();
  const group = page.getByRole("radiogroup", {
    name: "How sure are you of your approach?",
  });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  await field.fill("Muy corto");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");

  // A long enough approach is not a send without the mark.
  await field.fill(ATTEMPT);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Mark how sure you are" })).toBeVisible();
  await expect(group).toHaveAttribute("aria-invalid", "true");

  await group.getByRole("radio", { name: "Fairly sure" }).click();
  await expect(group.getByRole("radio", { name: "Fairly sure" })).toBeChecked();
  const request = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await request).postDataJSON();
  expect(body.attempt).toBe(ATTEMPT);
  expect(body.confidence).toBe(3);
  const note = page.getByRole("region", { name: "Private training notes" });
  await expect(note.getByText("Your approach", { exact: true })).toBeVisible();
  await expect(note.getByText(ATTEMPT, { exact: true })).toBeVisible();
  await expect(note.getByText("Your mark: Fairly sure")).toBeVisible();
  await expect(
    note.getByText("Coincide: la cláusula quinta sostiene la rescisión."),
  ).toBeVisible();
  await expect(note.getByText("Partly matches")).toBeVisible();
  await expect(note.getByText("Right for the wrong reason.")).toBeVisible();
  await expect(note.getByText(QUESTION)).toBeVisible();
  // Only the note carries the approach; the thread shows it once.
  await expect(page.getByText(ATTEMPT, { exact: true })).toHaveCount(1);
  // One mark per approach: the next one starts without it.
  await expect(group.getByRole("radio", { name: "Fairly sure" })).not.toBeChecked();

  // «Reply» quotes the question in the approach field and puts the cursor there.
  const reply = note.getByRole("button", { name: "Reply to the question about your basis" });
  // The floating composer must not cover the button the note offers.
  await expect
    .poll(() =>
      reply.evaluate((button) => {
        const box = button.getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return button.contains(hit);
      }),
    )
    .toBe(true);
  await reply.click();
  await expect(field).toHaveValue(`> ${QUESTION}\n\n`);
  await expect(field).toBeFocused();
});

test("the thermometer is asked only when the server asks for it", async ({
  addin,
  page,
}) => {
  // A server older than layer 3 sends no `confidence_required`.
  await addin.mockApiJson("GET", "**/training/stage**", { stage: "pasante" });
  await addin.mockChatStream(["Procede la rescisión."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByLabel("Your approach (2–3 lines)")).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await page.getByLabel("Your approach (2–3 lines)").fill(ATTEMPT);
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  const request = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await request).postDataJSON();
  expect(body.attempt).toBe(ATTEMPT);
  expect(body).not.toHaveProperty("confidence");
});

test("anybody without a pasante stage sees the composer of today", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Answer."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByLabel("Your approach (2–3 lines)")).toHaveCount(0);
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  const request = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  const sent = (await request).postDataJSON();
  expect(sent).not.toHaveProperty("attempt");
  expect(sent).not.toHaveProperty("confidence");
});

test("a refused turn brings the thermometer and keeps what the pasante wrote", async ({
  addin,
  page,
}) => {
  // The pane opened before the mentor switched the thermometer on: the stage
  // it read asks for the approach only.
  let confidenceRequired = false;
  await page.route("**/training/stage**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "pasante",
        attempt_required: true,
        confidence_required: confidenceRequired,
      }),
    }),
  );
  await addin.mockChatStream(["Procede la rescisión."], { chatId: "refused-chat" });
  // Routes run newest first: this one sees the turn before the stream mock.
  let refusals = 0;
  const bodies: Array<Record<string, unknown>> = [];
  await page.route("**/word-chat", (route, request) => {
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (!("confidence" in body)) {
      refusals += 1;
      confidenceRequired = true;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Mark how sure you are of your approach.",
          code: "training_confidence_required",
        }),
      });
    }
    return route.fallback();
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const field = page.getByLabel("Your approach (2–3 lines)");
  const prompt = page.getByPlaceholder("How can I help?");
  await expect(field).toBeVisible();
  await expect(page.getByRole("radiogroup")).toHaveCount(0);
  await prompt.fill("¿Procede la rescisión?");
  await field.fill(ATTEMPT);
  await page.getByRole("button", { name: "Send" }).click();

  // The thermometer appears and nothing the person wrote is lost.
  const group = page.getByRole("radiogroup", {
    name: "How sure are you of your approach?",
  });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await expect(prompt).toHaveValue("¿Procede la rescisión?");
  await expect(field).toHaveValue(ATTEMPT);
  expect(refusals).toBe(1);

  // And the next send, with the mark, goes through.
  await group.getByRole("radio", { name: "Fairly sure" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]?.attempt).toBe(ATTEMPT);
  expect(bodies[1]?.confidence).toBe(3);
  await expect(prompt).toHaveValue("");
});

test("a refused turn puts back the attached document (once) and the playbook", async ({
  addin,
  page,
}) => {
  let confidenceRequired = false;
  await page.route("**/training/stage**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "pasante",
        attempt_required: true,
        confidence_required: confidenceRequired,
      }),
    }),
  );
  await addin.mockApiJson("GET", "**/library/files?*", { documents: [], folders: [] });
  await addin.mockApiJson("GET", "**/library/templates?*", {
    documents: [
      {
        id: "template-1",
        filename: "NDA template.docx",
        file_type: "docx",
        size_bytes: 2048,
        created_at: "2026-08-08T00:00:00Z",
      },
    ],
    folders: [],
  });
  const PLAYBOOK_ID = "5d0c1c7e-8f0e-4c55-9a43-3c1d2f9f6b10";
  await page.route("**/playbooks?*", (route, request) =>
    request.method() !== "GET"
      ? route.fallback()
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: PLAYBOOK_ID,
              name: "NDA review",
              description: "Mutual NDAs",
              content: { documentTypes: ["NDA"] },
            },
          ]),
        }),
  );
  await addin.mockChatStream(["Procede."], { chatId: "restore-chat" });
  const bodies: Array<{ messages: Array<Record<string, unknown>> } & Record<string, unknown>> = [];
  await page.route("**/word-chat", (route, request) => {
    if (request.method() !== "POST") return route.fallback();
    const body = request.postDataJSON() as (typeof bodies)[number];
    bodies.push(body);
    if (!("confidence" in body)) {
      confidenceRequired = true;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Mark how sure you are of your approach.",
          code: "training_confidence_required",
        }),
      });
    }
    return route.fallback();
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Add documents" }).click();
  await page.getByRole("menuitem", { name: "Web files" }).click();
  const files = page.getByRole("dialog", { name: "Add Documents" });
  await files.getByRole("button", { name: "Templates" }).click();
  await files.getByRole("button", { name: /NDA template\.docx/ }).click();
  await files.getByRole("button", { name: "Confirm" }).click();
  await page.getByRole("button", { name: "Add documents" }).click();
  await page.getByRole("menuitem", { name: "Playbooks" }).click();
  const playbooks = page.getByRole("dialog", { name: "Add playbook" });
  await playbooks.getByRole("button", { name: /NDA review/ }).click();
  await playbooks.getByRole("button", { name: "Use" }).click();

  const composer = page.getByTestId("chat-input");
  const document = composer.getByRole("button", { name: "Remove document NDA template.docx" });
  const playbook = composer.getByRole("button", { name: "Remove playbook NDA review" });
  await expect(document).toHaveCount(1);
  await expect(playbook).toHaveCount(1);

  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  await page.getByLabel("Your approach (2–3 lines)").fill(ATTEMPT);
  await page.getByRole("button", { name: "Send" }).click();

  // The thermometer appears; the document is back once, and so is the playbook.
  const group = page.getByRole("radiogroup", { name: "How sure are you of your approach?" });
  await expect(group.getByRole("radio")).toHaveCount(4);
  await expect(document).toHaveCount(1);
  await expect(playbook).toHaveCount(1);

  await group.getByRole("radio", { name: "Fairly sure" }).click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => bodies.length).toBe(2);
  const last = bodies[1]!.messages.at(-1) as { files?: unknown; playbook?: unknown };
  expect(last.files).toEqual([{ filename: "NDA template.docx", document_id: "template-1" }]);
  expect(last.playbook).toEqual({ id: PLAYBOOK_ID, title: "NDA review" });
});

// ── The note and the floating composer ───────────────────────────────────
// A short pane: the composer (approach + thermometer) covers most of it, so a
// tall note's «Reply» only clears the composer if the thread is scrolled for it.

const LONG_ANSWER = Array.from(
  { length: 30 },
  (_, index) =>
    `Paragraph ${index + 1}: the clause supports the termination for breach and the analysis continues at length.`,
).join("\n\n");

function turnNote(status: "pending" | "ready") {
  return {
    id: "note-1",
    org_id: "org-1",
    trainee_user_id: "user-1",
    chat_id: "scroll-chat",
    message_id: "user-message-1",
    attempt: ATTEMPT,
    contrast: status === "ready" ? "Coincide: la cláusula quinta sostiene la rescisión. ".repeat(6) : null,
    contrast_status: status,
    created_at: "2026-11-06T12:00:00Z",
    confidence: 3,
    ...(status === "ready"
      ? {
          verdict: "coincide",
          verdict_source: "contrast",
          effective_verdict: "parcial",
          right_for_wrong_reason: true,
          foundation: "weak",
          foundation_question: QUESTION.repeat(3),
        }
      : {}),
  };
}

async function openNotedTurn(
  addin: import("./support/fixtures").Addin,
  page: import("@playwright/test").Page,
  notes: () => Promise<unknown> | unknown,
) {
  await page.setViewportSize({ width: 420, height: 600 });
  await addin.mockApiJson("GET", "**/training/stage**", {
    stage: "pasante",
    attempt_required: true,
    confidence_required: true,
  });
  await addin.mockChatStream([LONG_ANSWER], { chatId: "scroll-chat" });
  await page.route("**/training-notes/chats/scroll-chat", async (route) => {
    const body = await notes();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ notes: [body] }),
    });
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  await page.getByLabel("Your approach (2–3 lines)").fill(ATTEMPT);
  await page
    .getByRole("radiogroup", { name: "How sure are you of your approach?" })
    .getByRole("radio", { name: "Fairly sure" })
    .click();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Paragraph 30:")).toBeAttached();
}

const scrollTopOf = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const scroller = [...document.querySelectorAll<HTMLElement>("div")].find(
      (element) =>
        element.scrollHeight > element.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(element).overflowY) &&
        element.querySelector("[data-message-id]"),
    );
    return scroller ? Math.round(scroller.scrollTop) : -1;
  });

const isClear = (button: import("@playwright/test").Locator) =>
  button.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    );
    return element.contains(hit);
  });

test("a note that grows from pending to ready is shown again above the composer", async ({
  addin,
  page,
}) => {
  let ready = false;
  await openNotedTurn(addin, page, () => turnNote(ready ? "ready" : "pending"));
  const note = page.getByRole("region", { name: "Private training notes" });
  await expect(note.getByText("Generating contrast…")).toBeVisible();
  ready = true;
  // The pending note polls every 5 s.
  const reply = note.getByRole("button", { name: "Reply to the question about your basis" });
  await expect(reply).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => isClear(reply)).toBe(true);
});

test("a person reading further down is not pulled back when the note arrives or grows", async ({
  addin,
  page,
}) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await openNotedTurn(addin, page, async () => {
    await gate;
    return turnNote("ready");
  });
  // The answer is long and the person is reading it a little below the top
  // of the turn when the note arrives, taller than that: it must not move them.
  await page.waitForTimeout(1500);
  await page.mouse.move(200, 120);
  await page.mouse.wheel(0, 60);
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(30);
  await page.waitForTimeout(400);
  const before = await scrollTopOf(page);
  release();
  await expect(
    page.getByRole("region", { name: "Private training notes" }),
  ).toBeAttached();
  await page.waitForTimeout(800);
  expect(await scrollTopOf(page)).toBe(before);
});

test("tabbing to a control under the composer scrolls it into view and stays there", async ({
  addin,
  page,
}) => {
  await openNotedTurn(addin, page, () => turnNote("ready"));
  const note = page.getByRole("region", { name: "Private training notes" });
  const reply = note.getByRole("button", { name: "Reply to the question about your basis" });
  await expect(reply).toBeVisible();
  // The person went down to read the answer, then tabs back to the note.
  await page.mouse.move(200, 120);
  await page.mouse.wheel(0, 1200);
  await expect.poll(() => scrollTopOf(page)).toBeGreaterThan(300);
  // A keyboard user's way there: Tab, from wherever focus is, to the control.
  // A click on the answer text gives the page the keyboard, as it would.
  await page.mouse.click(200, 120);
  for (let step = 0; step < 40; step += 1) {
    if (await reply.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(reply).toBeFocused();
  await expect.poll(() => isClear(reply)).toBe(true);
  const settled = await scrollTopOf(page);
  await page.waitForTimeout(600);
  expect(await scrollTopOf(page)).toBe(settled);
});

// --- Hints and the counterparty's lawyer (layer 3, card 7) ---

type StageState = {
  modes: string[];
  next_hint_level: number | null;
  counterpart_next_step: number | null;
};

/** The stage the server answers, counted again on every read, as it would. */
async function mockModesStage(
  page: import("@playwright/test").Page,
  state: () => StageState,
) {
  const urls: string[] = [];
  await page.route("**/training/stage**", (route, request) => {
    urls.push(request.url());
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stage: "pasante",
        attempt_required: true,
        confidence_required: true,
        ...state(),
      }),
    });
  });
  return urls;
}

test("a hint is asked unrated, the rung moves when the turn ends, and the approach stays", async ({
  addin,
  page,
}) => {
  let rung: number | null = 1;
  const urls = await mockModesStage(page, () => ({
    modes: rung ? ["hint", "counterpart"] : ["counterpart"],
    next_hint_level: rung,
    counterpart_next_step: 1,
  }));
  await addin.mockChatStream(["Mira qué figura está en juego."], { chatId: "hint-chat" });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const hint = page.getByRole("button", { name: "Ask for a hint" });
  await expect(hint).toBeVisible();
  await expect(hint).toHaveAttribute("type", "button");
  await expect(page.getByText("Next: hint 1 of 3, Focus.")).toBeVisible();
  const rungs = page.getByRole("list", { name: "Rungs of the hint ladder" });
  await expect(rungs.getByRole("listitem").nth(0)).toHaveAttribute("aria-current", "step");

  const field = page.getByLabel("Your approach (2–3 lines)");
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  // A hint needs the approach and no mark.
  await hint.click();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill(ATTEMPT);
  rung = 2;
  const request = page.waitForRequest("**/word-chat");
  await hint.click();
  const body = (await request).postDataJSON();
  expect(body.training_mode).toBe("hint");
  expect(body.attempt).toBe(ATTEMPT);
  expect(body).not.toHaveProperty("confidence");
  expect(body.chat_id).toBeUndefined();

  // The turn ended: the stage is read again, for this chat, and the next rung is two.
  await expect(page.getByText("Next: hint 2 of 3, Where to look.")).toBeVisible();
  expect(urls.some((url) => url.includes("chat_id=hint-chat"))).toBe(true);
  await expect(
    rungs.getByRole("listitem").nth(0),
  ).toContainText("used");
  await expect(rungs.getByRole("listitem").nth(1)).toHaveAttribute("aria-current", "step");
  await expect(field).toHaveValue(ATTEMPT);

  // The ladder used up: the button goes and the composer says so.
  rung = null;
  await page.getByPlaceholder("How can I help?").fill("Otra duda");
  await hint.click();
  await expect(page.getByRole("button", { name: "Ask for a hint" })).toHaveCount(0);
  await expect(page.getByText(/asked for all three hints/)).toBeVisible();
});

test("a counterparty round owes the mark, takes its turns and is closed with a line of its own", async ({
  addin,
  page,
}) => {
  let turns = 0;
  await mockModesStage(page, () => ({
    modes: [
      ...(turns < 3 ? ["hint", "counterpart"] : ["hint"]),
      ...(turns > 0 ? ["counterpart_close"] : []),
    ],
    next_hint_level: 1,
    counterpart_next_step: turns < 3 ? turns + 1 : null,
  }));
  await addin.mockChatStream(["1. La cláusula no exige aviso."], { chatId: "round-chat" });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const round = page.getByRole("button", {
    name: "Test it against the counterparty's lawyer",
  });
  await expect(page.getByText("Turn 1 of 3 in this round.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Close the round" })).toHaveCount(0);
  await page.getByPlaceholder("How can I help?").fill("Procede por el impago.");
  await page.getByLabel("Your approach (2–3 lines)").fill(ATTEMPT);
  await round.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mark how sure you are" }),
  ).toBeVisible();
  await page
    .getByRole("radiogroup", { name: "How sure are you of your approach?" })
    .getByRole("radio", { name: "Fairly sure" })
    .click();
  turns = 1;
  let request = page.waitForRequest("**/word-chat");
  await round.click();
  let body = (await request).postDataJSON();
  expect(body.training_mode).toBe("counterpart");
  expect(body.confidence).toBe(3);

  // A round turn is a whole turn: the next owes its own approach and mark.
  await expect(page.getByText("Turn 2 of 3 in this round.")).toBeVisible();
  await expect(page.getByLabel("Your approach (2–3 lines)")).toHaveValue("");
  const close = page.getByRole("button", { name: "Close the round" });
  await expect(close).toBeVisible();
  await page.getByLabel("Your approach (2–3 lines)").fill(ATTEMPT);
  await page
    .getByRole("radiogroup", { name: "How sure are you of your approach?" })
    .getByRole("radio", { name: "Sure", exact: true })
    .click();
  request = page.waitForRequest("**/word-chat");
  await close.click();
  body = (await request).postDataJSON();
  expect(body.training_mode).toBe("counterpart_close");
  expect(body.messages.at(-1).content).toBe(
    "I'm closing the round with the counterparty's lawyer.",
  );
});

test("a chat kept on this device only is offered no hint and no round", async ({
  addin,
  page,
}) => {
  const urls = await mockModesStage(page, () => ({
    modes: ["hint", "counterpart"],
    next_hint_level: 1,
    counterpart_next_step: 1,
  }));
  await addin.mockChatStream(["Answer."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();
  await expect(page.getByRole("button", { name: "Ask for a hint" })).toBeVisible();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Save chats in the cloud" }).click();
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Assistant" }).click();

  await expect(page.getByLabel("Your approach (2–3 lines)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask for a hint" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Help for this turn" })).toHaveCount(0);
  expect(urls.at(-1)).toContain("storage=local");
  expect(urls.at(-1)).not.toContain("chat_id=");
});

const CRITERION = {
  id: "crit-1",
  kind: "criterio",
  practice: "laboral",
  topic: "Prescripción de la rescisión",
  position: "En este despacho se cuenta desde que el patrón conoce la falta.",
  author_name: "Ana Torres",
  playbook_id: null,
  rule_id: null,
  created_at: "2026-11-01T12:00:00Z",
};

test("the criteria the assistant consulted are shown under the answer, with their author", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("GET", "**/training/stage**", { stage: "junior" });
  await addin.mockChatStream(["Procede la rescisión."], {
    chatId: "criteria-chat",
    firmCriteria: [
      {
        call_id: "call-1",
        practice: "laboral",
        topic: "prescripción",
        criteria: [CRITERION],
        truncated: false,
      },
    ],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();
  await page.getByPlaceholder("How can I help?").fill("¿Prescribió la acción?");
  await page.getByRole("button", { name: "Send" }).click();

  const panel = page.getByTestId("firm-criteria-consulted");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("1 criterion consulted")).toBeVisible();
  await panel.getByText("1 criterion consulted").click();
  await expect(panel.getByText("Prescripción de la rescisión")).toBeVisible();
  await expect(panel.getByText(/According to Ana Torres/)).toBeVisible();
  await expect(panel.getByText(/They are not law/)).toBeVisible();
});

test("the consulted criteria read in Spanish and say so when the firm wrote none", async ({
  addin,
  page,
}) => {
  await page.addInitScript(() => window.localStorage.setItem("litt.locale", "es-MX"));
  await addin.mockApiJson("GET", "**/training/stage**", { stage: "junior" });
  await addin.mockChatStream(["Respuesta."], {
    chatId: "criteria-chat-es",
    firmCriteria: [
      { call_id: "call-2", practice: null, topic: "mora", criteria: [], truncated: false },
    ],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();
  await page.getByPlaceholder("How can I help?").fill("¿Hay mora?");
  await page.getByRole("button", { name: "Send" }).click();

  const panel = page.getByTestId("firm-criteria-consulted");
  await expect(panel).toBeVisible();
  await panel.locator("summary").click();
  await expect(panel.getByText("Tu despacho no ha escrito un criterio sobre este tema.")).toBeVisible();
});
