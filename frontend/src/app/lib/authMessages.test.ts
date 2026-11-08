import { describe, expect, it } from "vitest";
import { SOURCE_LOCALE, SOURCE_MESSAGES, loadMessages } from "@litt/i18n";
import { configureClientLocale } from "@mike/client";
import {
    AUTH_ERROR_MESSAGES,
    LINK_SPENT_MESSAGE,
    PASSWORD_LENGTH_MESSAGE,
    TOO_MANY_ATTEMPTS_MESSAGE,
    authMessages,
} from "./authMessages";
import {
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    isPasswordTooLong,
    passwordByteLength,
} from "@/app/components/auth/passwordPolicy";

describe("authMessages", () => {
    it("hands out the shared table when a screen has no deltas", () => {
        expect(authMessages()).toEqual(AUTH_ERROR_MESSAGES);
    });

    it("applies a screen's overrides without mutating the shared table", () => {
        const scoped = authMessages({
            invalid_request: "Enter a valid company email address.",
        });
        expect(scoped.invalid_request).toBe(
            "Enter a valid company email address.",
        );
        expect(scoped.session_expired).toBe(
            AUTH_ERROR_MESSAGES.session_expired,
        );
        expect(AUTH_ERROR_MESSAGES.invalid_request).toBe(
            "Some of the information provided isn't valid.",
        );
    });

    it("says one thing per code, whichever screen asks", () => {
        // These three had drifted between the per-screen tables: the same
        // failure read differently depending on the form in front of you.
        for (const code of [
            "user_not_found",
            "same_password",
            "signup_disabled",
        ] as const) {
            expect(authMessages()[code]).toBe(AUTH_ERROR_MESSAGES[code]);
        }
    });

    it("takes the password numbers from the policy, not from copies", () => {
        expect(AUTH_ERROR_MESSAGES.password_too_long).toContain(
            String(MAX_PASSWORD_LENGTH),
        );
        expect(AUTH_ERROR_MESSAGES.password_too_short).toContain(
            String(MIN_PASSWORD_LENGTH),
        );
    });
});

describe("authMessages in es-MX", () => {
    it("reads each sentence in the configured locale, even from a table built earlier", async () => {
        // Screens build their table at module scope, before the locale is known.
        const screenTable = authMessages({ invalid_request: "Use a company email." });
        configureClientLocale("es-MX", await loadMessages("es-MX"));
        try {
            expect(AUTH_ERROR_MESSAGES.invalid_credentials).toBe(
                "El correo o la contraseña no son correctos.",
            );
            expect(screenTable.session_expired).toBe("Tu sesión expiró. Vuelve a iniciar sesión.");
            expect(screenTable.password_too_short).toBe(
                `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
            );
            // A screen's own wording is its own until that screen moves to the catalog.
            expect(screenTable.invalid_request).toBe("Use a company email.");
        } finally {
            configureClientLocale(SOURCE_LOCALE, SOURCE_MESSAGES);
        }
        expect(screenTable.session_expired).toBe("Your session has expired. Log in again.");
    });

    it("keeps the reused sentences in the source wording", () => {
        expect(TOO_MANY_ATTEMPTS_MESSAGE).toBe("Too many attempts. Wait a moment and try again.");
        expect(LINK_SPENT_MESSAGE).toBe(AUTH_ERROR_MESSAGES.flow_state_expired);
        expect(PASSWORD_LENGTH_MESSAGE).toBe(
            `Password must have at least ${MIN_PASSWORD_LENGTH} characters and use at most ${MAX_PASSWORD_LENGTH} UTF-8 bytes.`,
        );
    });
});

describe("the password length policy", () => {
    it("counts bcrypt's limit in bytes, not characters", () => {
        // 36 accented characters are 36 long and 72 bytes: legal.
        expect(passwordByteLength("é".repeat(36))).toBe(72);
        expect(isPasswordTooLong("é".repeat(36))).toBe(false);
        // 37 is one byte over, though `length` still says 37 <= 72.
        expect("é".repeat(37).length).toBeLessThan(MAX_PASSWORD_LENGTH);
        expect(isPasswordTooLong("é".repeat(37))).toBe(true);
        // An emoji is four bytes.
        expect(isPasswordTooLong("🙂".repeat(18))).toBe(false);
        expect(isPasswordTooLong("🙂".repeat(19))).toBe(true);
        expect(isPasswordTooLong("x".repeat(MAX_PASSWORD_LENGTH))).toBe(false);
    });
});
