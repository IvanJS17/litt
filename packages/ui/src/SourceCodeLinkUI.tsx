import { sourceCodeUrl } from "@mike/client";
import { textButtonUIClassName } from "./TextButtonUI.styles";

/**
 * Link to the source of the exact version that is running (AGPL-3.0 §13).
 * Renders nothing without a full commit SHA, which only a development build
 * outside a Git checkout can lack: production builds fail without one.
 * The text is passed in: the web app and the Word add-in each translate it.
 */
export function SourceCodeLinkUI({
    commit,
    label,
    description,
    className,
}: {
    commit: string | undefined;
    /** The visible words, e.g. "Source code". */
    label: string;
    /** Read aloud after the label, e.g. "of this version (opens in a new tab)". */
    description: string;
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
            {label} <span className="sr-only">{description}</span>
        </a>
    );
}
