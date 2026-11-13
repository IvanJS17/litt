"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useOptionalUserProfile } from "@/app/contexts/UserProfileContext";
import { dismissManagedNotice } from "@/app/lib/mikeApi";

/**
 * Tells a person, until they close it, that their firm now manages their
 * account. The server remembers the dismissal (it is per firm), and it is not
 * shown to an account that learned this on the invitation.
 */
export function ManagedAccountBanner() {
  const t = useTranslations();
  const profile = useOptionalUserProfile()?.profile;
  const [closed, setClosed] = useState(false);
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
      className="flex items-start gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-gray-800"
    >
      <p className="flex-1">
        {t("managedAccount.nowManaged", { firm: profile.managedByFirmName })}
      </p>
      <button
        type="button"
        onClick={close}
        aria-label={t("managedAccount.dismiss")}
        className="shrink-0 rounded p-1 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
