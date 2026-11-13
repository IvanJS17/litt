import type { ReactNode } from "react";
import { pageTitle } from "@/app/lib/pageTitle";
import { LibraryWorkspaceLayout } from "@/app/components/library/LibraryWorkspace";

export const generateMetadata = pageTitle("library");

export default function LibraryLayout({ children }: { children: ReactNode }) {
    return <LibraryWorkspaceLayout>{children}</LibraryWorkspaceLayout>;
}
