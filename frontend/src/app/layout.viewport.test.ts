import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
    getLocale: async () => "es-MX",
    getMessages: async () => ({}),
    getTranslations: async () => (key: string) => key,
}));
vi.mock("./fonts/fonts.css", () => ({}));
vi.mock("./globals.css", () => ({}));
vi.mock("@/app/components/providers", () => ({ Providers: () => null }));
vi.mock("@/i18n/IntlClientProvider", () => ({
    IntlClientProvider: () => null,
}));

describe("root viewport", () => {
    // Without viewport-fit=cover iOS treats every env(safe-area-inset-*) as 0,
    // so the safe-area margins on the mobile header, composer, sidebar and
    // notices would do nothing.
    it("extends under the notch so the safe-area insets apply", async () => {
        const { viewport } = await import("./layout");
        expect(viewport.viewportFit).toBe("cover");
    });

    // Pinch-zoom must stay available (accessibility).
    it("does not lock zoom", async () => {
        const { viewport } = await import("./layout");
        expect(viewport).not.toHaveProperty("maximumScale");
        expect(viewport).not.toHaveProperty("userScalable");
    });
});

describe("root metadata", () => {
    it("says noindex on every page while the beta is closed", async () => {
        const { generateMetadata } = await import("./layout");
        const metadata = await generateMetadata();
        expect(metadata.robots).toEqual({ index: false, follow: false });
    });

    it("makes LiTT an installable web app", async () => {
        const { generateMetadata } = await import("./layout");
        const metadata = await generateMetadata();
        expect(metadata.appleWebApp).toMatchObject({ capable: true, title: "LiTT" });
        expect(metadata.other).toMatchObject({ "apple-mobile-web-app-capable": "yes" });
    });
});
