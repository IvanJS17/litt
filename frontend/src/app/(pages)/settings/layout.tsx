import type { ReactNode } from "react";
import { pageTitle } from "@/app/lib/pageTitle";
import SettingsLayoutClient from "./SettingsLayoutClient";

export const generateMetadata = pageTitle("settings");

export default function SettingsLayout({ children }: { children: ReactNode }) {
    return <SettingsLayoutClient>{children}</SettingsLayoutClient>;
}
