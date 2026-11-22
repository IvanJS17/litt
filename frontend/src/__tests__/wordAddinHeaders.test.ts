// @vitest-environment node
// The Word add-in image ships only word-addin/server.mjs, so it keeps its own
// copy of the headers that never change. This pins that copy to the web app's:
// the two cannot drift apart.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { staticProtectionHeaders } from "@/app/lib/securityHeaders";

const SERVER = resolve(__dirname, "../../../word-addin/server.mjs");

describe("the Word add-in's protection headers", () => {
    it("equal the web app's, except framing (Office frames the pane)", async () => {
        const { protectionHeaders } = (await import(/* @vite-ignore */ pathToFileURL(SERVER).href)) as {
            protectionHeaders: (env: Record<string, string>, secure: boolean) => Record<string, string>;
        };
        const addin = protectionHeaders({}, true);
        const web = Object.fromEntries(
            staticProtectionHeaders()
                .filter(({ key }) => key !== "X-Frame-Options")
                .map(({ key, value }) => [key.toLowerCase(), value]),
        );
        const { "content-security-policy": policy, ...fixed } = addin;
        expect(fixed).toEqual(web);
        expect(policy).toContain("frame-ancestors 'self' https://");
        expect(Object.keys(addin)).not.toContain("x-frame-options");
    });
});
