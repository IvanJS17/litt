import { readFileSync } from "node:fs";
import path from "node:path";
import { LegalDocument } from "@/app/components/legal/LegalDocument";

// Public, no session. Read at build time from the published text.
export default function TermsPage() {
    const markdown = readFileSync(
        path.join(process.cwd(), "src/content/legal/terminos-y-condiciones.md"),
        "utf8",
    );
    return <LegalDocument markdown={markdown} />;
}
