import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateUserProfile } = vi.hoisted(() => ({ updateUserProfile: vi.fn() }));
vi.mock("@/app/lib/mikeApi", () => ({ updateUserProfile }));

import { syncUiLocale } from "./uiLocaleSync";

describe("syncUiLocale", () => {
    beforeEach(() => {
        updateUserProfile.mockReset().mockResolvedValue({});
    });

    it("saves the language chosen on the web when the profile has another", async () => {
        await syncUiLocale("es-MX", "a=1; LITT_LOCALE=en-US");
        expect(updateUserProfile).toHaveBeenCalledExactlyOnceWith({ uiLocale: "en-US" });
        updateUserProfile.mockClear();
        await syncUiLocale(null, "LITT_LOCALE=es-MX");
        expect(updateUserProfile).toHaveBeenCalledExactlyOnceWith({ uiLocale: "es-MX" });
    });

    it("does nothing when the profile already has it, there is no cookie, or it is unsupported", async () => {
        await syncUiLocale("en-US", "LITT_LOCALE=en-US");
        await syncUiLocale("en-US", "other=1");
        await syncUiLocale("en-US", "LITT_LOCALE=fr-FR");
        expect(updateUserProfile).not.toHaveBeenCalled();
    });

    it("ignores a failed save", async () => {
        updateUserProfile.mockRejectedValue(new Error("offline"));
        await expect(syncUiLocale(null, "LITT_LOCALE=en-US")).resolves.toBeUndefined();
    });
});
