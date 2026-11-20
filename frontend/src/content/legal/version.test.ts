import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LEGAL_VERSION } from "./version";

const read = (file: string) => readFileSync(path.join(process.cwd(), "src/content/legal", file), "utf8");

describe("LEGAL_VERSION", () => {
    it("is the same in the backend and the frontend (raise both together)", () => {
        const backend = readFileSync(
            path.join(process.cwd(), "../backend/src/modules/user/user.profile.storage.ts"),
            "utf8",
        ).match(/export const LEGAL_VERSION = "([^"]+)";/);
        expect(backend?.[1]).toBe(LEGAL_VERSION);
        expect(LEGAL_VERSION).toBe("2026-11-20");
    });

    it("both texts carry the date of the version as their last update and entry into force", () => {
        for (const file of ["terminos-y-condiciones.md", "aviso-de-privacidad.md"]) {
            const markdown = read(file);
            expect(markdown).toContain("**Última actualización:** 20 de noviembre de 2026");
            expect(markdown).toContain("**Entrada en vigor:** 20 de noviembre de 2026");
        }
    });

    it("the texts carry Donna and ContextLex MX, on in every project, with no waiting period", () => {
        const terms = read("terminos-y-condiciones.md");
        const privacy = read("aviso-de-privacidad.md");
        expect(terms).toContain("15. **Donna en las solicitudes.**");
        expect(terms).toContain("16. **ContextLex MX.**");
        expect(privacy).toContain("**Clasificación de solicitudes con TypeSafe.**");
        expect(privacy).toContain("**ContextLex MX.**");
        for (const markdown of [terms, privacy, read("avisoSimplificado.ts")]) {
            expect(markdown).not.toMatch(/6 de diciembre|desmarcad[ao]s? en los (asuntos|proyectos)|NOTA/);
        }
        expect(read("avisoSimplificado.ts")).toContain("En los proyectos con Donna activada");
    });
});
