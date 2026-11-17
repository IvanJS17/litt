"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { useTranslations } from "next-intl";
import { PillButtonUI } from "@mike/ui";
import type { MatterRadar as MatterRadarData, RadarAction } from "@mike/contracts";
import { EmptyState } from "@/app/components/ui/empty-state";
import { LIQUID_SUBTLE_PANEL_SURFACE_CLASS } from "@/app/components/ui/liquid-surface";
import { actOnRadarItem, getMatterRadar } from "@/app/lib/mikeApi";
import { errorCode, notifyError } from "@/app/lib/userFacingError";
import { MatterSectionNav } from "@/app/components/profile/MatterSectionNav";
import { ObligationRules } from "./ObligationRules";
import { RadarItemCard } from "./RadarItemCard";
import { groupItems, profileHref } from "./radarOptions";
import { useRadarWords } from "./radarText";

/**
 * The deadline radar of a retainer matter (docs/deadline-radar.md): the dates
 * LiTT computed, in calendar days, from the confirmed facts of the client
 * profile, grouped as overdue, next 30 days, later and to review. Reading is
 * for the whole team; acknowledging, dismissing (with a reason) and completing
 * are for owners and editors.
 */
export function MatterRadar({ projectId, matterId }: { projectId: string; matterId: string }) {
  const t = useTranslations();
  const { day } = useRadarWords();
  const [data, setData] = useState<MatterRadarData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  useEffect(() => {
    let current = true;
    setData(null);
    setLoadFailed(false);
    getMatterRadar(projectId, matterId).then(
      (next) => {
        if (current) setData(next);
      },
      (error) => {
        if (!current) return;
        setLoadFailed(true);
        notifyError(error, { action: tRef.current("radar.couldNotLoad") });
      },
    );
    return () => {
      current = false;
    };
  }, [projectId, matterId, reload]);

  // After an action the page reads the radar again: the state of every item is the server's.
  const refresh = useCallback(async () => {
    try {
      setData(await getMatterRadar(projectId, matterId));
    } catch (error) {
      notifyError(error, { action: tRef.current("radar.couldNotLoad") });
    }
  }, [projectId, matterId]);

  async function act(key: string, action: RadarAction, reason: string) {
    setBusyKey(key);
    try {
      await actOnRadarItem(projectId, matterId, key, action, reason ? { reason } : {});
      await refresh();
    } catch (error) {
      const conflict = errorCode(error) === "radar_item_closed";
      notifyError(error, { action: t(conflict ? "radar.actions.alreadyHandled" : "radar.actions.couldNotAct") });
      if (conflict) await refresh();
    } finally {
      setBusyKey(null);
    }
  }

  const names = new Map((data?.people ?? []).map((person) => [person.user_id, person.name] as const));
  const groups = groupItems(data?.items ?? []);

  return (
    <main className="min-h-full px-4 py-6 md:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="space-y-2">
          <Link
            href={`/projects/${encodeURIComponent(projectId)}`}
            className="inline-block rounded text-xs text-gray-500 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {t("radar.backToMatter")}
          </Link>
          <MatterSectionNav projectId={projectId} matterId={matterId} current="radar" />
          <div className="min-w-0">
            <h1 className="font-serif text-2xl text-gray-900">{t("radar.title")}</h1>
            <p className="mt-1 text-sm text-gray-600">{t("radar.subtitle")}</p>
            <p className="mt-1 text-sm font-medium text-gray-900">{t("radar.disclaimer")}</p>
            <p className="mt-1 text-xs text-gray-500">
              {t("radar.calendarNote")}
              {data ? ` ${t("radar.todayIs", { date: day(data.today) })}` : ""}
            </p>
          </div>
        </header>

        {loadFailed ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} role="alert">
            <p className="text-sm text-red-700">{t("radar.couldNotLoad")}</p>
            <PillButtonUI type="button" tone="white" size="sm" onClick={() => setReload((value) => value + 1)}>
              {t("radar.retry")}
            </PillButtonUI>
          </section>
        ) : !data ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} space-y-3 p-5`} aria-busy="true" aria-label={t("radar.loading")}>
            {[0, 1, 2].map((row) => (
              <div key={row} className="space-y-2" aria-hidden="true">
                <div className="h-4 w-1/3 animate-pulse rounded bg-app-surface" />
                <div className="h-16 w-full animate-pulse rounded bg-app-surface" />
              </div>
            ))}
          </section>
        ) : !data.retainer ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
            <EmptyState
              icon={<CalendarClock />}
              title={t("radar.retainer.offTitle")}
              description={t("radar.retainer.offDescription")}
            />
          </section>
        ) : groups.length === 0 ? (
          <section className={`${LIQUID_SUBTLE_PANEL_SURFACE_CLASS} p-5 md:p-6`}>
            <EmptyState icon={<CalendarClock />} title={t("radar.empty.title")} description={t("radar.empty.description")} />
          </section>
        ) : (
          <div className="space-y-5">
            {groups.map(([group, items]) => (
              <section key={group} aria-labelledby={`radar-group-${group}`} className="space-y-2">
                <h2 id={`radar-group-${group}`} className="font-serif text-lg text-gray-900">
                  {t(`radar.group.${group}`)}
                </h2>
                <ul className="space-y-3">
                  {items.map((item) => (
                    <li key={item.key}>
                      <RadarItemCard
                        item={item}
                        names={names}
                        canWrite={data.can_write}
                        busy={busyKey === item.key}
                        profileHref={profileHref(projectId, matterId)}
                        onAct={(action, reason) => void act(item.key, action, reason)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {data?.retainer ? (
          <ObligationRules projectId={projectId} matterId={matterId} onChanged={() => void refresh()} />
        ) : null}
      </div>
    </main>
  );
}

export default MatterRadar;
