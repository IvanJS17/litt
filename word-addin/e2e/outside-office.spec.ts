/**
 * taskpane.html opened outside Word: Office.js resolves onReady with no
 * host, and OfficeRuntime does not exist. Crawlers and link previews do this
 * (it used to show a broken pane); so does a person who pastes the URL into a
 * browser. The pane must say where it belongs, never start sign-in, and send
 * nothing to anyone. An Office client that reports its diagnostics but no host
 * (a misdetected real Word) gets the same notice.
 */
import { test, expect } from "./support/fixtures";
import { installOfficeMock } from "./support/office-mock";

for (const [title, options] of [
  ["outside Office the pane points to Word without signing in or sending anything", { outsideOffice: true }],
  [
    "a hostless onReady inside an Office client shows the same notice",
    { outsideOffice: true, outsideOfficeDiagnostics: true },
  ],
] as const) {
  test(title, async ({ addin: _addin, page }) => {
    const sessionRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/auth/session")) sessionRequests.push(request.url());
    });
    // LiTT sends no telemetry: no request may leave for an envelope endpoint.
    const envelopes: string[] = [];
    await page.route("**/api/1/envelope/**", (route, request) => {
      envelopes.push(request.postData() ?? "");
      return route.fulfill({ status: 200, body: "{}" });
    });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.addInitScript(installOfficeMock, options);
    await page.goto("/taskpane.html");

    await expect(page.getByText("Open LiTT in Word")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in" })).toHaveCount(0);
    // Let any deferred effect flush before asserting absence.
    await page.waitForTimeout(500);
    expect(sessionRequests).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(envelopes).toEqual([]);
  });
}
