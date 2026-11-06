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
  await addin.mockChatStream(["Contraste con tu planteamiento: coincide."]);
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
  await expect(page.getByText("Tu planteamiento", { exact: true })).toBeVisible();
  await expect(page.getByText(ATTEMPT, { exact: true })).toBeVisible();
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
