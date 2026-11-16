import { describe, expect, it } from "vitest";
import { CONNECTOR_PRESETS, findConnectorPreset } from "./connectorPresets";

describe("suggested MCP connectors", () => {
    it("suggests only the services the owner chose: Notion and Airtable", () => {
        expect(CONNECTOR_PRESETS.map((preset) => preset.name)).toEqual([
            "Notion",
            "Airtable",
        ]);
        expect(findConnectorPreset("https://mcp.notion.com/mcp/")?.name).toBe(
            "Notion",
        );
    });

    it("does not suggest third-party services that were turned down", () => {
        for (const url of [
            "https://mcp.lawve.ai",
            "https://mcp.slack.com/mcp",
            "https://mcp.linear.app/mcp",
        ]) {
            expect(findConnectorPreset(url)).toBeUndefined();
        }
    });
});
