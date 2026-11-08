/**
 * Text the Word add-in makes outside React follows the pane's language, and
 * the profile call that saves it sends the shape the backend reads.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientTranslator } from "@mike/client";
import { loadLocale } from "../../../word-addin/src/taskpane/i18n/loadLocale";
import {
    sessionCheckFailedMessage,
    sessionExpiredMessage,
} from "../../../word-addin/src/taskpane/lib/sessionRefresh";
import {
    supportDraftMessage,
    supportHandoffResult,
} from "../../../word-addin/src/taskpane/lib/supportHandoff";
import {
    configureMikeApiClient,
    updateUiLocale,
} from "../../../word-addin/src/taskpane/api/client";

afterEach(async () => {
    await loadLocale("en-US");
});

describe("add-in text outside React", () => {
    it("speaks es-MX once the pane is configured for it", async () => {
        await loadLocale("es-MX");
        expect(sessionCheckFailedMessage()).toBe(
            "No se pudo comprobar tu sesión. Revisa tu conexión e inténtalo de nuevo.",
        );
        expect(sessionExpiredMessage()).toContain("sesión");
        expect(supportDraftMessage()).toBe("Se abrió el borrador del correo");
        expect(clientTranslator()("word.notify.contactSupport")).toBe("Contactar a soporte");
        expect(
            supportHandoffResult({ copied: true, opened: false, details: "x" }).message,
        ).toMatch(/^Escribe a .+ los detalles están en tu portapapeles$/);
        expect(
            supportHandoffResult({ copied: false, opened: false, details: "x" }).message,
        ).toMatch(/^Escribe a /);
    });

    it("stays in English in en-US", async () => {
        await loadLocale("en-US");
        expect(sessionCheckFailedMessage()).toBe(
            "Couldn't check your session. Check your connection and try again.",
        );
    });
});

describe("updateUiLocale", () => {
    it("PATCHes uiLocale to the profile, and null to clear it", async () => {
        const fetchMock = vi.fn<typeof fetch>(
            async () =>
                new Response(JSON.stringify({ uiLocale: "es-MX" }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                }),
        );
        configureMikeApiClient({
            baseUrl: "https://api.example.test",
            getAuthHeaders: async () => ({}),
            fetchImpl: fetchMock,
        });
        await updateUiLocale("es-MX");
        await updateUiLocale(null);
        const calls = fetchMock.mock.calls.map(([url, init]) => [
            String(url),
            init?.method,
            init?.body,
        ]);
        expect(calls).toEqual([
            ["https://api.example.test/user/profile", "PATCH", '{"uiLocale":"es-MX"}'],
            ["https://api.example.test/user/profile", "PATCH", '{"uiLocale":null}'],
        ]);
    });
});
