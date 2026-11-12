import type { Translate } from "@/i18n/Translate";
import { errorCode } from "@/app/lib/userFacingError";

/** Why one invitation did not go out, as far as the web app can tell. */
export type InvitationIssueReason =
    | "already_member"
    | "invalid_email"
    | "email_not_sent"
    | "other";

/**
 * The reason a failed invitation request gives, read from the stable `code`
 * the API sends (`invitation_already_member`, `invitation_email_invalid`).
 * Anything else, a dropped connection or a 5xx included, is "other": the
 * text of the failure is never shown, only that this address was not invited.
 */
export function invitationIssueReason(error: unknown): InvitationIssueReason {
    switch (errorCode(error)) {
        case "invitation_already_member":
            return "already_member";
        case "invitation_email_invalid":
            return "invalid_email";
        default:
            return "other";
    }
}

/** One line for the address and the reason, in the interface language. */
export function invitationIssueText(
    t: Translate,
    email: string,
    reason: InvitationIssueReason,
): string {
    switch (reason) {
        case "already_member":
            return t("organizations.invitationIssue.alreadyMember", { email });
        case "invalid_email":
            return t("organizations.invitationIssue.invalidEmail", { email });
        case "email_not_sent":
            return t("organizations.invitationIssue.emailNotSent", { email });
        default:
            return t("organizations.invitationIssue.other", { email });
    }
}
