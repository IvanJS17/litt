import { sourceCodeUrl } from "../lib/sourceCommit.mjs";
import { textButtonUIClassName } from "./TextButtonUI.styles";

/**
 * Link to the source of the exact version that is running (AGPL-3.0 §13).
 * Renders nothing without a full commit SHA, which only a development build
 * outside a Git checkout can lack: production builds fail without one.
 */
export function SourceCodeLinkUI({
    commit,
    className,
}: {
    commit: string | undefined;
    className?: string;
}) {
    const href = sourceCodeUrl(commit);
    if (!href) return null;
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={textButtonUIClassName({ size: "xs", className })}
        >
            Código fuente{" "}
            <span className="sr-only">
                de esta versión (se abre en una pestaña nueva)
            </span>
        </a>
    );
}
