"use client";

// LiTT training, layer 3: the people the caller supervises in a playbook's
// organization, named for the Corrections view. Anyone who is not a mentor
// there (the server answers 403) has none, and the view is not offered; a
// failure to read them is the same, quietly: the view is an extra, not the
// playbook.

import { useEffect, useState } from "react";
import { getMyPupils, listOrgMembers } from "@/app/lib/mikeApi";
import type { CorrectionPupil } from "./PlaybookCorrections";

export function usePlaybookCorrectionPupils(
  orgId: string | null,
  enabled: boolean,
): CorrectionPupil[] {
  const [loaded, setLoaded] = useState<{ orgId: string; pupils: CorrectionPupil[] } | null>(
    null,
  );

  useEffect(() => {
    if (!orgId || !enabled) return;
    let cancelled = false;
    void Promise.all([getMyPupils(orgId), listOrgMembers(orgId)])
      .then(([mine, members]) => {
        if (cancelled) return;
        const byId = new Map(members.map((member) => [member.user_id, member]));
        setLoaded({
          orgId,
          pupils: mine.pupils.map(({ user_id: userId }) => {
            const member = byId.get(userId);
            return { userId, label: member?.display_name || member?.email || userId };
          }),
        });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ orgId, pupils: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, enabled]);

  return enabled && loaded?.orgId === orgId ? loaded.pupils : [];
}
