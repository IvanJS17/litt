"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  MikeApiError,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
} from "@/app/lib/mikeApi";
import { reportFault, type UserFacingError } from "@/app/lib/userFacingError";

const KNOWN_SCOPES = ["read", "run", "write", "chat"] as const;
type KnownScope = (typeof KNOWN_SCOPES)[number];
const knownScope = (scope: string): KnownScope | null => {
  const name = scope.startsWith("litt.") ? scope.slice("litt.".length) : scope;
  return (KNOWN_SCOPES as readonly string[]).includes(name) ? (name as KnownScope) : null;
};

/**
 * The apps (Claude, ChatGPT, Hermes…) the person let into their account:
 * who, where they may work, what they may do, when they last did. Quitting
 * access revokes the connection on the server; the app's next call is refused.
 * Where the server does not offer MCP connections the list says so.
 */
export function ConnectedAppsSection() {
  const t = useTranslations("settings.connectedApps");
  const format = useFormatter();
  const { organizations } = useWorkspace();
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  const load = useCallback(async () => {
    try {
      setGrants(await listMcpGrants());
    } catch (caught) {
      // The server answers 404 to every MCP route while the feature is off.
      if (caught instanceof MikeApiError && caught.status === 404) {
        setNotEnabled(true);
        setGrants([]);
        return;
      }
      setGrants([]);
      setError(reportFault(caught, { action: t("loadAction"), operation: "mcp.grants" }));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(grant: McpGrant) {
    setBusy(grant.id);
    try {
      await revokeMcpGrant(grant.id);
      setGrants((current) => (current ?? []).filter((g) => g.id !== grant.id));
      setConfirming(null);
    } catch (caught) {
      if (caught instanceof MikeApiError && caught.status === 404) {
        // Already gone (revoked elsewhere): the list was stale.
        setGrants((current) => (current ?? []).filter((g) => g.id !== grant.id));
        setConfirming(null);
      } else {
        setError(reportFault(caught, { action: t("revokeAction"), operation: "mcp.grants" }));
      }
    } finally {
      setBusy(null);
    }
  }

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const workspaceName = (id: string) =>
    id === "personal"
      ? t("personal")
      : (organizations?.find((org) => org.id === id)?.name ?? t("unknownFirm"));

  return (
    <div className="space-y-4">
      <SettingsHeading>{t("heading")}</SettingsHeading>
      <p className="text-sm text-gray-600">{t("intro")}</p>
      {grants === null ? (
        <p className="text-sm text-gray-500">{t("loading")}</p>
      ) : notEnabled ? (
        <GlassCardUI>
          <p className="text-sm text-gray-600">{t("notEnabled")}</p>
        </GlassCardUI>
      ) : grants.length === 0 ? (
        <GlassCardUI>
          <p className="text-sm text-gray-600">{t("empty")}</p>
        </GlassCardUI>
      ) : (
        <ul className="space-y-3">
          {grants.map((grant) => (
            <li key={grant.id}>
              <GlassCardUI>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="break-words text-base font-medium text-gray-900">
                      {grant.client_name}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t("workspaces")}: {grant.workspaces.map(workspaceName).join(", ")}
                    </p>
                    <p className="text-sm text-gray-600">
                      {t("permissions")}:{" "}
                      {grant.scopes
                        .map((scope) => {
                          const known = knownScope(scope);
                          return known ? t(`scope.${known}`) : scope;
                        })
                        .join(", ")}
                    </p>
                    <p className="text-xs text-gray-500">
                      {t("connected", { date: date(grant.created_at) })} ·{" "}
                      {grant.last_used_at
                        ? t("lastUsed", { date: date(grant.last_used_at) })
                        : t("neverUsed")}{" "}
                      · {t("expires", { date: date(grant.expires_at) })}
                    </p>
                  </div>
                  {confirming === grant.id ? (
                    <div className="flex shrink-0 flex-col gap-2">
                      <p className="text-sm text-gray-700">
                        {t("confirmRevoke", { client: grant.client_name })}
                      </p>
                      <div className="flex gap-2">
                        <PillButtonUI
                          tone="danger"
                          type="button"
                          disabled={busy === grant.id}
                          onClick={() => void revoke(grant)}
                        >
                          {t("confirmYes")}
                        </PillButtonUI>
                        <PillButtonUI
                          tone="white"
                          type="button"
                          disabled={busy === grant.id}
                          onClick={() => setConfirming(null)}
                        >
                          {t("cancel")}
                        </PillButtonUI>
                      </div>
                    </div>
                  ) : (
                    <PillButtonUI
                      tone="whiteDanger"
                      type="button"
                      onClick={() => setConfirming(grant.id)}
                    >
                      {t("revoke")}
                    </PillButtonUI>
                  )}
                </div>
              </GlassCardUI>
            </li>
          ))}
        </ul>
      )}
      <WarningPopup
        open={!!error}
        title={error?.title ?? ""}
        message={error?.message ?? ""}
        onClose={() => setError(null)}
      />
    </div>
  );
}
