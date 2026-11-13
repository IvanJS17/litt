// Every mail GoTrue can send a person is in Spanish and carries the LiTT mark:
// each template the production compose points at exists, and each kind has a
// Spanish subject. A kind without a template falls back to GoTrue's generic
// English mail, which reads as phishing from a legal product.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const compose = readFileSync(join(REPO, "deploy/prod/compose.yaml"), "utf8");
const setting = (prefix: string) =>
    [...compose.matchAll(new RegExp(`GOTRUE_MAILER_${prefix}_([A-Z_]+): (.+)`, "g"))].map((m) => [m[1], m[2].trim()]);

const KINDS = ["INVITE", "CONFIRMATION", "RECOVERY", "EMAIL_CHANGE", "REAUTHENTICATION"];

describe("GoTrue mail templates (production)", () => {
    const templates = new Map(setting("TEMPLATES"));
    const subjects = new Map(setting("SUBJECTS"));

    it.each(KINDS)("%s has a template and a Spanish subject", (kind) => {
        expect(templates.has(kind)).toBe(true);
        expect(subjects.get(kind)?.length).toBeGreaterThan(0);
    });

    it.each(KINDS)("the %s template exists and is Spanish with the LiTT wordmark", (kind) => {
        const url = templates.get(kind)!;
        const file = join(REPO, "frontend/public/email-templates", url.split("/").pop()!);
        expect(existsSync(file)).toBe(true);
        const html = readFileSync(file, "utf8");
        expect(html).toContain('<html lang="es">');
        expect(html).toContain("LiTT<span");
    });

    it("the change-of-email mail links to the confirmation and names the new address", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/email_change.html"), "utf8");
        expect(html).toContain("{{ .ConfirmationURL }}");
        expect(html).toContain("{{ .NewEmail }}");
    });

    it("the reauthentication mail shows the code", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/reauthentication.html"), "utf8");
        expect(html).toContain("{{ .Token }}");
    });
});
