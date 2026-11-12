import { defineConfig } from "@playwright/test";

/** Editor round-trip check: `npx playwright test -c playwright.docx-roundtrip.config.ts`. */
export default defineConfig({
    testDir: "./frontend/docx-roundtrip",
    testMatch: /roundtrip\.spec\.ts/,
    timeout: 60_000,
    workers: 1,
    reporter: "list",
    use: { baseURL: "http://localhost:5199" },
    webServer: {
        command: "npx vite --config docx-roundtrip/vite.config.mjs --port 5199 --strictPort",
        cwd: "./frontend",
        url: "http://localhost:5199",
        reuseExistingServer: true,
        timeout: 120_000,
    },
});
