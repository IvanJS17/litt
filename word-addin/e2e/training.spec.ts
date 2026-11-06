/**
 * LiTT training ("Tu turno primero", docs/training.md) in the Word add-in: a
 * pasante writes their own approach before each turn; anybody else sees the
 * composer of today. The stage and the turn are mocked; no backend is used.
 */
import { test, expect } from "./support/fixtures";

const ATTEMPT =
  "Creo que procede la rescisión por incumplimiento de la cláusula quinta.";

test.beforeEach(async ({ addin }) => {
  addin.seedToken("test-jwt-token");
});

test("a pasante sends their approach with the turn and sees it in the thread", async ({
  addin,
  page,
}) => {
  await addin.mockApiJson("GET", "**/training/stage**", { stage: "pasante" });
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
      },
    ],
  });
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  const field = page.getByLabel("Tu planteamiento (2–3 líneas)");
  await expect(field).toBeVisible();
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  await field.fill("Muy corto");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(field).toHaveAttribute("aria-invalid", "true");

  await field.fill(ATTEMPT);
  const request = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  const body = (await request).postDataJSON();
  expect(body.attempt).toBe(ATTEMPT);
  const note = page.getByRole("region", { name: "Notas privadas de formación" });
  await expect(note.getByText("Tu planteamiento", { exact: true })).toBeVisible();
  await expect(note.getByText(ATTEMPT, { exact: true })).toBeVisible();
  await expect(
    note.getByText("Coincide: la cláusula quinta sostiene la rescisión."),
  ).toBeVisible();
  // Only the note carries the approach; the thread shows it once.
  await expect(page.getByText(ATTEMPT, { exact: true })).toHaveCount(1);
});

test("anybody without a pasante stage sees the composer of today", async ({
  addin,
  page,
}) => {
  await addin.mockChatStream(["Answer."]);
  await addin.gotoTaskpane();
  await addin.expectAuthedShell();

  await expect(page.getByLabel("Tu planteamiento (2–3 líneas)")).toHaveCount(0);
  await page.getByPlaceholder("How can I help?").fill("¿Procede la rescisión?");
  const request = page.waitForRequest("**/word-chat");
  await page.getByRole("button", { name: "Send" }).click();
  expect((await request).postDataJSON()).not.toHaveProperty("attempt");
});
