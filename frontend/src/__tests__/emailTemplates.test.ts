// Every mail GoTrue can send a person is in Spanish and carries the LiTT mark:
// each template the production compose points at exists, and each kind has a
// Spanish subject. A kind without a template falls back to GoTrue's generic
// English mail, which reads as phishing from a legal product.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "../../..");
const compose = readFileSync(join(REPO, "deploy/prod/compose.yaml"), "utf8");
const setting = (prefix: string) =>
    [...compose.matchAll(new RegExp(`GOTRUE_MAILER_${prefix}_([A-Z_]+): (.+)`, "g"))].map((m): [string, string] => [m[1], m[2].trim()]);

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

    it("the change-of-email mail links to the server-side token_hash confirmation and names the new address", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/email_change.html"), "utf8");
        expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=email_change&amp;next=/settings%3FemailChange%3Dprocessed");
        expect(html).not.toContain("{{ .ConfirmationURL }}");
        expect(html).toContain("{{ .NewEmail }}");
    });

    it("the signup confirmation mail links to the server-side token_hash confirmation, not to the PKCE link", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/confirmation.html"), "utf8");
        expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup&amp;next=/onboarding/profile");
        expect(html).not.toContain("{{ .ConfirmationURL }}");
    });

    it("the invite mail keeps the implicit-flow link", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/invite.html"), "utf8");
        expect(html).toContain("{{ .ConfirmationURL }}");
    });

    it("the recovery mail links to the server-side token_hash confirmation, not to the PKCE link", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/recovery.html"), "utf8");
        expect(html).toContain("{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password");
        expect(html).not.toContain("{{ .ConfirmationURL }}");
    });

    it("GoTrue's SITE_URL is the public URL the recovery link is built on", () => {
        expect(compose).toMatch(/GOTRUE_SITE_URL: \$\{PUBLIC_URL:\?required\}/);
    });

    it("the reauthentication mail shows the code", () => {
        const html = readFileSync(join(REPO, "frontend/public/email-templates/reauthentication.html"), "utf8");
        expect(html).toContain("{{ .Token }}");
    });

    // The value in every mail link is derived from a numeric code. GoTrue
    // defaults to 6 digits and accepts at most 10 (a larger setting falls back
    // to 6); every stack that runs GoTrue must set 10 explicitly.
    it("every stack that runs GoTrue sets the longest e-mail code", () => {
        const composeFiles = [".", "deploy/prod"].flatMap((dir) =>
            readdirSync(join(REPO, dir))
                .filter((name) => /^(docker-)?compose.*\.ya?ml$/.test(name))
                .map((name) => join(dir, name)),
        );
        const withGoTrue = composeFiles.filter((file) => readFileSync(join(REPO, file), "utf8").includes("supabase/gotrue"));
        expect(withGoTrue.sort()).toEqual(["compose.staging.yml", "deploy/prod/compose.yaml", "docker-compose.yml"]);
        for (const file of withGoTrue) {
            // Anchored to the start of the line: a commented-out setting does not count.
            expect(readFileSync(join(REPO, file), "utf8"), file).toMatch(/^\s+GOTRUE_MAILER_OTP_LENGTH: ['"]?10['"]?\s*$/m);
        }
        expect(readFileSync(join(REPO, "backend/supabase/config.toml"), "utf8")).toMatch(/^otp_length = 10$/m);
    });
});
