import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TERMS_GATE_ALLOW_LIST, isTermsGateExempt } from "../lib/termsGate";

const SRC = resolve(__dirname, "..");

describe("the Terms gate allow-list", () => {
    it("has exactly these entries (adding one changes this test)", () => {
        expect(TERMS_GATE_ALLOW_LIST.map((e) => `${e.method} ${e.path}`)).toEqual([
            "GET /auth/session",
            "GET /auth/mfa/factors",
            "GET /auth/mfa/assurance",
            "POST /auth/mfa/challenge",
            "POST /auth/mfa/verify",
            "POST /auth/mfa/challenge-and-verify",
            "PATCH /auth/password",
            "GET /user/profile",
            "POST /user/terms-acceptance",
            "DELETE /user/account",
            "POST /user/exports",
            "GET /user/exports/:id",
            "GET /user/exports/:id/download",
        ]);
        for (const entry of TERMS_GATE_ALLOW_LIST) expect(entry.reason.length).toBeGreaterThan(10);
    });

    it("matches the method and the whole path only", () => {
        expect(isTermsGateExempt("GET", "/user/profile?x=1")).toBe(true);
        expect(isTermsGateExempt("GET", "/user/profile/")).toBe(true);
        expect(isTermsGateExempt("PATCH", "/user/profile")).toBe(false);
        expect(isTermsGateExempt("GET", "/user/profile/extra")).toBe(false);
        expect(isTermsGateExempt("GET", "/user/exports/abc/download")).toBe(true);
        expect(isTermsGateExempt("GET", "/user/exports/a/b/download")).toBe(false);
    });
});

// Every router mounted in app.ts authenticates through requireAuth (so the one
// gate covers it), or is named here with the reason it does not.
const OTHER_AUTH: Record<string, string> = {
    mcpPublicRouter: "discovery and token endpoints; connected applications use their own bearer token, judged in mcp.endpoint.ts",
    authRouter: "sign-in, sign-up and recovery are public; its signed-in routes use requireAuth (and are allow-listed where needed)",
};

describe("routers mounted in app.ts", () => {
    const app = readFileSync(join(SRC, "app.ts"), "utf8");
    const mounts = [...app.matchAll(/^app\.use\((?:"[^"]*",\s*)?(\w+Router)\)/gm)].map((m) => m[1]);
    const imports = new Map<string, string>();
    for (const m of app.matchAll(/import \{([^}]+)\} from "\.\/modules\/([^"]+)"/g))
        for (const name of m[1].split(",").map((s) => s.trim()))
            imports.set(name, `${m[2]}.ts`);

    it("finds the mounts", () => {
        expect(mounts.length).toBeGreaterThan(40);
    });

    it.each([...new Set(mounts)])("%s uses requireAuth or is named as authenticating another way", (name) => {
        if (name in OTHER_AUTH) return;
        const file = imports.get(name);
        expect(file, name).toBeDefined();
        const dir = file!.split("/")[0];
        const source = readdirSync(join(SRC, "modules", dir))
            .filter((f) => f.endsWith(".routes.ts"))
            .map((f) => readFileSync(join(SRC, "modules", dir, f), "utf8"))
            .join("\n");
        expect(source).toMatch(/requireAuth/);
    });
});
