"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RadarToday } from "@mike/contracts";
import { getRadarToday } from "@/app/lib/mikeApi";
import { radarHref } from "./radarOptions";
import { useRadarWords } from "./radarText";

/**
 * "Today" on the home of a firm's workspace: the open deadlines of the retainer
 * matters where the caller is a member, ordered by date (overdue, within 30
 * days, and the ones to review). The server limits it to the caller's own
 * matters. Plain text, no toasts: a failed load says so in place, with a retry.
 */
export function TodayRadar({ orgId }: { orgId: string }) {
  const t = useTranslations();
  const { day, distance } = useRadarWords();
  const [reload, setReload] = useState(0);
  // The answer is kept with the request it belongs to, so a new workspace or a
  // retry shows the loading state again without resetting state in an effect.
  const key = `${orgId}:${reload}`;
  const [loaded, setLoaded] = useState<{ key: string; data: RadarToday | null } | null>(null);
  const settled = loaded?.key === key ? loaded : null;
  const data = settled?.data ?? null;
  const failed = settled !== null && settled.data === null;

  useEffect(() => {
    let current = true;
    getRadarToday(orgId).then(
      (next) => {
        if (current) setLoaded({ key, data: next });
      },
      () => {
        if (current) setLoaded({ key, data: null });
      },
    );
    return () => {
      current = false;
    };
  }, [orgId, key]);

  return (
    <section aria-labelledby="radar-today-title" className="shrink-0 space-y-2 px-4 py-3 md:px-6">
      <h2 id="radar-today-title" className="font-serif text-lg text-gray-900">
        {t("radar.today.title")}
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-red-700">
          {t("radar.today.couldNotLoad")}{" "}
          <button
            type="button"
            className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            onClick={() => setReload((value) => value + 1)}
          >
            {t("radar.today.retry")}
          </button>
        </p>
      ) : !data ? (
        <div aria-busy="true" aria-label={t("radar.today.loading")} className="space-y-2">
          {[0, 1].map((row) => (
            <div key={row} aria-hidden="true" className="h-4 w-2/3 animate-pulse rounded bg-app-surface" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-gray-500">{t("radar.today.empty")}</p>
      ) : (
        <ul className="space-y-1.5">
          {data.items.map((item) => {
            const matter = item.matter_name ?? t("radar.today.unnamedMatter");
            const when = distance(item);
            return (
              <li key={`${item.matter_id}:${item.key}`} className="min-w-0 break-words text-sm">
                <Link
                  href={radarHref(item.project_id, item.matter_id)}
                  aria-label={t("radar.today.open", { matter })}
                  className="rounded text-gray-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <span className={item.bucket === "overdue" ? "font-medium text-red-700" : "font-medium"}>
                    {item.due_on ? day(item.due_on) : t("radar.group.review")}
                  </span>
                  {when ? <span className="text-gray-600"> · {when}</span> : null}
                  <span> · {t(`radar.type.${item.type}`)}: {item.label}</span>
                  <span className="text-gray-500"> · {matter}</span>
                  {item.state === "acknowledged" ? <span className="text-gray-500"> · {t("radar.state.acknowledged")}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {data?.truncated ? <p className="text-xs text-gray-500">{t("radar.today.truncated")}</p> : null}
    </section>
  );
}
