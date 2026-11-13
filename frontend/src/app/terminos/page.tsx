import { readFileSync } from "node:fs";
import path from "node:path";
import { pageTitle } from "@/app/lib/pageTitle";
import { LegalDocument } from "@/app/components/legal/LegalDocument";

export const generateMetadata = pageTitle("terms");

// Public, no session. Read at build time from the published text.
export default function TermsPage() {
    const markdown = readFileSync(
        path.join(process.cwd(), "src/content/legal/terminos-y-condiciones.md"),
        "utf8",
    );
    return <LegalDocument markdown={markdown} />;
}
