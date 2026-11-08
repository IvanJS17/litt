import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SOURCE_LOCALE, SOURCE_MESSAGES, loadMessages, type Messages } from "@litt/i18n";
import { clientLocale, configureClientLocale } from "./locale";
import { reportedUpstreamMessage } from "./reportedUpstream";
import { retryToastAction } from "./toastStore";
import {
    GENERIC_FAILURE_MESSAGE,
    SERVER_FAILURE_MESSAGE,
    buildSupportMailto,
    describeError,
    networkMessage,
} from "./userError";

const apiError = (status: number, code: string | null, message: string) =>
    Object.assign(new Error(message), { status, code, requestId: "req-1" });

describe("failure text in es-MX", () => {
    beforeEach(async () => {
        vi.stubGlobal("navigator", { onLine: true, userAgent: "vitest" });
        configureClientLocale("es-MX", await loadMessages("es-MX"));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        configureClientLocale(SOURCE_LOCALE, SOURCE_MESSAGES);
    });

    it("titles and explains a classified failure in Spanish", () => {
        expect(clientLocale()).toBe("es-MX");
        expect(describeError(new TypeError("Failed to fetch"))).toMatchObject({
            kind: "network",
            title: "Problema de conexión",
            message:
                "LiTT no pudo comunicarse con el servidor. Revisa tu conexión e inténtalo de nuevo.",
        });
        expect(describeError(apiError(500, null, "boom"))).toMatchObject({
            title: "Algo salió mal",
            message: "Algo salió mal de nuestro lado. Inténtalo de nuevo.",
        });
    });

    it("composes the action into the title", () => {
        expect(describeError(apiError(403, null, ""), { action: "guardar el documento." }).title).toBe(
            "No se pudo guardar el documento",
        );
    });

    it("prefers the catalog's sentence for a known code over the server's English", () => {
        const described = describeError(
            apiError(409, "chat_route_pinned", "This conversation is fixed to the model it was started with."),
        );
        expect(described).toMatchObject({
            kind: "validation",
            message:
                "Esta conversación usa el modelo con el que empezó. Inicia una conversación nueva para usar otro modelo.",
        });
    });

    it("keeps the server's words for a code whose sentence carries a value, or an unknown code", () => {
        const detail = "An API key is required to use gpt-5. Add the key or select another model.";
        expect(describeError(apiError(400, "missing_api_key", detail)).message).toBe(detail);
        expect(describeError(apiError(400, "made_up_code", "Title is too long.")).message).toBe(
            "Title is too long.",
        );
    });

    it("lets a call site's own sentence and a fallback win as before", () => {
        expect(
            describeError(apiError(409, "review_stale", "x"), {
                codeMessages: { review_stale: "Recarga la revisión." },
            }).message,
        ).toBe("Recarga la revisión.");
        expect(describeError("odd", { fallback: "No se pudo." }).message).toBe("No se pudo.");
    });

    it("names the unreachable server, and translates the reported 5xx sentences", () => {
        expect(networkMessage("https://litt.example")).toBe(
            "LiTT no pudo comunicarse con el servidor en https://litt.example. Revisa tu conexión y que el servidor esté funcionando, y vuelve a intentarlo.",
        );
        expect(reportedUpstreamMessage("upstream_unavailable")).toBe(
            "No se puede contactar al servidor por el momento. Inténtalo de nuevo en unos minutos.",
        );
        expect(reportedUpstreamMessage("internal_error")).toBeNull();
    });

    it("labels Retry in Spanish", () => {
        expect(retryToastAction(() => {}, () => {}).label).toBe("Reintentar");
    });

    it("writes the support email in Spanish and keeps the diagnostic lines as support reads them", () => {
        const described = describeError(apiError(500, "internal_error", "boom"));
        const href = buildSupportMailto(described, {
            note: "Contrato.docx",
            when: new Date("2026-11-07T12:00:00Z"),
        });
        const body = new URLSearchParams(href.slice(href.indexOf("?") + 1)).get("body") ?? "";
        expect(decodeURIComponent(href)).toContain("subject=Soporte de LiTT: Algo salió mal");
        expect(body).toContain("Hola, equipo de LiTT:");
        expect(body).toContain("Qué pasó: Algo salió mal");
        expect(body).toContain("Detalles: Contrato.docx");
        expect(body).toContain("--- Datos para soporte (no los borres) ---");
        expect(body).toContain("Request ID: req-1");
        expect(body).toContain("Error code: internal_error");
        expect(body.trim().endsWith("Gracias.")).toBe(true);
    });

    it("keeps the exported constants in the source language", () => {
        expect(GENERIC_FAILURE_MESSAGE).toBe(SOURCE_MESSAGES.errors.message.unknown);
        expect(SERVER_FAILURE_MESSAGE).toBe(SOURCE_MESSAGES.errors.message.server);
    });
});

describe("failure text before any locale is configured (the Word add-in today)", () => {
    beforeEach(() => vi.stubGlobal("navigator", { onLine: true, userAgent: "vitest" }));
    afterEach(() => vi.unstubAllGlobals());

    it("speaks en-US, and fills a missing detail from a known code", () => {
        expect(clientLocale()).toBe("en-US");
        expect(describeError(apiError(409, "matter_has_owner", "")).message).toBe(
            "This matter already has an owner.",
        );
        expect(describeError(apiError(409, "matter_has_owner", "The server's own words.")).message).toBe(
            "The server's own words.",
        );
    });

    it("shows a key the catalog lacks as its path, and warns outside production", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        configureClientLocale("es-MX", { errors: {} } as unknown as Messages);
        try {
            expect(describeError(apiError(403, null, "")).title).toBe("errors.title.forbidden");
            expect(warn).toHaveBeenCalled();
        } finally {
            configureClientLocale(SOURCE_LOCALE, SOURCE_MESSAGES);
            warn.mockRestore();
        }
    });
});
