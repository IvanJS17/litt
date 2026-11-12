import type { AppTranslate } from "@/i18n/Translate";
import type { AssistantEvent } from "../../shared/types";

export function isRenderableEvent(event: AssistantEvent): boolean {
    return (
        event.type !== "error" &&
        event.type !== "ask_inputs_response" &&
        event.type !== "case_opinions" &&
        event.type !== "web_sources" &&
        // Shown under the answer, not in the timeline.
        event.type !== "firm_criteria" &&
        event.type !== "response_details"
    );
}

export function withDelegationEvents(events: AssistantEvent[]): AssistantEvent[] {
    return events.flatMap((event) =>
        event.type === "delegation" ? [event, ...event.events] : [event],
    );
}

export function eventErrorMessage(
    event: AssistantEvent,
    t: AppTranslate,
): string | null {
    if (event.type === "error") {
        return event.safe_to_display
            ? event.message
            : t("assistant.eventUtils.sorrySomethingWentWrong");
    }
    if ("error" in event && typeof event.error === "string" && event.error) {
        // Web tool errors are written for the user by the server.
        return event.type === "web_search" || event.type === "web_read"
            ? event.error
            : t("assistant.eventUtils.sorrySomethingWentWrong");
    }
    return null;
}

/**
 * Label for a connector tool: the connector's own title when it sent one,
 * otherwise its identifier made readable ("get_workspace_teams" becomes
 * "Get workspace teams").
 */
export function connectorToolLabel(
    toolName: string,
    toolTitle?: string | null,
): string {
    const title = toolTitle?.trim();
    if (title) return title;
    const words = toolName.replace(/[_-]+/g, " ").trim();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : toolName;
}

const TOOL_CALL_LABEL_KEYS = {
    create_text_card: "assistant.eventUtils.toolCreateTextCard",
    ask_inputs: "assistant.eventUtils.toolAskInputs",
    generate_docx: "assistant.eventUtils.toolGenerateDocx",
    generate_excel: "assistant.eventUtils.toolGenerateExcel",
    generate_ppt: "assistant.eventUtils.toolGeneratePpt",
    edit_document: "assistant.eventUtils.toolEditDocument",
    read_document: "assistant.eventUtils.toolReadDocument",
    fetch_documents: "assistant.eventUtils.toolFetchDocuments",
    find_in_document: "assistant.eventUtils.toolFindInDocument",
    find_documents: "assistant.eventUtils.toolFindDocuments",
    replicate_document: "assistant.eventUtils.toolReplicateDocument",
    read_workflow: "assistant.eventUtils.toolReadWorkflow",
    list_workflows: "assistant.eventUtils.toolListWorkflows",
    list_documents: "assistant.eventUtils.toolListDocuments",
    web_search: "assistant.eventUtils.toolWebSearch",
    read_webpage: "assistant.eventUtils.toolReadWebpage",
    list_firm_criteria: "assistant.eventUtils.toolListFirmCriteria",
    delegate: "assistant.eventUtils.toolDelegate",
} as const;

export function toolCallLabel(name: string, t: AppTranslate): string {
    if (Object.hasOwn(TOOL_CALL_LABEL_KEYS, name))
        return t(TOOL_CALL_LABEL_KEYS[name as keyof typeof TOOL_CALL_LABEL_KEYS]);
    if (name.startsWith("mcp_")) return t("assistant.eventUtils.toolConnector");
    return name
        ? t("assistant.eventUtils.toolRunning", { name })
        : t("assistant.eventUtils.toolWorking");
}
