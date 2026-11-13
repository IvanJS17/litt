import { describe, expect, it } from "vitest";
import esMX from "../../../../../packages/i18n/messages/es-MX.json";
import { MODEL_API_KEY_FIELDS, providerName } from "./modelProviders";

const t = (key: string) =>
    key === "settings.modelProviders.customEndpoint"
        ? esMX.settings.modelProviders.customEndpoint
        : key;

describe("providerName", () => {
    it("translates the custom endpoint and leaves brand names alone", () => {
        const custom = MODEL_API_KEY_FIELDS.find((f) => f.provider === "custom")!;
        const bedrock = MODEL_API_KEY_FIELDS.find((f) => f.provider === "bedrock")!;
        expect(providerName(t as never, custom)).toBe("Endpoint compatible con OpenAI");
        expect(providerName(t as never, bedrock)).toBe("Amazon Bedrock");
    });
});
