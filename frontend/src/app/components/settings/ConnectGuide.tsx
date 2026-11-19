"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { GlassCardUI, PillButtonUI, TabPillButtonUI } from "@mike/ui";
import { ConnectedAppIcon } from "@/app/components/settings/ConnectedAppIcon";
import { SettingsRow } from "@/app/components/settings/SettingsRow";
import { SettingsHeading } from "@/app/components/settings/SettingsHeading";
import { SettingsNotice } from "@/app/components/settings/SettingsText";

const CLAUDE_GUIDE_URL = "https://support.claude.com/en/articles/11175166";
const CHATGPT_GUIDE_URL = "https://help.openai.com/en/articles/12584461";
const STEPS = [1, 2, 3, 4] as const;

type GuideApp = "claude" | "chatgpt";

function ExternalGuideLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 self-start rounded-sm text-sm text-interactive underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3.5" />
    </a>
  );
}

/**
 * How to connect LiTT from an AI app: the connection starts there, so this
 * gives the address to paste (from the server) and the vendors' own steps,
 * one app at a time. With nothing connected the Claude steps are open; with
 * connections they stay folded until the person picks an app.
 */
export function ConnectGuide({ serverUrl, connections }: { serverUrl: string; connections: number }) {
  const t = useTranslations("settings.connectedApps.guide");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<GuideApp | null>(connections === 0 ? "claude" : null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // The address stays visible and selectable.
    }
  }

  const steps = (prefix: "claudeStep" | "chatgptStep") => (
    <ol className="space-y-2 text-sm text-gray-700">
      {STEPS.map((n) => (
        <li key={n} className="flex gap-3">
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium text-gray-700 ring-1 ring-gray-300"
          >
            {n}
          </span>
          <span className="min-w-0 [overflow-wrap:anywhere]">{t(`${prefix}${n}`)}</span>
        </li>
      ))}
    </ol>
  );

  const tab = (app: GuideApp, label: string) => (
    <TabPillButtonUI
      active={open === app}
      aria-controls={`connect-guide-${app}`}
      onClick={() => setOpen(open === app ? null : app)}
    >
      <ConnectedAppIcon app={app} size="sm" />
      {label}
    </TabPillButtonUI>
  );

  return (
    <section className="space-y-3" aria-labelledby="connect-guide-title">
      <SettingsHeading id="connect-guide-title">{t("title")}</SettingsHeading>
      <GlassCardUI>
        <SettingsRow layout="stacked">
          <p className="text-sm text-gray-600">{t("intro")}</p>
          <div className="space-y-1.5">
            <p id="connect-guide-url-label" className="text-sm font-medium text-gray-900">
              {t("urlLabel")}
            </p>
            <div className="flex flex-col gap-2 rounded-lg bg-interactive-soft p-2 sm:flex-row sm:items-center sm:justify-between">
              <span
                aria-labelledby="connect-guide-url-label"
                className="min-w-0 px-1 text-sm text-gray-900 [overflow-wrap:anywhere]"
              >
                {serverUrl}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <PillButtonUI tone="white" type="button" onClick={() => void copy()}>
                  {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  {t("copy")}
                </PillButtonUI>
                {/* The button keeps its name; «Copied» is announced here, outside it. */}
                <span role="status" className="sr-only">
                  {copied ? t("copied") : ""}
                </span>
                <span aria-hidden="true" className="text-sm text-gray-600">
                  {copied ? t("copied") : ""}
                </span>
              </div>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow layout="stacked">
          <div role="group" aria-label={t("tabsLabel")} className="flex flex-wrap gap-2">
            {tab("claude", t("claudeHeading"))}
            {tab("chatgpt", t("chatgptHeading"))}
          </div>
          {open === "claude" && (
            <div id="connect-guide-claude" className="flex flex-col gap-3">
              {steps("claudeStep")}
              <p className="text-sm text-gray-600">{t("claudeTeam")}</p>
              <ExternalGuideLink href={CLAUDE_GUIDE_URL}>{t("claudeLink")}</ExternalGuideLink>
            </div>
          )}
          {open === "chatgpt" && (
            <div id="connect-guide-chatgpt" className="flex flex-col gap-3">
              <SettingsNotice entries={[{ icon: "info", label: t("chatgptRequirement") }]}>
                {t("chatgptNote")}
              </SettingsNotice>
              {steps("chatgptStep")}
              <ExternalGuideLink href={CHATGPT_GUIDE_URL}>{t("chatgptLink")}</ExternalGuideLink>
            </div>
          )}
        </SettingsRow>
        <SettingsRow layout="stacked">
          <p className="text-sm text-gray-600">{t("after")}</p>
        </SettingsRow>
      </GlassCardUI>
    </section>
  );
}
