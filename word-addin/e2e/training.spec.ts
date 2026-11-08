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
  await note.getByRole("button", { name: "Reply to the question about your basis" }).click();
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
