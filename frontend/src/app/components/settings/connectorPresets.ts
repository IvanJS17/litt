export type ConnectorPreset = { name: string; serverUrl: string };

/**
 * One-click MCP servers offered under Discover. The owner chose these two on
 * 2026-11-15; any other server is added through **+ Custom** by the person who
 * chose it. Each connection is still per person and per workspace, signed in
 * with that person's own account.
 */
export const CONNECTOR_PRESETS: ReadonlyArray<ConnectorPreset> = [
    { name: "Notion", serverUrl: "https://mcp.notion.com/mcp" },
    { name: "Airtable", serverUrl: "https://mcp.airtable.com/mcp" },
];

/**
 * Preset URLs and stored connector URLs differ in trailing slashes and
 * fragments, so every comparison between the two goes through this.
 */
export function normalizedServerUrl(serverUrl: string) {
    try {
        const url = new URL(serverUrl);
        url.hash = "";
        url.pathname = url.pathname.replace(/\/$/, "") || "/";
        return url.toString();
    } catch {
        return serverUrl.trim();
    }
}

/**
 * The preset a connector was installed from, or undefined when its URL matches
 * none of them — which is what makes a connector "custom".
 */
export function findConnectorPreset(serverUrl: string) {
    return CONNECTOR_PRESETS.find(
        (candidate) =>
            normalizedServerUrl(candidate.serverUrl) ===
            normalizedServerUrl(serverUrl),
    );
}
