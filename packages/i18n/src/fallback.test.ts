import { describe, expect, it, vi } from "vitest";

// A translation that lacks a key (and one whole namespace) the source has.
vi.mock("../messages/es-MX.json", () => ({
    default: { common: { save: "Guardar" } },
}));
vi.mock("../messages/en-US.json", () => ({
    default: { common: { save: "Save", cancel: "Cancel" }, auth: { signIn: "Sign in" } },
}));

describe("loadMessages fallback", () => {
    it("fills a missing translation from en-US, key by key", async () => {
        const { loadMessages } = await import("./index");
        expect(await loadMessages("es-MX")).toEqual({
            common: { save: "Guardar", cancel: "Cancel" },
            auth: { signIn: "Sign in" },
        });
    });
});
