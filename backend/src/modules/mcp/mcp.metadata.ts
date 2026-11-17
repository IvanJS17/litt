// Discovery documents: protected resource metadata (RFC 9728) and
// authorization server metadata (RFC 8414).

import { MCP_SCOPES, mcpConfig } from "./mcp.config";

export function protectedResourceMetadata() {
    const config = mcpConfig();
    return {
        resource: config.resource,
        authorization_servers: [config.issuer],
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "LiTT",
    };
}

export function authorizationServerMetadata() {
    const config = mcpConfig();
    return {
        issuer: config.issuer,
        authorization_endpoint: config.authorizationEndpoint,
        token_endpoint: config.tokenEndpoint,
        registration_endpoint: config.registrationEndpoint,
        revocation_endpoint: config.revocationEndpoint,
        scopes_supported: [...MCP_SCOPES],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        revocation_endpoint_auth_methods_supported: ["none"],
        client_id_metadata_document_supported: config.cimdEnabled,
        authorization_response_iss_parameter_supported: true,
    };
}
