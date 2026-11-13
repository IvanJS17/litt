import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("web app manifest", () => {
    const m = manifest();

    it("opens LiTT as a full-screen app on the assistant", () => {
        expect(m).toMatchObject({
            name: "LiTT",
            short_name: "LiTT",
            start_url: "/assistant",
            display: "standalone",
            background_color: "#ECECE6",
        });
    });

    it("points only at icons that exist", () => {
        expect(m.icons?.length).toBeGreaterThan(0);
        for (const icon of m.icons ?? []) {
            const file = icon.src === "/icon.svg"
                ? resolve(__dirname, "icon.svg")
                : resolve(__dirname, "../../public", icon.src.slice(1));
            expect(existsSync(file), icon.src).toBe(true);
        }
    });

    it("needs no service worker: there is no offline mode", () => {
        expect(existsSync(resolve(__dirname, "../../public/sw.js"))).toBe(false);
        expect(JSON.stringify(m)).not.toContain("serviceworker");
    });
});
