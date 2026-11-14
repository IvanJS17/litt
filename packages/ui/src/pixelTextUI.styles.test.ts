import { describe, expect, it } from "vitest";
import { PIXEL_TEXT_CLASS, pixelTextClass } from "./pixelTextUI.styles";

describe("pixelTextClass", () => {
    it("is 11 px fixed, never in rem", () => {
        expect(PIXEL_TEXT_CLASS).toContain("font-pixel");
        expect(PIXEL_TEXT_CLASS).toContain("text-[11px]");
        expect(PIXEL_TEXT_CLASS).not.toMatch(/rem|text-(xs|sm|2xs|3xs)/);
    });

    it("takes pieces of 1 to 12 characters", () => {
        for (const text of ["V3", "12", "1/5", "OpenRouter", "Configurado", "a1b2c3d"]) {
            expect(pixelTextClass(text)).toBe(PIXEL_TEXT_CLASS);
        }
        expect(pixelTextClass("Anthropic Co", "x")).toBe("x");
    });

    it("leaves phrases and long words to the normal face", () => {
        expect(pixelTextClass("Directamente en el servidor", "text-2xs")).toBe("text-2xs");
        expect(pixelTextClass("Infraestructura")).toBe("");
        expect(pixelTextClass("  ")).toBe("");
        expect(pixelTextClass("")).toBe("");
    });
});
