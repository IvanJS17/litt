import { z } from "zod";

// Accept DNS domains only, never email addresses, URLs, wildcards or ports.
export const ssoDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );

/**
 * Whether SSO sign-in is switched on. This is the only SSO fact the public
 * `GET /api/auth/providers` read reveals; the allowed domains stay private.
 */
export function ssoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SSO_ENABLED?.trim().toLowerCase() === "true";
}

export function ssoConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const enabled = ssoEnabled(env);
  if (!enabled) {
    return {
      enabled: false,
      allowedDomains: null,
    };
  }
  const allowedDomains = env.SSO_ALLOWED_DOMAINS?.trim()
    ? env.SSO_ALLOWED_DOMAINS.split(",").map((domain) =>
        ssoDomainSchema.parse(domain),
      )
    : null;
  return {
    enabled,
    allowedDomains,
  };
}
