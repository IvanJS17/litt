"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/app/contexts/WorkspaceContext";

// «Criterios del despacho» now lives in the firm's own settings, under
// Formación (docs/training.md). This address keeps old links working: it
// goes to the active firm's page, or to the person's firms when there is none.
export default function FirmCriteriaSettingsPage() {
  const router = useRouter();
  const { organizations, activeOrganization } = useWorkspace();
  useEffect(() => {
    if (organizations === null) return;
    const org = activeOrganization ?? organizations[0] ?? null;
    router.replace(
      org
        ? `/organizations/${org.id}/settings/training#criterios-del-despacho`
        : "/settings/organizations",
    );
  }, [organizations, activeOrganization, router]);
  return null;
}
