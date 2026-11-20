import { readFileSync } from "node:fs";
import path from "node:path";
import { legalPageMeta } from "@/app/lib/legalPageMeta";
import { LegalDocument } from "@/app/components/legal/LegalDocument";

export const generateMetadata = legalPageMeta("privacy", "/privacidad");

// Public, no session. Read at build time from the published text.
export default function PrivacyPage() {
    const markdown = readFileSync(
        path.join(process.cwd(), "src/content/legal/aviso-de-privacidad.md"),
        "utf8",
    );
    return <LegalDocument markdown={markdown} />;
}
