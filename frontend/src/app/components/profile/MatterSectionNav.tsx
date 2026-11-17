"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

/** Moves between the pages of a retainer matter: its requests, its client profile, its deadline radar and its report. */
export function MatterSectionNav({
  projectId,
  matterId,
  current,
}: {
  projectId: string;
  matterId: string;
  current: "requests" | "profile" | "radar" | "report";
}) {
  const t = useTranslations();
  const base = `/projects/${encodeURIComponent(projectId)}/matters/${encodeURIComponent(matterId)}`;
  const link = (section: "requests" | "profile" | "radar" | "report", label: string) => (
    <Link
      href={`${base}/${section}`}
      aria-current={current === section ? "page" : undefined}
      className={`rounded px-1 py-0.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
        current === section ? "font-medium text-gray-900" : "text-gray-500 hover:text-gray-900"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <nav aria-label={t("clientProfile.nav.label")} className="flex flex-wrap items-center gap-3">
      {link("requests", t("requests.title"))}
      {link("profile", t("clientProfile.title"))}
      {link("radar", t("radar.nav"))}
      {link("report", t("retainerReport.nav"))}
    </nav>
  );
}
