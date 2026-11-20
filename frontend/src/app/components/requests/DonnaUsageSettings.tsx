"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { GlassCardUI, TextButtonUI } from "@mike/ui";
import type { DonnaUsage } from "@mike/contracts";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsDescription } from "@/app/components/settings/SettingsText";
import { getDonnaUsage } from "@/app/lib/mikeApi";
import { notifyError } from "@/app/lib/userFacingError";

/**
 * How much of its month the firm has used of Donna's triage (docs/request-triage.md),
 * in Ajustes del despacho > General, for owners and admins. Counts, tokens and
 * cost only: the server sends no title, no text and no project name, so a
 * project is an opaque "Proyecto N".
 */
export function DonnaUsageSettings({ orgId }: { orgId: string }) {
  const t = useTranslations();
  const format = useFormatter();
  const headingId = useId();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; usage: DonnaUsage } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });

  const key = `${orgId}|${attempt}`;
  useEffect(() => {
    let current = true;
    Promise.resolve()
      .then(() => getDonnaUsage(orgId))
      .then(
        (usage) => {
          if (current) setLoaded({ key, usage });
        },
        (error) => {
          if (!current) return;
          setFailedKey(key);
          notifyError(error, { action: tRef.current("donna.usage.couldNotLoad") });
        },
      );
    return () => {
      current = false;
    };
  }, [orgId, key]);

  const usage = loaded?.key === key ? loaded.usage : null;
  const failed = failedKey === key;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <SettingsHeading id={headingId}>{t("donna.usage.title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <SettingsDescription>{t("donna.usage.help")}</SettingsDescription>
        </SettingsRow>
        {failed ? (
          <SettingsRow layout="stacked">
            <p role="alert" className="text-sm text-red-700">
              {t("donna.usage.couldNotLoad")}
            </p>
            <TextButtonUI type="button" size="sm" className="pointer-coarse:min-h-11" onClick={() => setAttempt((n) => n + 1)}>
              {t("donna.usage.retry")}
            </TextButtonUI>
          </SettingsRow>
        ) : !usage ? (
          <SettingsRow layout="stacked">
            <div role="status" aria-label={t("donna.card.analysing")} className="h-16 animate-pulse rounded-xl bg-app-surface" />
          </SettingsRow>
        ) : (
          <SettingsRow layout="stacked">
            <div className="min-w-0 space-y-2">
              <p className="text-sm text-gray-900">{t("donna.usage.month", { month: usage.month })}</p>
              <p className="text-sm text-gray-900">
                {t("donna.usage.used", { used: usage.used, limit: usage.limit, remaining: usage.remaining })}
              </p>
              {usage.remaining === 0 ? (
                <p role="status" className="text-sm text-red-700">
                  {t("donna.usage.capReached")}
                </p>
              ) : null}
              {usage.used === 0 ? (
                <p className="text-sm text-gray-700">{t("donna.usage.none")}</p>
              ) : (
                <>
                  <p className="text-sm text-gray-700">
                    {t("donna.usage.jev", {
                      runs: usage.engines.jev.runs,
                      input: format.number(usage.engines.jev.input_tokens),
                      cost: format.number(usage.engines.jev.cost_usd, { style: "currency", currency: "USD", maximumFractionDigits: 4 }),
                    })}
                  </p>
                  <p className="text-sm text-gray-700">{t("donna.usage.byok", { runs: usage.engines.byok.runs })}</p>
                  <div className="space-y-1">
                    <h4 className="text-xs font-medium text-gray-900">{t("donna.usage.byProject")}</h4>
                    <ul className="space-y-0.5">
                      {usage.projects.map((project) => (
                        <li key={project.label} className="flex justify-between gap-3 text-sm text-gray-700">
                          <span>{project.label}</span>
                          <span>{format.number(project.runs)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </SettingsRow>
        )}
      </GlassCardUI>
    </section>
  );
}
