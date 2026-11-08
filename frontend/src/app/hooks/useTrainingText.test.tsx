import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import enUS from "../../../../packages/i18n/messages/en-US.json";
import esMX from "../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";
import { useTrainingText } from "./useTrainingText";

const inLocale = (locale: "en-US" | "es-MX", messages: typeof enUS) =>
    function Wrapper({ children }: { children: ReactNode }) {
        return (
            <IntlClientProvider locale={locale} messages={messages}>
                {children}
            </IntlClientProvider>
        );
    };

describe("useTrainingText", () => {
    it("gives the shared training components their words in es-MX, addressing the user as tú", () => {
        const { result } = renderHook(() => useTrainingText(), { wrapper: inLocale("es-MX", esMX as typeof enUS) });
        const { attempt, confidence, note } = result.current;
        expect(attempt.label).toBe("Tu planteamiento (2–3 líneas)");
        expect(attempt.tooShort({ length: 10, min: 60, missing: 50 })).toContain("Faltan 50 caracteres");
        expect(attempt.tooShort({ length: 59, min: 60, missing: 1 })).toContain("Falta 1 carácter");
        expect(attempt.tooLong({ length: 4001, max: 4000, excess: 1 })).toBe(
            "4001/4000 caracteres. Sobra 1 carácter.",
        );
        expect(confidence.legend).toBe("¿Qué tan seguro estás de tu planteamiento?");
        expect(Object.values(confidence.levels)).toEqual(["Casi adivino", "Dudo", "Bastante seguro", "Seguro"]);
        expect(note.verdicts).toEqual({
            coincide: "Coincide",
            parcial: "Coincide en parte",
            no_coincide: "No coincide",
        });
        expect(note.verdictHeading).toContain("según el contraste de la IA");
        expect(note.confidence("Seguro")).toBe("Tu marca: Seguro");
    });

    it("words an urgency pass by the day it ends", () => {
        const { result } = renderHook(() => useTrainingText(), { wrapper: inLocale("es-MX", esMX as typeof enUS) });
        const today = new Date();
        today.setHours(23, 0, 0, 0);
        expect(result.current.urgencyPass(today.toISOString())).toMatch(/^Pase de urgencia vigente hasta las /);
        const later = new Date(Date.now() + 3 * 86_400_000);
        expect(result.current.urgencyPass(later.toISOString())).toMatch(/^Pase de urgencia vigente hasta el .*, a las /);
    });

    it("keeps the English source words in en-US", () => {
        const { result } = renderHook(() => useTrainingText(), { wrapper: inLocale("en-US", enUS) });
        expect(result.current.note.reply).toBe("Reply");
        expect(result.current.confidence.levels[1]).toBe("Almost a guess");
    });
});
