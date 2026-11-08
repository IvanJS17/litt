import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach, vi } from "vitest";
import { SOURCE_LOCALE, SOURCE_MESSAGES } from "@litt/i18n";
import { configureClientLocale } from "../packages/client/src/locale";

// Vitest's jsdom environment always overrides `globalThis.Blob` with jsdom's
// own Blob implementation, which never implemented `.text()`/`.arrayBuffer()`/
// `.stream()` (it only has `slice`, `size`, `type`). On Node 24 (unlike
// Node 22), the built-in `Response.prototype.blob()` resolves its `Blob`
// constructor dynamically from `globalThis` at call time, so blobs returned
// from a real `Response` end up jsdom-shaped and missing those methods.
// Restoring the real Node `Blob` here (independent of the global, via
// `node:buffer`) keeps `response.blob()` usable the same way on every
// supported Node version. See #361.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

// Testing Library renders under the en-US intl provider by default (plan
// i18n R2); see src/__tests__/support/intlRender.tsx.
vi.mock("@testing-library/react", async (importOriginal) => {
    const rtl = await importOriginal<typeof import("@testing-library/react")>();
    const { intlRenderers } = await import("./src/__tests__/support/intlRender");
    return { ...rtl, ...intlRenderers(rtl) };
});

// A test that renders in es-MX also points @mike/client's failure messages
// there (IntlClientProvider); put them back so the next test starts in en-US.
afterEach(() => configureClientLocale(SOURCE_LOCALE, SOURCE_MESSAGES));
