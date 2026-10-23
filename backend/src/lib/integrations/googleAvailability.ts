/**
 * Google services the operator has switched off with
 * GOOGLE_WORKSPACE_DISABLED_PROVIDERS, a comma-separated list of provider
 * ids ("google-drive", "gmail", "google-calendar"). A hosted deployment uses
 * it to offer only the services whose Google scopes its Cloud project has
 * verified, so the consent screen, the Console and the running code keep
 * requesting the same scopes. Unknown ids are reported and ignored rather
 * than disabling nothing silently or taking every service down.
 *
 * Shared by the Drive and Gmail/Calendar integrations, which otherwise keep
 * separate OAuth clients, grants and tools.
 *
 * LiTT policy: Google Drive is not offered by default. Approved artifacts are
 * published to Drive by the matter-bound publication service (which needs no
 * OAuth client and no connector), so the connector's Drive surface stays closed
 * until an operator opts in by defining the variable — an explicit list,
 * including an empty one, replaces this default.
 */
export const GOOGLE_SERVICES = {
  "google-drive": "Google Drive",
  gmail: "Gmail",
  "google-calendar": "Google Calendar",
} as const;
export type GoogleService = keyof typeof GOOGLE_SERVICES;

/** Services that stay off when the operator defines no list. */
const DEFAULT_DISABLED_SERVICES: readonly GoogleService[] = ["google-drive"];

export function disabledGoogleServices(): GoogleService[] {
  const configured = process.env.GOOGLE_WORKSPACE_DISABLED_PROVIDERS;
  if (configured === undefined) return [...DEFAULT_DISABLED_SERVICES];
  const ids = configured
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const unknown = ids.filter((id) => !(id in GOOGLE_SERVICES));
  if (unknown.length)
    console.error("[google-workspace] unknown provider ids in GOOGLE_WORKSPACE_DISABLED_PROVIDERS", {
      unknown,
      known: Object.keys(GOOGLE_SERVICES),
    });
  return ids.filter((id): id is GoogleService => id in GOOGLE_SERVICES);
}

export function isGoogleServiceAvailable(service: GoogleService): boolean {
  return !disabledGoogleServices().includes(service);
}

/** Repo-authored, safe to show the user as written. */
export function googleServiceUnavailableMessage(service: GoogleService): string {
  return `${GOOGLE_SERVICES[service]} is not offered on this LiTT server.`;
}
