import type { ReactNode } from "react";
import { pageTitle } from "@/app/lib/pageTitle";
import { PlaybooksWorkspaceLayout } from "@/app/components/playbooks/PlaybooksWorkspace";

export const generateMetadata = pageTitle("playbooks");

/**
 * The list and each playbook's page share one workspace, which reads the open
 * playbook from the URL. The pages themselves render nothing.
 */
export default function PlaybooksLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PlaybooksWorkspaceLayout />
      {children}
    </>
  );
}
