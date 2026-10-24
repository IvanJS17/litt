import { test, expect } from "./support/fixtures";

// AGPL-3.0 §13: the add-in links the source of the exact commit it was built
// from. `build:e2e` embeds GIT_SHA (or the checkout's HEAD).
test("settings link the source of the build's exact commit", async ({
  addin,
  page,
}) => {
  await addin.gotoTaskpane({ token: "source-code-link-token" });
  await addin.expectAuthedShell();

  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();

  const link = page.getByRole("link", { name: /^Código fuente/ });
  await expect(link).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/IvanJS17\/litt\/tree\/[0-9a-f]{40}$/,
  );
  await expect(link).toHaveAttribute("target", "_blank");
});
