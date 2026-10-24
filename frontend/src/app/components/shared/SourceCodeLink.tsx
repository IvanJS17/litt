import { SourceCodeLinkUI } from "@/shared/ui/SourceCodeLinkUI";

/** The web app's "Código fuente" link, bound to the commit `next build` inlined. */
export function SourceCodeLink({ className }: { className?: string }) {
    return (
        <SourceCodeLinkUI
            commit={process.env.LITT_SOURCE_COMMIT}
            className={className}
        />
    );
}
