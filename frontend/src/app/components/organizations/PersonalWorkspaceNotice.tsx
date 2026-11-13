"use client";

import { useEffect, useRef } from "react";
import { notifyInfo } from "@mike/client";
import { useTranslations } from "next-intl";
import { useOptionalUserProfile } from "@/app/contexts/UserProfileContext";

/**
 * A link that asks for the personal workspace (`?workspace=personal`) opens
 * the firm's workspace for an account the firm manages. Say so once, instead
 * of showing the firm's lists as if nothing had been asked.
 */
export function PersonalWorkspaceNotice() {
  const t = useTranslations();
  const profile = useOptionalUserProfile()?.profile;
  const firm = profile?.personalWorkspaceDisabled ? profile.managedByFirmName : null;
  const shown = useRef(false);

  useEffect(() => {
    if (!firm || shown.current) return;
    if (new URLSearchParams(window.location.search).get("workspace") !== "personal") return;
    shown.current = true;
    notifyInfo(t("managedAccount.noPersonalWorkspace", { firm }));
  }, [firm, t]);

  return null;
}
