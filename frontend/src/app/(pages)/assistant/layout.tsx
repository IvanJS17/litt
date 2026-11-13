import type { ReactNode } from "react";
import { pageTitle } from "@/app/lib/pageTitle";

export const generateMetadata = pageTitle("assistant");

export default function Layout({ children }: { children: ReactNode }) {
    return children;
}
