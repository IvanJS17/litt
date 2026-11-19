"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Check, Clock, X, type LucideIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { getMcpGrantActivity, type McpGrantActivity, type McpGrantCall } from "@/app/lib/mikeApi";
import { reportFault, type UserFacingError } from "@/app/lib/userFacingError";

const OUTCOME_ICONS: Record<McpGrantCall["outcome"], LucideIcon> = {
  ok: Check,
  error: X,
  denied: Ban,
  rate_limited: Clock,
};

/**
 * What one connection did lately as a table (when, what, where, how it
 * ended: never content) and the conversations it started, which open in
 * LiTT's history. Loaded when the person asks for it.
 */
export function ConnectedAppActivity({
  grantId,
  client,
  workspaceName,
  onError,
}: {
  grantId: string;
  client: string;
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
  // A tool added to the server before it has a label shows its own name.
  const toolLabel = (tool: string) => {
    const key = `tool.${tool}` as never; // the catalog grows on the server, so the key is open
    return t.has(key) ? t(key) : tool;
  };
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-900">{t("activityHeading")}</h3>
        <p className="text-xs text-gray-500">{t("activityNote")}</p>
        {activity.calls.length === 0 ? (
          <p className="text-sm text-gray-600">{t("activityEmpty")}</p>
        ) : (
          <table className="w-full table-fixed text-left text-sm">
            <caption className="sr-only">{t("activityTable", { client })}</caption>
            <thead className="text-xs text-gray-500">
              <tr>
                <th scope="col" className="w-[28%] py-1 pr-2 font-medium">{t("colWhen")}</th>
                <th scope="col" className="py-1 pr-2 font-medium">{t("colWhat")}</th>
                <th scope="col" className="w-[32%] py-1 font-medium sm:w-[26%]">{t("colResult")}</th>
              </tr>
            </thead>
            <tbody className="align-top text-gray-700">
              {activity.calls.map((call, index) => {
                const Outcome = OUTCOME_ICONS[call.outcome];
                return (
                  <tr key={`${call.at}-${index}`} className="border-t border-gray-100">
                    <td className="py-2 pr-2 [overflow-wrap:anywhere]">{when(call.at)}</td>
                    <td className="py-2 pr-2 [overflow-wrap:anywhere]">
                      <span className="block text-gray-900">{toolLabel(call.tool)}</span>
                      <span className="block text-xs text-gray-500">
                        {call.workspace ? workspaceName(call.workspace) : t("noWorkspace")}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="inline-flex items-start gap-1.5">
                        <Outcome aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span>{t(`outcome.${call.outcome}`)}</span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-900">{t("conversationsHeading")}</h3>
        {activity.chats.length === 0 ? (
          <p className="text-sm text-gray-600">{t("conversationsEmpty")}</p>
        ) : (
          <ul className="space-y-2 text-sm text-gray-700">
            {activity.chats.map((chat) => (
              <li key={chat.id} className="[overflow-wrap:anywhere]">
                <Link
                  className="text-interactive underline"
                  href={
                    chat.project_id
                      ? `/projects/${chat.project_id}/assistant/chat/${chat.id}`
                      : `/assistant/chat/${chat.id}`
                  }
                >
                  {chat.title?.trim() || t("untitledChat")}
                </Link>
                <span className="block text-xs text-gray-500">
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
