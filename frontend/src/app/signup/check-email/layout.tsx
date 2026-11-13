import type { ReactNode } from "react";
import { pageTitle } from "@/app/lib/pageTitle";

export const generateMetadata = pageTitle("checkEmail");

export default function Layout({ children }: { children: ReactNode }) {
    return children;
}
