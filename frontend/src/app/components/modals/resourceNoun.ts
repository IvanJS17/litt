import type { NsTranslate } from "@/i18n/Translate";

type T = NsTranslate<"modals">;

/** What an access screen says it is sharing; a closed set, never user text. */
export type ResourceNoun = "project" | "workflow" | "playbook" | "review" | "chat";

/** "this project", with the article that agrees with the noun in the language. */
export function thisResource(t: T, noun: string | undefined): string {
    switch (noun) {
        case "workflow":
            return t("modals.resource.thisWorkflow");
        case "playbook":
            return t("modals.resource.thisPlaybook");
        case "review":
            return t("modals.resource.thisReview");
        case "chat":
            return t("modals.resource.thisChat");
        default:
            return t("modals.resource.thisProject");
    }
}

/** "the project". */
export function theResource(t: T, noun: string | undefined): string {
    switch (noun) {
        case "workflow":
            return t("modals.resource.theWorkflow");
        case "playbook":
            return t("modals.resource.thePlaybook");
        case "review":
            return t("modals.resource.theReview");
        case "chat":
            return t("modals.resource.theChat");
        default:
            return t("modals.resource.theProject");
    }
}
