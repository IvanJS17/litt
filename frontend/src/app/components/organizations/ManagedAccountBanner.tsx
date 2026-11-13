"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalUserProfile } from "@/app/contexts/UserProfileContext";
import { dismissManagedNotice } from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";

/**
 * Tells a person, until they close it, that their firm now manages their
 * account. The server remembers the dismissal (it is per firm), and it is not
 * shown to an account that learned this on the invitation.
 */
export function ManagedAccountBanner() {
  const t = useTranslations();
  const profile = useOptionalUserProfile()?.profile;
  const [closed, setClosed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  if (
    closed ||
    !profile?.personalWorkspaceDisabled ||
    !profile.managedNoticePending ||
    !profile.managedByFirmName
  )
    return null;

  function close() {
    // Closed for now whatever the network says; asked again next load if it
    // could not be saved.
    setClosed(true);
    void dismissManagedNotice().catch(() => {});
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-gray-200 bg-app-surface px-4 py-2 text-sm text-gray-800"
    >
      {/* The legal wording is shown whole. On a phone it is clamped to two
          lines until "See more", so the strip does not take the screen. */}
      <div className="min-w-0 flex-1">
        <p className={cn(!expanded && "line-clamp-2 md:line-clamp-none")}>
          {t("managedAccount.nowManaged", { firm: profile.managedByFirmName })}
        </p>
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-0.5 text-xs font-medium underline md:hidden"
        >
          {expanded ? t("common.seeLess") : t("common.seeMore")}
        </button>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label={t("managedAccount.dismiss")}
        className="shrink-0 rounded p-1 hover:bg-app-surface-hover"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
