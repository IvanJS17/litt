import { useTranslations } from "next-intl";
import { SourceCodeLinkUI } from "@mike/ui";

/** The web app's "Source code" link, bound to the commit `next build` inlined. */
export function SourceCodeLink({ className }: { className?: string }) {
    const t = useTranslations();
    return (
        <SourceCodeLinkUI
            commit={process.env.LITT_SOURCE_COMMIT}
            label={t("common.sourceCode.label")}
            description={t("common.sourceCode.description")}
            className={className}
        />
    );
}
