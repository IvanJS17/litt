import { readFileSync } from "node:fs";
import path from "node:path";
import { LegalDocument } from "@/app/components/legal/LegalDocument";

// Public, no session. Read at build time from the published text.
export default function PrivacyPage() {
    const markdown = readFileSync(
        path.join(process.cwd(), "src/content/legal/aviso-de-privacidad.md"),
        "utf8",
    );
    return <LegalDocument markdown={markdown} />;
}
