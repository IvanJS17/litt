"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI } from "@mike/ui";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";
import {
  MikeApiError,
  getMcpGrantActivity,
  listMcpGrants,
  revokeMcpGrant,
  type McpGrant,
  type McpGrantActivity,
} from "@/app/lib/mikeApi";
import { reportFault, type UserFacingError } from "@/app/lib/userFacingError";

const KNOWN_SCOPES = ["read", "run", "write", "chat"] as const;
type KnownScope = (typeof KNOWN_SCOPES)[number];
const knownScope = (scope: string): KnownScope | null => {
  const name = scope.startsWith("litt.") ? scope.slice("litt.".length) : scope;
  return (KNOWN_SCOPES as readonly string[]).includes(name) ? (name as KnownScope) : null;
};

/**
 * What one connection did lately (tool, time, workspace, outcome: never
 * content) and the conversations it started, which open in LiTT's history.
 * Loaded when the person asks for it.
 */
function GrantActivity({
  grantId,
  workspaceName,
  onError,
}: {
  grantId: string;
  workspaceName: (id: string) => string;
  onError: (error: UserFacingError) => void;
}) {
  const t = useTranslations("settings.connectedApps");
  const format = useFormatter();
  const [activity, setActivity] = useState<McpGrantActivity | null>(null);

  useEffect(() => {
    let live = true;
    getMcpGrantActivity(grantId).then(
      (loaded) => live && setActivity(loaded),
      (caught) => {
        if (!live) return;
        setActivity({ calls: [], chats: [] });
        onError(reportFault(caught, { action: t("activityLoadAction"), operation: "mcp.grants" }));
      },
    );
    return () => {
      live = false;
    };
  }, [grantId, onError, t]);

  if (!activity) return <p className="text-sm text-gray-500">{t("activityLoading")}</p>;
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="space-y-3 border-t border-gray-200 pt-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-gray-900">{t("activityHeading")}</h3>
        <p className="text-xs text-gray-500">{t("activityNote")}</p>
        {activity.calls.length === 0 ? (
          <p className="text-sm text-gray-600">{t("activityEmpty")}</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-gray-700">
            {activity.calls.map((call, index) => (
              <li key={`${call.at}-${index}`} className="break-words">
                {t("activityLine", {
                  tool: call.tool,
                  date: when(call.at),
                  workspace: call.workspace ? workspaceName(call.workspace) : t("noWorkspace"),
                  outcome: t(`outcome.${call.outcome}`),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-gray-900">{t("conversationsHeading")}</h3>
        {activity.chats.length === 0 ? (
          <p className="text-sm text-gray-600">{t("conversationsEmpty")}</p>
        ) : (
          <ul className="space-y-0.5 text-sm text-gray-700">
            {activity.chats.map((chat) => (
              <li key={chat.id} className="break-words">
                <Link
                  className="text-interactive underline"
                  href={
                    chat.project_id
                      ? `/projects/${chat.project_id}/assistant/chat/${chat.id}`
                      : `/assistant/chat/${chat.id}`
                  }
                >
                  {chat.title?.trim() || t("untitledChat")}
                </Link>{" "}
                <span className="text-xs text-gray-500">
                  {workspaceName(chat.workspace)} · {when(chat.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const CLAUDE_GUIDE_URL = "https://support.claude.com/en/articles/11175166";
const CHATGPT_GUIDE_URL = "https://help.openai.com/en/articles/12584461";

/**
 * How to connect LiTT from an AI app: the connection starts there, so this
 * gives the address to paste (from the server) and the vendors' own steps.
 */
function ConnectGuide({ serverUrl }: { serverUrl: string }) {
  const t = useTranslations("settings.connectedApps.guide");
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The address stays visible and selectable.
    }
  }

  const steps = (prefix: "claudeStep" | "chatgptStep") =>
    ([1, 2, 3, 4] as const).map((n) => <li key={n}>{t(`${prefix}${n}`)}</li>);

  return (
    <GlassCardUI>
      <div className="space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-medium text-gray-900">{t("title")}</h3>
          <p className="text-sm text-gray-600">{t("intro")}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-gray-500">{t("urlLabel")}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 break-all rounded-md bg-gray-100 px-2 py-1 text-sm text-gray-900">
              {serverUrl}
            </code>
            <PillButtonUI tone="white" type="button" onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
              <span role="status">{copied ? t("copied") : t("copy")}</span>
            </PillButtonUI>
          </div>
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-900">{t("claudeHeading")}</h4>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-gray-700">{steps("claudeStep")}</ol>
          <p className="text-sm text-gray-600">{t("claudeTeam")}</p>
          <a className="text-sm text-interactive underline" href={CLAUDE_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            {t("claudeLink")}
          </a>
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-medium text-gray-900">{t("chatgptHeading")}</h4>
          <p className="text-sm text-gray-600">{t("chatgptNote")}</p>
          <ol className="list-decimal space-y-0.5 pl-5 text-sm text-gray-700">{steps("chatgptStep")}</ol>
          <a className="text-sm text-interactive underline" href={CHATGPT_GUIDE_URL} target="_blank" rel="noopener noreferrer">
            {t("chatgptLink")}
          </a>
        </div>
        <p className="text-sm text-gray-600">{t("after")}</p>
      </div>
    </GlassCardUI>
  );
}

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

  async function revoke(grant: McpGrant) {
    setBusy(grant.id);
    try {
      await revokeMcpGrant(grant.id);
      setGrants((current) => (current ?? []).filter((g) => g.id !== grant.id));
      setConfirming(null);
      setShowing(null);
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

  const reportActivityError = useCallback((failure: UserFacingError) => setError(failure), []);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const workspaceName = (id: string) =>
    id === "personal"
      ? t("personal")
      : (organizations?.find((org) => org.id === id)?.name ?? t("unknownFirm"));

  return (
    <div className="space-y-4">
      <SettingsHeading>{t("heading")}</SettingsHeading>
      <p className="text-sm text-gray-600">{t("intro")}</p>
      {serverUrl && !notEnabled && <ConnectGuide serverUrl={serverUrl} />}
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
                    <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                      <PillButtonUI
                        tone="white"
                        type="button"
                        aria-expanded={showing === grant.id}
                        onClick={() => setShowing(showing === grant.id ? null : grant.id)}
                      >
                        {showing === grant.id ? t("activityHide") : t("activityShow")}
                      </PillButtonUI>
                      <PillButtonUI
                        tone="whiteDanger"
                        type="button"
                        onClick={() => setConfirming(grant.id)}
                      >
                        {t("revoke")}
                      </PillButtonUI>
                    </div>
                  )}
                </div>
                {showing === grant.id && (
                  <div className="mt-3">
                    <GrantActivity
                      grantId={grant.id}
                      workspaceName={workspaceName}
                      onError={reportActivityError}
                    />
                  </div>
                )}
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
