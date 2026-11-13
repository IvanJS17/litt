"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import {
  SkeletonLine,
  TableBody,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
} from "@/app/components/shared/TablePrimitive";
import { cn } from "@/app/lib/utils";
import { getPlatformStats, type PlatformStats } from "@/app/lib/mikeApi";
import { userFacingApiError } from "@/app/lib/userFacingError";
import { countryLabel, practiceAreaLabel, professionalTitleLabel } from "@/app/onboarding/options";

type Usage = PlatformStats["usage"]["last_7_days"];
const FEATURES = ["chats", "documents", "compared", "converted", "scans", "split", "tabular", "training"] as const;

// Each table is a header row on wide screens. Below `lg` the header is gone and
// every row stacks its cells under their own labels, wrapping instead of
// truncating, so an email is always whole.
const ROW = "h-auto min-w-0 grid-cols-1 gap-x-4 gap-y-1 py-3 pr-3 pl-3 lg:items-start";
// The overview table's columns: the feature name, then the two usage counts.
// The header and every row take the same template and gap, so the columns line up.
const OVERVIEW_COLS = "lg:grid-cols-[minmax(0,1fr)_8rem_8rem]";
const CELL = "min-w-0 overflow-visible text-clip whitespace-normal break-all text-xs text-gray-700";

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <TableCell className={cn(CELL, className)}>
      <span className="text-gray-500 lg:hidden">{label}: </span>
      {children}
    </TableCell>
  );
}

