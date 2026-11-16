import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RootPage, { generateMetadata } from "./page";

const jar: { names: string[] } = { names: [] };
vi.mock("next/headers", () => ({
    cookies: async () => ({ getAll: () => jar.names.map((name) => ({ name, value: "x" })) }),
}));
vi.mock("next-intl/server", () => ({
    getLocale: async () => "es-MX",
    getTranslations: async (namespace: string) => (key: string) => `${namespace}:${key}`,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/lib/localeActions", () => ({ setLocale: vi.fn() }));

beforeEach(() => {
    jar.names = [];
});

describe("/ is the public page, not a redirect", () => {
    it("shows «Sign in» to a visitor", async () => {
        render(await RootPage());
        expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
    });

    it.each(["mike-session", "__Host-mike-session", "__Host-mike-session.0"])(
        "shows «Open LiTT» when the %s cookie is there",
        async (name) => {
            jar.names = ["LITT_LOCALE", name];
            render(await RootPage());
            expect(screen.getAllByRole("link", { name: "Open LiTT" })[0]).toHaveAttribute("href", "/assistant");
            expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
        },
    );

    it("ignores other cookies", async () => {
        jar.names = ["LITT_LOCALE", "sb-other"];
        render(await RootPage());
        expect(screen.getAllByRole("link", { name: "Sign in" }).length).toBe(3);
    });
});

describe("metadata", () => {
    it("has its own title (not the template's), the description and the share image", async () => {
        const meta = await generateMetadata();
        expect(meta.title).toEqual({ absolute: "landing.meta:title" });
        expect(meta.description).toBe("landing.meta:description");
        expect(meta.openGraph).toMatchObject({
            locale: "es_MX",
            title: "landing.meta:title",
            images: [{ url: "/link-image.jpg" }],
        });
        expect(meta.twitter).toMatchObject({ images: ["/link-image.jpg"] });
        // Indexing stays the layout's decision (closed beta).
        expect(meta.robots).toBeUndefined();
    });
});
