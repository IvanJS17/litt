import { describe, expect, it } from "vitest";
import { mcpOAuthProviderFor, operatorClientMayReach } from "./providers";

const google = mcpOAuthProviderFor("https://drivemcp.googleapis.com/mcp/v1")!;
const slack = mcpOAuthProviderFor("https://mcp.slack.com/mcp")!;

describe("operatorClientMayReach", () => {
    it.each([
        [google, "https://accounts.google.com", "https://oauth2.googleapis.com/token", true],
        [google, "https://accounts.google.com/", "https://OAUTH2.googleapis.com:443/token", true],
        [slack, "https://mcp.slack.com", "https://slack.com/api/oauth.v2.user.access", true],
        // token endpoint host: exact, not a suffix
        [slack, "https://mcp.slack.com", "https://api.slack.com/api/oauth.v2.user.access", false],
        [slack, "https://mcp.slack.com", "https://evilslack.com/token", false],
        [google, "https://accounts.google.com", "https://oauth2.googleapis.com.example/token", false],
        // token endpoint shape
        [google, "https://accounts.google.com", "http://oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com", "https://oauth2.googleapis.com:8443/token", false],
        [google, "https://accounts.google.com", "https://user@oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com", undefined, false],
        // authorization server: exact host, origin only
        [google, "https://evil.accounts.google.com", "https://oauth2.googleapis.com/token", false],
        [google, "https://xaccounts.google.com", "https://oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com.example", "https://oauth2.googleapis.com/token", false],
        [google, "https://user@accounts.google.com", "https://oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com?x=1", "https://oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com#f", "https://oauth2.googleapis.com/token", false],
        [google, "https://accounts.google.com/path", "https://oauth2.googleapis.com/token", false],
    ])("%#: %s server %s token endpoint %s -> %s", (provider, server, token, expected) => {
        expect(operatorClientMayReach(provider, server, token)).toBe(expected);
    });
});
