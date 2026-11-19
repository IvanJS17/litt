"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { GlassCardUI } from "@mike/ui";
import { Unplug } from "lucide-react";
import { ConnectGuide } from "@/app/components/settings/ConnectGuide";
import { ConnectedAppCard } from "@/app/components/settings/ConnectedAppCard";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { useAuth } from "@/app/contexts/AuthContext";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  MikeApiError,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
} from "@/app/lib/mikeApi";
import { notifySuccess, reportFault, type UserFacingError } from "@/app/lib/userFacingError";

const HEADING_ID = "connected-apps-title";

/**
 * The apps (Claude, ChatGPT, Hermes…) the person let into their account:
 * what each may do, where it may work and when it last did. With none, the
 * guide to connect one comes first; with some, they come first and the guide
 * folds below. Quitting access revokes the connection on the server; the
 * app's next call is refused. Where the server does not offer MCP
 * connections the list says so and the guide is hidden.
 */
export function ConnectedAppsSection() {
  const t = useTranslations("settings.connectedApps");
  const { user } = useAuth();
  const { organizations } = useWorkspace();
  const [grants, setGrants] = useState<McpGrant[] | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [notEnabled, setNotEnabled] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<UserFacingError | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await listMcpGrants();
      setServerUrl(loaded.server_url);
      setGrants(loaded.grants);
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

  // After removing a connection the card is gone: focus the list's heading.
  function focusHeading() {
    const heading = document.getElementById(HEADING_ID);
    heading?.setAttribute("tabindex", "-1");
    heading?.focus();
  }

  async function revoke(grant: McpGrant) {
    setBusy(grant.id);
    try {
      await revokeMcpGrant(grant.id);
      setGrants((current) => (current ?? []).filter((g) => g.id !== grant.id));
      setConfirming(null);
      setShowing(null);
      notifySuccess(t("removed", { client: grant.client_name }));
      focusHeading();
    } catch (caught) {
      if (caught instanceof MikeApiError && caught.status === 404) {
        // Already gone (revoked elsewhere): the list was stale.
        setGrants((current) => (current ?? []).filter((g) => g.id !== grant.id));
        setConfirming(null);
        focusHeading();
      } else {
        setError(reportFault(caught, { action: t("revokeAction"), operation: "mcp.grants" }));
      }
    } finally {
      setBusy(null);
    }
  }

  const reportActivityError = useCallback((failure: UserFacingError) => setError(failure), []);
  const workspaceName = (id: string) =>
    id === "personal"
      ? t("personal")
      : (organizations?.find((org) => org.id === id)?.name ?? t("unknownFirm"));

  const count = grants?.length ?? 0;
  const guide =
    serverUrl && !notEnabled && grants ? <ConnectGuide key="guide" serverUrl={serverUrl} connections={count} /> : null;

  const list = (
    <section key="list" className="space-y-3" aria-labelledby={HEADING_ID}>
      <div className="flex items-baseline gap-2">
        <SettingsHeading id={HEADING_ID}>{t("heading")}</SettingsHeading>
        {count > 0 && <span className="text-sm text-gray-600">{t("appsCount", { count })}</span>}
      </div>
      <p className="text-sm text-gray-600">{t("intro")}</p>
      {user?.email && (
        <p className="text-sm text-gray-600">
          {t("acting")} <span className="font-medium text-gray-900 [overflow-wrap:anywhere]">{user.email}</span>
        </p>
      )}
      {grants === null ? (
        <p className="text-sm text-gray-500">{t("loading")}</p>
      ) : notEnabled ? (
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <p className="text-sm text-gray-600">{t("notEnabled")}</p>
          </SettingsRow>
        </GlassCardUI>
      ) : grants.length === 0 ? (
        <GlassCardUI>
          <SettingsRow layout="stacked">
            <div className="flex gap-3">
              <Unplug aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-gray-500" />
              <p className="text-sm text-gray-600">{t("empty")}</p>
            </div>
          </SettingsRow>
        </GlassCardUI>
      ) : (
        <ul className="space-y-3">
          {grants.map((grant) => (
            <li key={grant.id}>
              <ConnectedAppCard
                grant={grant}
                workspaceName={workspaceName}
                confirming={confirming === grant.id}
                showing={showing === grant.id}
                busy={busy === grant.id}
                onAskRevoke={() => setConfirming(grant.id)}
                onCancelRevoke={() => setConfirming(null)}
                onRevoke={() => void revoke(grant)}
                onToggleActivity={() => setShowing(showing === grant.id ? null : grant.id)}
                onActivityError={reportActivityError}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-8">
      {count === 0 ? [guide, list] : [list, guide]}
      <WarningPopup
        open={!!error}
        title={error?.title ?? ""}
        message={error?.message ?? ""}
        onClose={() => setError(null)}
      />
    </div>
  );
}
