// @vitest-environment node
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ value: new Headers() }));

vi.mock("next/headers", () => ({ headers: async () => requestHeaders.value }));
vi.mock("next/script", () => ({ default: () => null }));
vi.mock("react-dom", () => ({ preload: () => undefined }));
vi.mock("next-intl/server", () => ({
    getLocale: async () => "es-MX",
    getMessages: async () => ({}),
    getTranslations: async () => (key: string) => key,
}));
vi.mock("./fonts/fonts.css", () => ({}));
vi.mock("./globals.css", () => ({}));
vi.mock("./fonts/inter-latin.woff2", () => ({ default: "/inter.woff2" }));
vi.mock("./fonts/newsreader-latin-opsz16-wght400-600.woff2", () => ({ default: "/newsreader.woff2" }));
vi.mock("@/app/components/providers", () => ({ Providers: () => null }));
vi.mock("@/i18n/IntlClientProvider", () => ({ IntlClientProvider: () => null }));

type Props = { nonce?: string; children?: ReactNode; dangerouslySetInnerHTML?: { __html: string } };

function findScript(node: ReactNode): ReactElement<Props> | null {
    if (!node || typeof node !== "object" || !("props" in node)) return null;
    const element = node as ReactElement<Props>;
    if (element.type === "script") return element;
    const children = element.props.children;
    for (const child of Array.isArray(children) ? children : [children]) {
        const found = findScript(child as ReactNode);
        if (found) return found;
    }
    return null;
}

// The page's boot script runs before first paint; with a nonce-based policy it
// runs only if it carries the nonce the proxy chose for this request.
describe("root layout boot script", () => {
    beforeEach(() => {
        requestHeaders.value = new Headers();
    });

    it("carries the request's nonce", async () => {
        requestHeaders.value = new Headers({ "x-nonce": "bm9uY2U=" });
        const { default: RootLayout } = await import("./layout");
        const script = findScript(await RootLayout({ children: null }));
        expect(script?.props.nonce).toBe("bm9uY2U=");
        expect(script?.props.dangerouslySetInnerHTML?.__html).toContain("localStorage");
    });

    it("renders without one when no policy was set (a plain `next start` behind no proxy)", async () => {
        const { default: RootLayout } = await import("./layout");
        const script = findScript(await RootLayout({ children: null }));
        expect(script).not.toBeNull();
        expect(script?.props.nonce).toBeUndefined();
    });
});
