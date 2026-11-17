"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TextButtonUI } from "@mike/ui";
import type {
  MatterRequestCountBreakdown,
  MatterRequestCounts,
  MatterRequestCountsPeriod,
  MatterRequestTypeSeed,
} from "@mike/contracts";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { getRequestCounts } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";
import { typeName } from "./requestOptions";

const PERIODS: readonly MatterRequestCountsPeriod[] = ["month", "quarter"];

const shiftDay = (day: string, by: number) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};

/**
 * Counts of the requests of the firm's retainer matters, in Ajustes del
 * despacho > General, for owners and admins. Numbers only: the server sends no
 * title, no matter name and no person, so a private matter is an opaque
 * "Iguala N". Opening the section is recorded in the firm's audit log.
 */
export function RequestCountsSettings({ orgId }: { orgId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const headingId = useId();
  const [period, setPeriod] = useState<MatterRequestCountsPeriod>("month");
  const [date, setDate] = useState<string | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; counts: MatterRequestCounts } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const key = `${orgId}|${period}|${date ?? ""}|${attempt}`;
  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => getRequestCounts(orgId, period, date))
      .then(
        (counts) => {
          if (current) setLoaded({ key, counts });
        },
        (error) => {
          if (!current) return;
          setFailedKey(key);
          notifyError(error, { action: tRef.current("requests.counts.couldNotLoad") });
        },
      );
    return () => {
      current = false;
    };
  }, [orgId, period, date, attempt, key]);

  const counts = loaded?.key === key ? loaded.counts : null;
  const failed = failedKey === key;
  const day = (value: string) =>
    format.dateTime(new Date(`${value}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" });
  const seedLabel = (seed: MatterRequestTypeSeed) => t(`requests.typeSeed.${seed}`);

  const empty =
    counts !== null &&
    counts.totals.received === 0 &&
    counts.totals.open_at_end === 0 &&
    counts.totals.closed_in_period === 0 &&
    counts.totals.cancelled_in_period === 0;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SettingsHeading id={headingId}>{t("requests.counts.title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <div className="min-w-0 space-y-1">
            <SettingsDescription>{t("requests.counts.help")}</SettingsDescription>
            <SettingsDescription>{t("requests.counts.audited")}</SettingsDescription>
          </div>
        </SettingsRow>
        <SettingsRow layout="stacked">
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("requests.counts.periodLabel")} className="flex gap-2">
              {PERIODS.map((option) => (
                <PillButtonUI
                  key={option}
                  type="button"
                  tone={period === option ? "black" : "white"}
                  size="normal"
                  aria-pressed={period === option}
                  className="pointer-coarse:min-h-11"
                  onClick={() => {
                    // The server picks the period holding the date; keep the date, change the length.
                    setPeriod(option);
                  }}
                >
                  {t(`requests.counts.${option}`)}
                </PillButtonUI>
              ))}
            </div>
            {counts ? (
              <div className="flex flex-wrap items-center gap-2">
                <TextButtonUI
                  type="button"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  onClick={() => setDate(shiftDay(counts.period_start, -1))}
                >
                  {t("requests.counts.previous")}
                </TextButtonUI>
                <span className="text-sm font-medium text-gray-900">
                  {t("requests.counts.range", { start: day(counts.period_start), end: day(counts.period_end) })}
                </span>
                <TextButtonUI
                  type="button"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  onClick={() => setDate(shiftDay(counts.period_end, 1))}
                >
                  {t("requests.counts.next")}
                </TextButtonUI>
              </div>
            ) : null}
          </div>
        </SettingsRow>
        {failed ? (
          <SettingsRow layout="stacked">
            <p role="alert" className="text-sm text-red-700">
              {t("requests.counts.couldNotLoad")}
            </p>
            <TextButtonUI type="button" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t("requests.counts.retry")}
            </TextButtonUI>
          </SettingsRow>
        ) : !counts ? (
          <SettingsRow layout="stacked">
            <div
              role="status"
              aria-label={t("requests.counts.loading")}
              className="h-24 animate-pulse rounded-xl bg-app-surface"
            />
          </SettingsRow>
        ) : counts.by_matter.length === 0 ? (
          <SettingsRow layout="stacked">
            <p className="text-sm text-gray-700">{t("requests.counts.emptyNoRetainers")}</p>
          </SettingsRow>
        ) : empty ? (
          <SettingsRow layout="stacked">
            <p className="text-sm text-gray-700">{t("requests.counts.emptyPeriod")}</p>
          </SettingsRow>
        ) : (
          <SettingsRow layout="stacked">
            <div className="min-w-0 space-y-6">
              <dl aria-label={t("requests.counts.summary")} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Figure label={t("requests.counts.received")} value={counts.totals.received} />
                <Figure label={t("requests.counts.openAtEnd")} value={counts.totals.open_at_end} />
                <Figure label={t("requests.counts.closedInPeriod")} value={counts.totals.closed_in_period} />
                <Figure label={t("requests.counts.cancelledInPeriod")} value={counts.totals.cancelled_in_period} />
                <Figure label={t("requests.counts.rounds")} value={counts.totals.rounds} />
                <Figure
                  label={t("requests.counts.median")}
                  value={
                    counts.totals.median_days === null
                      ? t("requests.counts.medianNone")
                      : t("requests.counts.medianValue", { count: counts.totals.median_days })
                  }
                />
              </dl>
              <SettingsDescription>{t("requests.counts.breakdownNote")}</SettingsDescription>
              <Table
                caption={t("requests.counts.byMatter")}
                extra
                rows={counts.by_matter.map((row) => ({
                  ...row,
                  id: String(row.ordinal),
                  name: t("requests.counts.matterLabel", { number: row.ordinal }),
                }))}
              />
              <Table
                caption={t("requests.counts.byType")}
                rows={counts.by_type.map((row) => {
                  const name = typeName(row, seedLabel);
                  return {
                    ...row,
                    id: row.type_id,
                    name: row.archived ? t("requests.counts.archivedType", { name }) : name,
                  };
                })}
              />
              <Table
                caption={t("requests.counts.byComplexity")}
                rows={counts.by_complexity.map((row) => ({
                  ...row,
                  id: row.key,
                  name: t(`requests.complexity.${row.key}`),
                }))}
              />
              <Table
                caption={t("requests.counts.byLevel")}
                rows={counts.by_level.map((row) => ({
                  ...row,
                  id: row.key,
                  name: row.key === "unassigned" ? t("requests.counts.unassigned") : t(`requests.level.${row.key}`),
                }))}
              />
              <StatusTable
                caption={t("requests.counts.byStatus")}
                nameHeader={t("requests.counts.col.name")}
                totalHeader={t("requests.counts.col.total")}
                rows={counts.by_status.map((row) => ({
                  id: row.key,
                  name: t(`requests.status.${row.key}`),
                  total: row.total,
                }))}
              />
            </div>
          </SettingsRow>
        )}
      </GlassCardUI>
    </section>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-0 rounded-xl bg-app-surface p-3">
      <dt className="text-xs text-gray-600">{label}</dt>
      <dd className="mt-1 break-words text-lg font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

type Row = MatterRequestCountBreakdown & {
  id: string;
  name: string;
  rounds?: number;
  median_days?: number | null;
};

function Table({ caption, rows, extra = false }: { caption: string; rows: Row[]; extra?: boolean }) {
  const t = useTranslations();
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[28rem] text-left text-sm">
        <caption className="pb-2 text-left text-sm font-medium text-gray-900">{caption}</caption>
        <thead>
          <tr className="text-xs text-gray-600">
            <th scope="col" className="py-1 pr-3 font-medium">{t("requests.counts.col.name")}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.total")}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.open")}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.closed")}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.cancelled")}</th>
            {extra ? (
              <>
                <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.rounds")}</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">{t("requests.counts.col.median")}</th>
              </>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-100">
              <th scope="row" className="py-1 pr-3 font-normal text-gray-900">{row.name}</th>
              <td className="px-2 py-1 text-right tabular-nums">{row.total}</td>
              <td className="px-2 py-1 text-right tabular-nums">{row.open}</td>
              <td className="px-2 py-1 text-right tabular-nums">{row.closed}</td>
              <td className="px-2 py-1 text-right tabular-nums">{row.cancelled}</td>
              {extra ? (
                <>
                  <td className="px-2 py-1 text-right tabular-nums">{row.rounds}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{row.median_days ?? "—"}</td>
                </>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusTable({
  caption,
  nameHeader,
  totalHeader,
  rows,
}: {
  caption: string;
  nameHeader: string;
  totalHeader: string;
  rows: Array<{ id: string; name: string; total: number }>;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[16rem] text-left text-sm">
        <caption className="pb-2 text-left text-sm font-medium text-gray-900">{caption}</caption>
        <thead>
          <tr className="text-xs text-gray-600">
            <th scope="col" className="py-1 pr-3 font-medium">{nameHeader}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{totalHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-gray-100">
              <th scope="row" className="py-1 pr-3 font-normal text-gray-900">{row.name}</th>
              <td className="px-2 py-1 text-right tabular-nums">{row.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
