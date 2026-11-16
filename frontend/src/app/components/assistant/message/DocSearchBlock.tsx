import { useState } from "react";
import type { DocumentSearchEvent } from "@mike/contracts";
import { EventBlock } from "./EventBlocks";
import { EventDisclosureButton, EventLabel } from "./EventDisclosure";
import { useTranslations } from "next-intl";

/** A document search uses the timeline's disclosure and reveals only its match count. */
export function DocSearchBlock({ event, isStreaming, interrupted, showConnector }: {
    event: DocumentSearchEvent;
    isStreaming?: boolean;
    /** The turn ended before the search reported its matches. */
    interrupted?: boolean;
    showConnector?: boolean;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const scope = new Map([
        ["project", "project documents"], ["library", "the document library"],
        ["templates", "the template library"], ["document", "this document"],
    ]).get(event.scope) ?? "documents";
    const count = event.match_count ?? 0;

    return (
        <EventBlock showConnector={showConnector} isStreaming={isStreaming}
            dotColor={event.error ? "red" : interrupted || count === 0 ? "gray" : "green"}>
            {interrupted ? (
                // No result arrived, so there is no match count to disclose.
                <EventLabel className="[overflow-wrap:anywhere]">
                    {t("assistant.docSearchBlock.searchStoppedIn", { scope, query: event.query })}
                </EventLabel>
            ) : (
                <EventDisclosureButton
                    open={open}
                    onToggle={() => setOpen(value => !value)}
                    label={<span className="[overflow-wrap:anywhere]">
                        {isStreaming ? t("assistant.docSearchBlock.searching") : event.error ? t("assistant.docSearchBlock.searchFailedIn") : t("assistant.docSearchBlock.searched")}{" "}
                        {t("assistant.docSearchBlock.scopeForQuery", { scope, query: event.query })}
                    </span>}
                    isStreaming={isStreaming}
                />
            )}
            {open && !isStreaming && !interrupted && (                <div className="mt-2">
                    {event.error ?? `${count} ${count === 1 ? "match" : "matches"}`}
                </div>
            )}
        </EventBlock>
    );
}
