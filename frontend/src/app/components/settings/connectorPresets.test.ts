import { describe, expect, it } from "vitest";
import { CONNECTOR_PRESETS, findConnectorPreset } from "./connectorPresets";

describe("suggested MCP connectors", () => {
    it("ships empty: no third-party service is suggested by default", () => {
        expect(CONNECTOR_PRESETS).toEqual([]);
        expect(findConnectorPreset("https://mcp.lawve.ai")).toBeUndefined();
    });
});
