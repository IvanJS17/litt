import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => jar }));

import { setLocale } from "./localeActions";

describe("setLocale", () => {
    beforeEach(() => jar.set.mockReset());

    it.each(["es-MX", "en-US"])("sets the LITT_LOCALE cookie for %s", async (locale) => {
        await expect(setLocale(locale)).resolves.toBe(true);
        expect(jar.set).toHaveBeenCalledExactlyOnceWith("LITT_LOCALE", locale, {
            path: "/",
            sameSite: "lax",
            maxAge: 31_536_000,
            httpOnly: false,
            secure: false,
        });
    });

    it("marks the cookie Secure in production", async () => {
        vi.stubEnv("NODE_ENV", "production");
        try {
            await setLocale("es-MX");
            expect(jar.set.mock.calls[0][2]).toMatchObject({ secure: true });
        } finally {
            vi.unstubAllEnvs();
        }
    });

    it.each(["fr-FR", "es", "en-us", "", " es-MX", "es-MX; Path=/x", "__proto__", "<script>"])(
        "refuses %j and leaves the cookie alone",
        async (value) => {
            await expect(setLocale(value)).resolves.toBe(false);
            expect(jar.set).not.toHaveBeenCalled();
        },
    );

    it("refuses what is not a string, since the argument arrives from the browser", async () => {
        for (const value of [undefined, null, 5, {}, ["es-MX"]]) {
            await expect(setLocale(value as unknown as string)).resolves.toBe(false);
        }
        expect(jar.set).not.toHaveBeenCalled();
    });
});
