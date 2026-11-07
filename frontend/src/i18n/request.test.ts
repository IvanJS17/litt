import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, acceptLanguage: null as string | null }));

vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) => (name === "LITT_LOCALE" && request.cookie !== undefined ? { name, value: request.cookie } : undefined),
    }),
    headers: async () => new Headers(request.acceptLanguage === null ? {} : { "accept-language": request.acceptLanguage }),
}));
// getRequestConfig only hands the function back to next-intl's server runtime.
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));

async function resolve() {
    const { default: getConfig } = await import("./request");
    return (getConfig as unknown as () => Promise<{ locale: string; timeZone: string; messages: { common: { save: string } } }>)();
}

describe("i18n request config", () => {
    beforeEach(() => {
        request.cookie = undefined;
        request.acceptLanguage = null;
    });

    it("uses the LITT_LOCALE cookie first, over the browser's languages", async () => {
        request.cookie = "es-MX";
        request.acceptLanguage = "en-US,en;q=0.9";
        const config = await resolve();
        expect(config.locale).toBe("es-MX");
        expect(config.messages.common.save).toBe("Guardar");
        request.cookie = "en-US";
        request.acceptLanguage = "es-MX";
        expect((await resolve()).messages.common.save).toBe("Save");
    });

    it("falls back to Accept-Language, by quality, when the cookie is absent or unsupported", async () => {
        request.acceptLanguage = "es;q=0.3, en-GB;q=0.9";
        expect((await resolve()).locale).toBe("en-US");
        request.cookie = "fr-FR";
        request.acceptLanguage = "es-ES,es;q=0.9";
        expect((await resolve()).locale).toBe("es-MX");
    });

    it("falls back to es-MX when nothing matches, in Mexico City time", async () => {
        request.acceptLanguage = "de-DE,fr;q=0.8";
        const config = await resolve();
        expect(config.locale).toBe("es-MX");
        expect(config.timeZone).toBe("America/Mexico_City");
        request.acceptLanguage = null;
        expect((await resolve()).locale).toBe("es-MX");
    });
});
