/**
 * The task pane's bilingual base: the login in es-MX, the language selector
 * on the login and in Settings, and the profile's choice winning.
 */
import React from "react";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientLocale } from "@mike/client";
import type { Locale } from "@litt/i18n";

const { updateUiLocale, getUserProfile, login } = vi.hoisted(() => ({
    updateUiLocale: vi.fn(),
    getUserProfile: vi.fn(),
    login: vi.fn(),
}));
vi.mock("../../../word-addin/src/taskpane/api/mikeApi", () => ({
    updateUiLocale,
    getUserProfile,
}));
vi.mock("../../../word-addin/src/taskpane/auth/useAuth", () => ({
    useAuth: () => ({
        login,
        loginWithGoogle: vi.fn(),
        logout: vi.fn(),
        loading: false,
        error: null,
        user: null,
    }),
}));
vi.mock("../../../word-addin/src/taskpane/lib/errorReporting", () => ({
    reportError: vi.fn(),
    isReported: () => false,
}));

import { LocaleProvider } from "../../../word-addin/src/taskpane/i18n/LocaleProvider";
import { loadLocale } from "../../../word-addin/src/taskpane/i18n/loadLocale";
import { LOCALE_STORAGE_KEY } from "../../../word-addin/src/taskpane/i18n/locale";
import { useProfileLocale } from "../../../word-addin/src/taskpane/hooks/useProfileLocale";
import { LoginPage } from "../../../word-addin/src/taskpane/auth/LoginPage";
import { SettingsPage } from "../../../word-addin/src/taskpane/components/settings/SettingsPage";

async function inPane(locale: Locale, ui: React.ReactElement) {
    const initial = await loadLocale(locale);
    return render(<LocaleProvider initial={initial}>{ui}</LocaleProvider>);
}

const settingsPage = (
    <SettingsPage
        storageMode="cloud"
        onStorageModeChange={async () => {}}
        onClearLocalChats={async () => {}}
    />
);

beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    updateUiLocale.mockResolvedValue({});
});
afterEach(() => window.localStorage.clear());

describe("Word login", () => {
    it("is in es-MX", async () => {
        await inPane("es-MX", <LoginPage />);
        expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
        expect(screen.getByLabelText("Correo electrónico")).toBeVisible();
        expect(screen.getByLabelText("Contraseña")).toBeVisible();
        expect(screen.getByText("¿Olvidaste tu contraseña?")).toBeVisible();
        expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Continuar con Google" })).toBeVisible();
        expect(screen.getByText("o")).toBeInTheDocument();
        expect(screen.getByText(/¿No tienes una cuenta\?/)).toBeVisible();
        expect(screen.getByRole("link", { name: "Regístrate" })).toBeVisible();
        expect(screen.queryByText("Log In")).not.toBeInTheDocument();
    });

    it("keeps the source English in en-US", async () => {
        await inPane("en-US", <LoginPage />);
        expect(screen.getByRole("heading", { name: "Log in" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Continue with Google" })).toBeVisible();
    });

    it("switches language from its own selector without a reload, and remembers it", async () => {
        await inPane("es-MX", <LoginPage />);
        const select = screen.getByRole("combobox", { name: "Idioma de la interfaz" });
        // Each language is named in its own language.
        expect(screen.getByRole("option", { name: "Español (México)" })).toBeInTheDocument();
        expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
        await userEvent.selectOptions(select, "en-US");
        expect(await screen.findByRole("heading", { name: "Log in" })).toBeVisible();
        expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en-US");
        expect(clientLocale()).toBe("en-US");
        expect(updateUiLocale).not.toHaveBeenCalled();
    });
});

describe("the language selector in Settings", () => {
    it("saves ui_locale in the profile, then switches the pane without a reload", async () => {
        await inPane("en-US", settingsPage);
        expect(screen.getByRole("heading", { name: /Save chats in the cloud/ })).toBeVisible();
        await userEvent.selectOptions(
            screen.getByRole("combobox", { name: "Interface language" }),
            "es-MX",
        );
        expect(updateUiLocale).toHaveBeenCalledExactlyOnceWith("es-MX");
        expect(await screen.findByText("Ajustes")).toBeVisible();
        expect(screen.getByRole("combobox", { name: "Idioma de la interfaz" })).toHaveValue("es-MX");
        // Page state survives: the other settings are still on screen, now in Spanish.
        expect(screen.getByRole("heading", { name: /Guardar chats en la nube/ })).toBeVisible();
        expect(clientLocale()).toBe("es-MX");
        expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("es-MX");
    });

    it("keeps the current language and says so when the profile cannot be saved", async () => {
        updateUiLocale.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        await inPane("es-MX", settingsPage);
        await userEvent.selectOptions(
            screen.getByRole("combobox", { name: "Idioma de la interfaz" }),
            "en-US",
        );
        expect(await screen.findByRole("alert")).toBeVisible();
        expect(screen.getByRole("combobox", { name: "Idioma de la interfaz" })).toHaveValue("es-MX");
        expect(screen.getByText("Ajustes")).toBeVisible();
        expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    });
});

describe("the profile's language", () => {
    function Probe({ userId }: { userId: string | null }) {
        useProfileLocale(userId);
        return <LoginPage />;
    }

    it("wins over the language the pane started in", async () => {
        getUserProfile.mockResolvedValue({ uiLocale: "en-US" });
        await inPane("es-MX", <Probe userId="u1" />);
        expect(await screen.findByRole("heading", { name: "Log in" })).toBeVisible();
    });

    it("leaves the language alone when the profile has none or cannot be read", async () => {
        getUserProfile.mockResolvedValueOnce({ uiLocale: null });
        await inPane("es-MX", <Probe userId="u1" />);
        await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(1));
        expect(screen.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();

        getUserProfile.mockRejectedValueOnce(new Error("offline"));
        await inPane("es-MX", <Probe userId="u2" />);
        await waitFor(() => expect(getUserProfile).toHaveBeenCalledTimes(2));
        expect(screen.getAllByRole("heading", { name: "Iniciar sesión" }).length).toBeGreaterThan(0);
    });

    it("is not read without a session", async () => {
        const initial = await loadLocale("es-MX");
        renderHook(() => useProfileLocale(null), {
            wrapper: ({ children }) => <LocaleProvider initial={initial}>{children}</LocaleProvider>,
        });
        await act(async () => {});
        expect(getUserProfile).not.toHaveBeenCalled();
    });
});
