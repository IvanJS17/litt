import { redirect } from "next/navigation";

// «Funciones» is now «Asistente» (its keys and scan reading have their own
// tabs, see lib/settingsMap.ts). The old address only forwards.
export default function FeaturesRedirectPage() {
  redirect("/settings/assistant");
}
