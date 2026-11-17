"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { MatterRequestComplexity, MatterRequestLevel, MatterRequestStatus, RetainerReport } from "@mike/contracts";
import { useRadarWords } from "@/app/components/radar/radarText";
import { useRequestWords } from "@/app/components/requests/requestFields";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-2">
      <h2 id={id} className="font-serif text-lg text-gray-900">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Table({ label, head, rows }: { label: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full min-w-max text-left text-sm text-gray-800">
        <thead>
          <tr className="text-xs text-gray-500">
            {head.map((cell) => (
              <th key={cell} scope="col" className="py-1 pr-4 font-normal">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="align-top">
              {row.map((cell, column) => (
                <td key={column} className="py-1 pr-4 break-words">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What the Word file will say, on the screen: the same numbers, computed from
 * confirmed data only. Requests are counted, with rounds and calendar days;
 * nothing here measures or estimates time worked.
 */
export function ReportPreview({ report }: { report: RetainerReport }) {
  const t = useTranslations();
  const { day, distance } = useRadarWords();
  const words = useRequestWords();
  const { requests, profile, radar } = report;
  const counts = (label: string, entries: [string, number][]) => (
    <Table label={label} head={[label, t("retainerReport.requests.count")]} rows={entries.map(([name, count]) => [name, count])} />
  );
  return (
    <div className="min-w-0 space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-gray-700">
          {t("retainerReport.range", { start: day(report.period.start), end: day(report.period.end), days: report.period.days })}
        </p>
        <p className="text-sm font-medium text-gray-900">{t("retainerReport.disclaimer")}</p>
        <p className="text-sm text-gray-700">{t("retainerReport.scopeNote")}</p>
      </div>

      <Section id="report-requests" title={t("retainerReport.requests.title")}>
        {requests.total === 0 ? (
          <p className="text-sm text-gray-600">{t("retainerReport.requests.none")}</p>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">{t("retainerReport.requests.total", { count: requests.total })}</p>
            {counts(
              t("retainerReport.requests.byType"),
              requests.by_type.map((entry) => [words.type({ name: entry.name, seed_key: entry.seed_key }), entry.count]),
            )}
            {counts(
              t("retainerReport.requests.byComplexity"),
              (Object.keys(requests.by_complexity) as MatterRequestComplexity[]).map((key) => [words.complexity(key), requests.by_complexity[key]]),
            )}
            {counts(
              t("retainerReport.requests.byLevel"),
              (Object.keys(requests.by_level) as (MatterRequestLevel | "unassigned")[]).map((key) => [
                key === "unassigned" ? t("retainerReport.requests.unassigned") : words.level(key),
                requests.by_level[key],
              ]),
            )}
            {counts(
              t("retainerReport.requests.byStatus"),
              (Object.keys(requests.by_status) as MatterRequestStatus[]).map((key) => [words.status(key), requests.by_status[key]]),
            )}
          </div>
        )}
      </Section>

      <Section id="report-closed" title={t("retainerReport.closed.title")}>
        {requests.closed.length === 0 ? (
          <p className="text-sm text-gray-600">{t("retainerReport.closed.none")}</p>
        ) : (
          <>
            <p className="text-sm text-gray-700">
              {t("retainerReport.closed.summary", {
                count: requests.closed.length,
                rounds: requests.closed_rounds_total,
              })}
              {requests.closed_average_calendar_days === null
                ? ""
                : ` ${t("retainerReport.closed.average", { days: requests.closed_average_calendar_days })}`}
            </p>
            <Table
              label={t("retainerReport.closed.title")}
              head={[
                t("retainerReport.col.request"),
                t("retainerReport.col.type"),
                t("retainerReport.col.complexity"),
                t("retainerReport.col.received"),
                t("retainerReport.col.closed"),
                t("retainerReport.col.days"),
                t("retainerReport.col.rounds"),
              ]}
              rows={requests.closed.map((request) => [
                request.title,
                words.type({ name: request.type_name, seed_key: request.seed_key }),
                words.complexity(request.complexity),
                day(request.received_on),
                request.closed_on ? day(request.closed_on) : "",
                request.calendar_days,
                request.rounds,
              ])}
            />
          </>
        )}
      </Section>

      <Section id="report-open" title={t("retainerReport.open.title")}>
        {requests.open.length === 0 ? (
          <p className="text-sm text-gray-600">{t("retainerReport.open.none")}</p>
        ) : (
          <Table
            label={t("retainerReport.open.title")}
            head={[
              t("retainerReport.col.request"),
              t("retainerReport.col.type"),
              t("retainerReport.col.complexity"),
              t("retainerReport.col.status"),
              t("retainerReport.col.received"),
              t("retainerReport.col.daysOpen"),
              t("retainerReport.col.rounds"),
            ]}
            rows={requests.open.map((request) => [
              request.title,
              words.type({ name: request.type_name, seed_key: request.seed_key }),
              words.complexity(request.complexity),
              words.status(request.status),
              day(request.received_on),
              request.calendar_days,
              request.rounds,
            ])}
          />
        )}
      </Section>

      <Section id="report-profile" title={t("retainerReport.profile.title")}>
        <p className="text-sm text-gray-700">{t("retainerReport.profile.total", { count: profile.confirmed_total })}</p>
        <h3 className="text-sm font-medium text-gray-900">{t("retainerReport.profile.changed")}</h3>
        {profile.confirmed_in_period.length === 0 ? (
          <p className="text-sm text-gray-600">{t("retainerReport.profile.none")}</p>
        ) : (
          <Table
            label={t("retainerReport.profile.changed")}
            head={[t("retainerReport.col.fact"), t("retainerReport.col.kind"), t("retainerReport.col.confirmed")]}
            rows={profile.confirmed_in_period.map((fact) => [fact.label, t(`clientProfile.kind.${fact.kind}`), day(fact.confirmed_on)])}
          />
        )}
      </Section>

      <Section id="report-radar" title={t("retainerReport.radar.title")}>
        <p className="text-sm text-gray-700">
          {t("retainerReport.radar.intro", { start: day(report.horizon.start), end: day(report.horizon.end) })}
        </p>
        {radar.upcoming.length === 0 ? (
          <p className="text-sm text-gray-600">{t("retainerReport.radar.none")}</p>
        ) : (
          <Table
            label={t("retainerReport.radar.title")}
            head={[t("retainerReport.col.date"), t("retainerReport.col.deadline"), t("retainerReport.col.in")]}
            rows={radar.upcoming.map((item) => [
              day(item.due_on),
              `${item.label} (${t(`radar.type.${item.type}`)})`,
              distance(item) ?? "",
            ])}
          />
        )}
      </Section>
    </div>
  );
}
