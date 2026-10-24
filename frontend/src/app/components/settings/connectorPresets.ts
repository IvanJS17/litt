export type ConnectorPreset = { name: string; serverUrl: string };

/**
 * One-click MCP servers offered under Discover. LiTT suggests no third-party
 * service by default, so the list ships empty; a server is added through
 * **+ Custom** by the person who chose it.
 */
export const CONNECTOR_PRESETS: ReadonlyArray<ConnectorPreset> = [];

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
