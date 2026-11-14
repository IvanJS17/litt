"use client";

import { useTranslations } from "next-intl";
import type { AppTranslate } from "@/i18n/Translate";
import type { OrgMember } from "@/app/lib/mikeApi";
import { practiceAreaLabel } from "@/app/onboarding/options";
import { PRACTICE_OPTIONS } from "@/app/components/workflows/practices";

// LiTT training (docs/training.md): labels and identity shared by the
// training settings pages.

/**
 * A stored (normalized) practice area in the interface language. The stored
 * value is the English name lowercased (`training_stages.practice`); only the
 * label changes. A value that is not one of the catalog areas (typed by hand)
 * is shown as stored.
 */
export function practiceOptionLabel(practice: string, t: AppTranslate): string {
    const option = (PRACTICE_OPTIONS as readonly string[]).find(
        (candidate) => candidate.trim().toLowerCase() === practice,
    );
    if (option === undefined) return practice;
    if (option === "General Transactions") return t("training.generalTransactions");
    return practiceAreaLabel(option, t);
}

/** `practiceOptionLabel` bound to the current language. */
export function usePracticeOptionLabel() {
    const t = useTranslations();
    return (practice: string) => practiceOptionLabel(practice, t);
}

/** A member's name and email, each on its own line and never truncated. */
export function MemberIdentity({
    member,
    userId,
}: {
    member: OrgMember | undefined;
    userId: string;
}) {
    const t = useTranslations("training");
    const name = member?.display_name?.trim();
    const email = member?.email ?? null;
    return (
        <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 break-words">
                {name || email || t("member")}
            </p>
            {name && email && (
                <p className="text-sm text-gray-500 break-all">{email}</p>
            )}
            {!member && <span className="sr-only">{userId}</span>}
        </div>
    );
}

export function membersById(members: OrgMember[]): Map<string, OrgMember> {
    return new Map(members.map((member) => [member.user_id, member]));
}
