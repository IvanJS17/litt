import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastViewportUI, clearToasts } from "@mike/ui";
import { PersonalWorkspaceNotice } from "./PersonalWorkspaceNotice";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { IntlClientProvider } from "@/i18n/IntlClientProvider";

const profile = vi.hoisted(() => ({
    value: { personalWorkspaceDisabled: true, managedByFirmName: "Despacho Demo" } as {
        personalWorkspaceDisabled: boolean;
        managedByFirmName: string | null;
    },
}));
vi.mock("@/app/contexts/UserProfileContext", () => ({
    useOptionalUserProfile: () => ({ profile: profile.value }),
}));

function open(search: string) {
    window.history.replaceState(null, "", `/assistant${search}`);
    return render(
        <IntlClientProvider locale="es-MX" messages={esMX}>
            <PersonalWorkspaceNotice />
            <ToastViewportUI />
        </IntlClientProvider>,
    );
}

describe("PersonalWorkspaceNotice", () => {
    beforeEach(() => {
        clearToasts();
        profile.value = { personalWorkspaceDisabled: true, managedByFirmName: "Despacho Demo" };
    });
    afterEach(() => {
        clearToasts();
        window.history.replaceState(null, "", "/");
    });

    it("tells a managed account that asked for the personal workspace why it did not get it", () => {
        open("?workspace=personal");
        expect(
            screen.getByText("Tu cuenta la administra Despacho Demo; no tienes espacio personal."),
        ).toBeInTheDocument();
    });

    it("says nothing when no personal workspace was asked for", () => {
        open("");
        expect(screen.queryByText(/no tienes espacio personal/)).not.toBeInTheDocument();
    });

    it("says nothing to an account that has a personal workspace", () => {
        profile.value = { personalWorkspaceDisabled: false, managedByFirmName: null };
        open("?workspace=personal");
        expect(screen.queryByText(/no tienes espacio personal/)).not.toBeInTheDocument();
    });
});