/** Platform administrators: counts of use, by firm and by person. No content, no export. */
export function BetaStatsSection() {
  const t = useTranslations();
  const locale = useLocale();
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPlatformStats().then(
      (data) => !cancelled && setStats(data),
      (err) => !cancelled && setError(userFacingApiError(err, t("access.stats.loadError"))),
    );
    return () => {
      cancelled = true;
    };
  }, [t]);

  const featureLabels: Record<(typeof FEATURES)[number], string> = {
    chats: t("access.stats.features.chats"),
    documents: t("access.stats.features.documents"),
    compared: t("access.stats.features.compared"),
    converted: t("access.stats.features.converted"),
    scans: t("access.stats.features.scans"),
    split: t("access.stats.features.split"),
    tabular: t("access.stats.features.tabular"),
    training: t("access.stats.features.training"),
  };
  const scopeLabels: Record<string, string> = {
    private_practice: t("settings.personalisationFields.practiceSetting.privatePractice"),
    in_house: t("settings.personalisationFields.practiceSetting.inHouse"),
    not_practising: t("settings.personalisationFields.practiceSetting.notPractising"),
  };
  const feature = (key: (typeof FEATURES)[number]) => featureLabels[key];
  // Saved values are stable English identifiers; the labels are onboarding's.
  const otherLabels = {
    title: (value: string) => professionalTitleLabel(value, t),
    jurisdiction: (value: string) => countryLabel(value, locale),
    practiceArea: (value: string) => practiceAreaLabel(value, t),
  };
  const bucketLabel = (kind: "scope" | "title" | "jurisdiction" | "practiceArea", key: string | null) =>
    key === null
      ? t("access.stats.notSet")
      : kind === "scope"
        ? (scopeLabels[key] ?? key)
        : otherLabels[kind](key);
  const usageText = (usage: Usage) =>
    FEATURES.map((key) => `${feature(key)} ${usage[key]}`).join(" · ");
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : t("access.stats.none"));

  return (
    <section aria-labelledby="beta-stats-heading" className="space-y-6">
      <div>
        <SettingsHeading id="beta-stats-heading">{t("access.stats.heading")}</SettingsHeading>
        <SettingsDescription>{t("access.stats.hint")}</SettingsDescription>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {!stats && !error && (
        <div aria-busy="true" aria-label={t("access.stats.heading")} className="space-y-3">
          {[1, 2, 3, 4].map((n) => (
            <SkeletonLine key={n} className="h-8 w-full" />
          ))}
        </div>
      )}

      {stats && (
        <>
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-900">{t("access.stats.overview")}</h3>
            <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {(
                [
                  ["users", stats.totals.users],
                  ["firms", stats.totals.organizations],
                  ["deletedUsers", stats.totals.deleted_users],
                  ["awaiting", stats.totals.awaiting_acceptance],
                ] as const
              ).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-xs text-gray-500">{t(`access.stats.${key}`)}</dt>
                  <dd className="text-lg font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
            {stats.totals.awaiting_acceptance > 0 && (
              <SettingsDescription>{t("access.stats.awaitingNote")}</SettingsDescription>
            )}

            <TableHeaderRow
              data-testid="stats-overview-header"
              className={cn("hidden h-8 min-w-0 gap-x-4 pl-3 lg:grid", OVERVIEW_COLS)}
            >
              <TableHeaderCell>{t("access.stats.feature")}</TableHeaderCell>
              <TableHeaderCell>{t("access.stats.usage7")}</TableHeaderCell>
              <TableHeaderCell>{t("access.stats.usage30")}</TableHeaderCell>
            </TableHeaderRow>
            <TableBody>
              {FEATURES.map((key) => (
                <TableRow
                  key={key}
                  interactive={false}
                  data-testid="stats-overview-row"
                  className={cn("grid h-auto min-w-0 grid-cols-1 gap-x-4 gap-y-1 py-2 pl-3", OVERVIEW_COLS)}
                >
                  <TableCell className="min-w-0 overflow-visible text-clip whitespace-normal text-xs text-gray-700">
                    {feature(key)}
                  </TableCell>
                  <TableCell className="min-w-0 overflow-visible text-clip whitespace-normal">
                    <span className="text-gray-500 lg:hidden">{t("access.stats.usage7")}: </span>
                    {stats.usage.last_7_days[key]}
                  </TableCell>
                  <TableCell className="min-w-0 overflow-visible text-clip whitespace-normal">
                    <span className="text-gray-500 lg:hidden">{t("access.stats.usage30")}: </span>
                    {stats.usage.last_30_days[key]}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>

            <div className="grid gap-4 md:grid-cols-2">
              {(
                [
                  ["scope", "scope", stats.breakdowns.scope],
                  ["title", "title", stats.breakdowns.title],
                  ["jurisdiction", "jurisdiction", stats.breakdowns.jurisdiction],
                  ["practiceArea", "practiceArea", stats.breakdowns.practice_area],
                ] as const
              ).map(([label, kind, buckets]) => (
                <div key={label} className="min-w-0">
                  <TableHeaderRow className="h-8 min-w-0 justify-between gap-4">
                    <TableHeaderCell>{t(`access.stats.${label}`)}</TableHeaderCell>
                    <TableHeaderCell>{t("access.stats.count")}</TableHeaderCell>
                  </TableHeaderRow>
                  <TableBody>
                    {buckets.map((bucket) => (
                      <TableRow
                        key={bucket.key ?? "unset"}
                        interactive={false}
                        className="h-auto min-w-0 justify-between gap-4 py-1.5 pl-3"
                      >
                        <TableCell className="min-w-0 overflow-visible text-clip whitespace-normal break-words text-gray-700">
                          {bucketLabel(kind, bucket.key)}
                        </TableCell>
                        <TableCell>{bucket.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-900">{t("access.stats.byFirm")}</h3>
            {stats.organizations.length === 0 ? (
              <SettingsDescription>{t("access.stats.noFirms")}</SettingsDescription>
            ) : (
              <>
                <TableHeaderRow className="hidden h-8 min-w-0 grid-cols-[1.2fr_0.5fr_3fr] gap-x-4 pl-3 lg:grid">
                  <TableHeaderCell>{t("access.stats.firm")}</TableHeaderCell>
                  <TableHeaderCell>{t("access.stats.members")}</TableHeaderCell>
                  <TableHeaderCell>{t("access.stats.usage")}</TableHeaderCell>
                </TableHeaderRow>
                <TableBody>
                  {stats.organizations.map((org, index) => (
                    <TableRow
                      key={`${org.name}-${index}`}
                      interactive={false}
                      className={cn(ROW, "grid lg:grid-cols-[1.2fr_0.5fr_3fr]")}
                    >
                      <Cell label={t("access.stats.firm")}>{org.name}</Cell>
                      <Cell label={t("access.stats.members")}>{org.members}</Cell>
                      <Cell label={t("access.stats.usage")} className="break-words">
                        {usageText(org.usage)}
                      </Cell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-900">{t("access.stats.byPerson")}</h3>
            {stats.people.length === 0 ? (
              <SettingsDescription>{t("access.stats.noPeople")}</SettingsDescription>
            ) : (
              <>
                <TableHeaderRow className="hidden h-8 min-w-0 grid-cols-[1.4fr_1fr_1.6fr_2.2fr_0.9fr] gap-x-4 pl-3 lg:grid">
                  <TableHeaderCell>{t("access.stats.person")}</TableHeaderCell>
                  <TableHeaderCell>{t("access.stats.firm")}</TableHeaderCell>
                  <TableHeaderCell>{`${t("access.stats.scope")} · ${t("access.stats.title")} · ${t("access.stats.jurisdiction")} · ${t("access.stats.practiceArea")}`}</TableHeaderCell>
                  <TableHeaderCell>{t("access.stats.usage")}</TableHeaderCell>
                  <TableHeaderCell>{t("access.stats.lastActivity")}</TableHeaderCell>
                </TableHeaderRow>
                <TableBody>
                  {stats.people.map((person, index) => (
                    <TableRow
                      key={index}
                      interactive={false}
                      className={cn(ROW, "grid lg:grid-cols-[1.4fr_1fr_1.6fr_2.2fr_0.9fr]")}
                    >
                      {person.deleted ? (
                        <Cell label={t("access.stats.person")}>{t("access.stats.deletedUser")}</Cell>
                      ) : (
                        <TableCell className={CELL}>
                          <span className="block font-medium text-gray-900">{person.name ?? t("access.stats.none")}</span>
                          <span className="block break-all">{person.email}</span>
                        </TableCell>
                      )}
                      <Cell label={t("access.stats.firm")}>
                        {person.organizations.join(", ") || t("access.stats.none")}
                      </Cell>
                      <Cell label={t("access.stats.scope")} className="break-words">
                        {person.deleted
                          ? t("access.stats.none")
                          : [
                              person.scope ? bucketLabel("scope", person.scope) : null,
                              person.title ? bucketLabel("title", person.title) : null,
                              person.jurisdiction ? bucketLabel("jurisdiction", person.jurisdiction) : null,
                              person.practice_areas.map((area) => bucketLabel("practiceArea", area)).join(", ") || null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || t("access.stats.none")}
                      </Cell>
                      <Cell label={t("access.stats.usage")} className="break-words">
                        {usageText(person.usage)}
                      </Cell>
                      <Cell label={t("access.stats.lastActivity")} className="break-words">
                        {when(person.last_activity)}
                      </Cell>
                    </TableRow>
                  ))}
                </TableBody>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
